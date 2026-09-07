"""
alfa/core/cerber.py
Cerber — Immune Engine v0.3
Zgodny z ALFA Brain Whitepaper v1.2

Nie jest pasywnym walidatorem.
Symuluje zachowanie atakującego ZANIM akcja opuści sandbox.

Wektory ataku:

  Browser-specific:
    B1 — target_ref injection
    B2 — URL redirect / domain mismatch
    B3 — Action chaining (FILL+SUBMIT auto-submit risk)
    B4 — Malformed selector (długość, null bytes, unicode tricks)

  OWASP LLM Top 10 (browser context):
    L1 — Prompt injection przez value (drugi pass po Łasuchu — głębszy)
    L2 — Data exfiltration pattern (PII: email, PESEL, API key, password)
    L3 — Privilege escalation przez URL (admin paths, .env, config)
    L4 — SSRF próba (localhost, RFC1918, metadata endpoints)

  Domain integrity:
    D1 — IDN homograph attack (cyrylica/greek lookalikes)
    D2 — Subdomain escalation
    D3 — IP zamiast domeny

v0.2: każda metoda rzuca CerberBlockError (fail-fast).
v0.3: dodaje scoring per wektor (score_action -> CerberReport),
      historię ataków per session (attack_history),
      kompatybilność wsteczna: validate_action() bez zmian.
"""
from __future__ import annotations

import ipaddress
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Dict, List, Optional, Set
from urllib.parse import urlparse

from filtry_tonoyana.core.exceptions import CerberBlockError


# ── v0.3: scoring primitives ─────────────────────────────────────────────────

@dataclass
class AttackVector:
    """Wektor ataku z wagą ryzyka (0–1)."""
    code: str
    category: str
    description: str
    risk_weight: float = 0.30


@dataclass
class CerberReport:
    """
    Wynik score_action() — nie rzuca wyjątku, oddaje pełny obraz.

    blocked:           True gdy total_risk ≥ max_risk LUB ≥2 wektorów
    score:             min(sum(risk_weight), 1.0)
    triggered_vectors: wektory które się odpaliły
    reasons:           czytelne opisy (mapowane 1:1 z triggered_vectors)
    """
    blocked: bool
    score: float
    triggered_vectors: List[AttackVector] = field(default_factory=list)
    reasons: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "blocked": self.blocked,
            "score": self.score,
            "triggered_vectors": [
                {"code": v.code, "category": v.category,
                 "description": v.description, "risk_weight": v.risk_weight}
                for v in self.triggered_vectors
            ],
            "reasons": self.reasons,
        }


# ── Konfiguracja polityki ─────────────────────────────────────────────────────

DEFAULT_BLOCKED_DOMAINS: Set[str] = {
    "facebook.com",
    "doubleclick.net",
    "analytics.google.com",
}

DEFAULT_MAX_RISK_SCORE: float = 0.6
DEFAULT_ALLOWED_ACTIONS: Set[str] = {"READ", "CLICK", "FILL", "SUBMIT", "DOWNLOAD"}

# B4 — limity selektorów
MAX_TARGET_REF_LEN = 128
MAX_VALUE_LEN = 4096

# L2 — PII patterns
PII_PATTERNS = [
    re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"),   # email
    re.compile(r"\b\d{11}\b"),                                                 # PESEL
    re.compile(r"(?i)(password|passwd|haslo|hasło)\s*[=:]\s*\S+"),            # password=xxx
    re.compile(r"(?i)(api[_\-]?key|token|secret|bearer)\s*[=:]\s*[A-Za-z0-9\-_\.]{16,}"),
    re.compile(r"(?i)sk-[A-Za-z0-9]{32,}"),                                   # OpenAI-style key
    re.compile(r"(?i)ghp_[A-Za-z0-9]{36}"),                                   # GitHub PAT
]

# L3 — ścieżki uprzywilejowane
PRIVILEGED_PATHS = re.compile(
    r"(?i)(^|/)(\.\.|admin|wp-admin|wp-login|phpmyadmin|\.env|config"
    r"|secrets?|credentials?|private|internal|debug|console|dashboard"
    r"|api/v\d+/admin|_admin|management)(/|$|\?)",
)

# L4 — SSRF
SSRF_HOSTNAMES = re.compile(
    r"(?i)^(localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0"
    r"|metadata\.google\.internal|169\.254\.169\.254"
    r"|instance-data|fd[0-9a-f]{2}:)",
)
PRIVATE_IP_RANGES = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),   # link-local
    ipaddress.ip_network("fc00::/7"),          # IPv6 ULA
]

# B1 — niebezpieczne znaki w selektorach
SELECTOR_INJECTION_PATTERN = re.compile(
    r'[;\'"<>`]|(\bon\w+=)|(\bjavascript:)|(--)|(/\*)|(\*/)|\x00',
    re.IGNORECASE,
)

# D1 — IDN homograph: znaki spoza ASCII w domenie
# Akceptujemy tylko ASCII w domenach (punycode jest OK, ale wykrywamy raw unicode tricks)
NON_ASCII_IN_DOMAIN = re.compile(r"[^\x00-\x7F]")

# L1 — głębszy prompt injection (uzupełnienie Łasucha)
DEEP_INJECTION = re.compile(
    r"(?i)(act\s+as|pretend\s+(you\s+are|to\s+be)|simulate\s+a|roleplay\s+as"
    r"|override\s+(safety|guardrail|filter)|jailbreak|DAN\s+mode"
    r"|developer\s+mode|unrestricted\s+mode|bypass\s+(cerber|lasuch|guardian|alfa)"
    r"|print\s+(your\s+)?system\s+prompt|what\s+are\s+your\s+instructions"
    r"|token\s+smuggling|indirect\s+injection)",
)


# ── Policy dataclass ──────────────────────────────────────────────────────────

@dataclass
class CerberPolicy:
    """
    Polityka Cerbera.
    allowed_domains: pusty zbiór = przepuszcza wszystkie (poza blocklist).
    TODO: wczytywanie z cerber_policy.yaml
    TODO: per-domain override
    """
    allowed_domains: Set[str] = field(default_factory=set)
    blocked_domains: Set[str] = field(
        default_factory=lambda: set(DEFAULT_BLOCKED_DOMAINS)
    )
    max_risk_score: float = DEFAULT_MAX_RISK_SCORE
    allowed_actions: Set[str] = field(
        default_factory=lambda: set(DEFAULT_ALLOWED_ACTIONS)
    )
    require_https: bool = True
    enable_pii_detection: bool = True
    enable_ssrf_detection: bool = True
    enable_privileged_path_detection: bool = True


# ── Cerber ────────────────────────────────────────────────────────────────────

class Cerber:
    """
    Cerber — Immune Engine.

    validate_action(action) — fail-fast, rzuca CerberBlockError (v0.2 API, bez zmian)
    score_action(action)    — akumuluje wszystkie wektory, zwraca CerberReport (v0.3)
    attack_history          — lista ostatnich trafień per session
    reset_history()         — czyści history (nowa sesja)
    """

    # Wagi per wektor — kalibrowane pod DEFAULT_MAX_RISK_SCORE=0.6
    _VECTORS: Dict[str, AttackVector] = {
        "B1": AttackVector("B1", "browser",  "Selector injection",                 0.35),
        "B2": AttackVector("B2", "browser",  "URL redirect / domain mismatch",     0.25),
        "B3": AttackVector("B3", "browser",  "Action chaining (auto-submit risk)", 0.40),
        "B4": AttackVector("B4", "browser",  "Malformed selector",                 0.30),
        "L1": AttackVector("L1", "llm",      "Deep prompt injection",              0.45),
        "L2": AttackVector("L2", "llm",      "PII / data exfiltration",            0.50),
        "L3": AttackVector("L3", "llm",      "Privilege escalation (admin path)",  0.40),
        "L4": AttackVector("L4", "llm",      "SSRF attempt",                       0.55),
        "D1": AttackVector("D1", "domain",   "IDN homograph attack",               0.30),
        "D2": AttackVector("D2", "domain",   "Deep subdomain escalation",          0.20),
        "D3": AttackVector("D3", "domain",   "IP address instead of domain",       0.35),
    }

    def __init__(
        self,
        policy: Optional[CerberPolicy] = None,
        debug: bool = False,
    ):
        self.policy = policy or CerberPolicy()
        self.debug = debug
        self._passed_vectors: list[str] = []   # debug: które wektory przeszły
        self.attack_history: List[dict] = []   # v0.3: per-session attack log
        self.vectors: Dict[str, AttackVector] = dict(self._VECTORS)

    # ── v0.3: history management ───────────────────────────────────────────────

    def _record_attack(self, vector: AttackVector, detail: str) -> None:
        self.attack_history.append({
            "vector": vector.code,
            "category": vector.category,
            "description": vector.description,
            "detail": detail[:200],
        })

    def reset_history(self) -> None:
        """Czyści historię ataków — wywołaj na starcie nowej sesji."""
        self.attack_history.clear()

    # ── v0.3: scoring API ──────────────────────────────────────────────────────

    def score_action(self, action) -> CerberReport:
        """
        Nie rzuca wyjątku — akumuluje wszystkie wektory i oddaje CerberReport.
        Używaj gdy chcesz pełny obraz ryzyka, nie tylko pierwszy hit.
        """
        triggered: List[AttackVector] = []
        reasons: List[str] = []
        total_risk = 0.0

        def _try(code: str, check_fn) -> None:
            nonlocal total_risk
            try:
                check_fn()
            except CerberBlockError as exc:
                v = self.vectors[code]
                triggered.append(v)
                reasons.append(f"{code}: {exc.reason}")
                total_risk += v.risk_weight
                self._record_attack(v, str(getattr(exc, 'detail', '')))

        normalized_domain = _normalize_domain(action.domain)

        # Domain integrity
        _try("D3", lambda: self._simulate_D3_ip_as_domain(normalized_domain, action))
        _try("D1", lambda: self._simulate_D1_idn_homograph(action))
        _try("D2", lambda: self._simulate_D2_subdomain_escalation(normalized_domain, action))

        # URL checks
        if action.url:
            if self.policy.enable_ssrf_detection:
                _try("L4", lambda: self._simulate_L4_ssrf(action.url))
            _try("B2", lambda: self._simulate_B2_url_redirect(action))
            if self.policy.enable_privileged_path_detection:
                _try("L3", lambda: self._simulate_L3_privilege_escalation(action.url))

        # Selector / target_ref
        if action.target_ref is not None:
            _try("B4", lambda: self._simulate_B4_malformed_selector(action))
            _try("B1", lambda: self._simulate_B1_selector_injection(action))

        # Value (FILL / SUBMIT)
        if action.value is not None:
            _try("L1", lambda: self._simulate_L1_deep_injection(action))
            if self.policy.enable_pii_detection:
                _try("L2", lambda: self._simulate_L2_data_exfiltration(action))

        # Action chaining
        _try("B3", lambda: self._simulate_B3_action_chaining(action))

        blocked = (
            total_risk >= self.policy.max_risk_score
            or len(triggered) >= 2
        )
        return CerberReport(
            blocked=blocked,
            score=min(total_risk, 1.0),
            triggered_vectors=triggered,
            reasons=reasons,
        )

    def _dbg(self, vector: str) -> None:
        """Loguje przejście wektoru w trybie debug."""
        if self.debug:
            self._passed_vectors.append(vector)
            print(f"[Cerber:PASS] {vector}")

    def validate_action(self, action) -> None:
        """
        Uruchamia pełną symulację ataków.
        Rzuca CerberBlockError przy pierwszym wykrytym wektorze.
        """
        if self.debug:
            self._passed_vectors.clear()

        # Normalizacja domeny raz dla całego pipeline
        normalized_domain = _normalize_domain(action.domain)

        # ── Podstawowa polityka ─────────────────────────────────────────
        self._check_action_type(action)
        self._dbg("policy:action_type")
        self._check_risk_score(action)
        self._dbg("policy:risk_score")

        # ── Domain integrity ────────────────────────────────────────────
        self._simulate_D3_ip_as_domain(normalized_domain, action)
        self._dbg("D3:ip_as_domain")
        self._simulate_D1_idn_homograph(action)
        self._dbg("D1:idn_homograph")
        self._simulate_D2_subdomain_escalation(normalized_domain, action)
        self._dbg("D2:subdomain_escalation")
        self._check_domain_policy(normalized_domain, action)
        self._dbg("policy:domain")

        # ── URL checks (jeśli akcja zmienia domenę) ─────────────────────
        if action.url:
            self._check_url_scheme(action.url)
            # L4 musi byc przed B2 — SSRF adresy IP sa zawsze mismatch,
            # wiec B2 zlapaloby je z wrong reason
            if self.policy.enable_ssrf_detection:
                self._simulate_L4_ssrf(action.url)
                self._dbg("L4:ssrf")
            self._simulate_B2_url_redirect(action)
            self._dbg("B2:url_redirect")
            if self.policy.enable_privileged_path_detection:
                self._simulate_L3_privilege_escalation(action.url)
                self._dbg("L3:privilege_escalation")

        # ── Selector / target_ref ────────────────────────────────────────
        if action.target_ref is not None:
            self._simulate_B4_malformed_selector(action)
            self._dbg("B4:malformed_selector")
            self._simulate_B1_selector_injection(action)
            self._dbg("B1:selector_injection")

        # ── Value (FILL / SUBMIT) ────────────────────────────────────────
        if action.value is not None:
            self._simulate_L1_deep_injection(action)
            self._dbg("L1:deep_injection")
            if self.policy.enable_pii_detection:
                self._simulate_L2_data_exfiltration(action)
                self._dbg("L2:pii_exfiltration")

        # ── Action chaining ──────────────────────────────────────────────
        self._simulate_B3_action_chaining(action)
        self._dbg("B3:action_chaining")

    # ════════════════════════════════════════════════════════════════════
    # PODSTAWOWA POLITYKA
    # ════════════════════════════════════════════════════════════════════

    def _check_action_type(self, action) -> None:
        if action.action.value not in self.policy.allowed_actions:
            raise CerberBlockError(
                reason="ACTION_NOT_ALLOWED",
                detail=f"Akcja '{action.action.value}' nie jest w polityce.",
                action=action,
            )

    def _check_risk_score(self, action) -> None:
        if action.risk_score > self.policy.max_risk_score:
            raise CerberBlockError(
                reason="RISK_SCORE_EXCEEDED",
                detail=(
                    f"risk_score={action.risk_score:.2f} "
                    f"> limit={self.policy.max_risk_score:.2f}"
                ),
                action=action,
            )

    def _check_url_scheme(self, url: str) -> None:
        if self.policy.require_https and not url.startswith("https://"):
            raise CerberBlockError(
                reason="INSECURE_URL",
                detail=f"URL '{url[:80]}' nie używa HTTPS.",
            )

    def _check_domain_policy(self, normalized_domain: str, action) -> None:
        domain = normalized_domain
        for blocked in self.policy.blocked_domains:
            if domain == blocked or domain.endswith(f".{blocked}"):
                raise CerberBlockError(
                    reason="DOMAIN_BLOCKED",
                    detail=f"Domena '{domain}' jest na blocklist.",
                    action=action,
                )
        if self.policy.allowed_domains:
            if not any(
                domain == a or domain.endswith(f".{a}")
                for a in self.policy.allowed_domains
            ):
                raise CerberBlockError(
                    reason="DOMAIN_NOT_IN_ALLOWLIST",
                    detail=f"Domena '{domain}' nie jest na allowlist.",
                    action=action,
                )

    # ════════════════════════════════════════════════════════════════════
    # B1 — target_ref injection
    # ════════════════════════════════════════════════════════════════════

    def _simulate_B1_selector_injection(self, action) -> None:
        """
        Symulacja: atakujący próbuje wstrzyknąć kod przez selektor.
        Wykrywa: cudzysłowy, średniki, javascript:, onclick=, null bytes,
                 SQL comment tricks (--, /* */).
        """
        ref = action.target_ref
        if SELECTOR_INJECTION_PATTERN.search(ref):
            raise CerberBlockError(
                reason="B1_SELECTOR_INJECTION",
                detail=(
                    f"target_ref zawiera niebezpieczny znak lub wzorzec: "
                    f"'{ref[:80]}'"
                ),
                action=action,
            )

    # ════════════════════════════════════════════════════════════════════
    # B2 — URL redirect / domain mismatch
    # ════════════════════════════════════════════════════════════════════

    def _simulate_B2_url_redirect(self, action) -> None:
        """
        Symulacja: URL wskazuje na inną domenę niż action.domain.
        Atakujący może próbować przekierować browser na zewnętrzny serwer.
        """
        try:
            parsed = urlparse(action.url)
            url_domain = _normalize_domain(parsed.netloc)
            action_domain = _normalize_domain(action.domain)
        except Exception:
            raise CerberBlockError(
                reason="B2_URL_PARSE_ERROR",
                detail=f"Nie można sparsować URL: '{action.url[:80]}'",
                action=action,
            )

        if url_domain and url_domain != action_domain:
            # Subdomena jest OK (np. api.karentonoyan.pl dla karentonoyan.pl)
            if not url_domain.endswith(f".{action_domain}"):
                raise CerberBlockError(
                    reason="B2_URL_DOMAIN_MISMATCH",
                    detail=(
                        f"URL domain '{url_domain}' != action.domain '{action_domain}'. "
                        f"Możliwy redirect atak."
                    ),
                    action=action,
                )

    # ════════════════════════════════════════════════════════════════════
    # B3 — Action chaining
    # ════════════════════════════════════════════════════════════════════

    def _simulate_B3_action_chaining(self, action) -> None:
        """
        Symulacja: ryzykowne kombinacje akcji mogące prowadzić do
        niezamierzonego wysłania danych (auto-submit, credential leak).

        Blokowane przypadki:
          1. SUBMIT — zawsze wymaga jawnej weryfikacji (risk > 0 = BLOCK)
          2. CLICK na submit-like selector + value is not None (dane gotowe do wysłania)
          3. CLICK na submit-like selector + risk_score > 0.2
        """
        submit_selectors = re.compile(
            r"(?i)(submit|send|login|wyslij|zaloguj|confirm|ok|proceed"
            r"|sign.?in|log.?in|authenticate|authorize)",
        )

        # Przypadek 1: SUBMIT jako typ akcji — zawsze agresywna blokada
        if action.action.value == "SUBMIT":
            raise CerberBlockError(
                reason="B3_SUBMIT_REQUIRES_REVIEW",
                detail=(
                    f"Akcja SUBMIT wymaga jawnej weryfikacji Guardian (HUMAN_REVIEW). "
                    f"risk_score={action.risk_score:.2f}"
                ),
                action=action,
            )

        if action.action.value == "CLICK" and action.target_ref:
            is_submit_like = bool(submit_selectors.search(action.target_ref))

            # Przypadek 2: CLICK + submit-like + value załadowane = gotowe do wysłania
            if is_submit_like and action.value is not None:
                raise CerberBlockError(
                    reason="B3_ACTION_CHAINING_WITH_VALUE",
                    detail=(
                        f"CLICK na '{action.target_ref[:60]}' z załadowaną wartością. "
                        f"Możliwy auto-submit danych bez intencji użytkownika."
                    ),
                    action=action,
                )

            # Przypadek 3: CLICK + submit-like + podwyższone ryzyko
            if is_submit_like and action.risk_score > 0.2:
                raise CerberBlockError(
                    reason="B3_ACTION_CHAINING_RISK",
                    detail=(
                        f"CLICK na submit-like selector '{action.target_ref[:60]}' "
                        f"z risk_score={action.risk_score:.2f}. "
                        f"Możliwy niezamierzony auto-submit."
                    ),
                    action=action,
                )

    # ════════════════════════════════════════════════════════════════════
    # B4 — Malformed selector
    # ════════════════════════════════════════════════════════════════════

    def _simulate_B4_malformed_selector(self, action) -> None:
        """
        Symulacja: za długi selektor, null bytes, nadmiarowe whitespace.
        """
        ref = action.target_ref

        if len(ref) > MAX_TARGET_REF_LEN:
            raise CerberBlockError(
                reason="B4_SELECTOR_TOO_LONG",
                detail=(
                    f"target_ref ma {len(ref)} znaków "
                    f"(limit: {MAX_TARGET_REF_LEN})."
                ),
                action=action,
            )

        if "\x00" in ref:
            raise CerberBlockError(
                reason="B4_NULL_BYTE_IN_SELECTOR",
                detail="target_ref zawiera null byte (\\x00).",
                action=action,
            )

        # Unicode bidirectional override (RTL trick)
        bidi_overrides = {"\u202e", "\u200f", "\u200e", "\u2066", "\u2067", "\u2068", "\u2069"}
        if any(c in ref for c in bidi_overrides):
            raise CerberBlockError(
                reason="B4_BIDI_OVERRIDE_IN_SELECTOR",
                detail="target_ref zawiera znak unicode BiDi override.",
                action=action,
            )

    # ════════════════════════════════════════════════════════════════════
    # L1 — Głębszy prompt injection (drugi pass)
    # ════════════════════════════════════════════════════════════════════

    def _simulate_L1_deep_injection(self, action) -> None:
        """
        Cerber robi głębszy pass niż Łasuch.
        Szuka wzorców jailbreak, roleplay-as, token smuggling.
        """
        if DEEP_INJECTION.search(action.value):
            snippet = action.value[:120]
            raise CerberBlockError(
                reason="L1_DEEP_PROMPT_INJECTION",
                detail=(
                    f"value zawiera zaawansowany wzorzec injection: "
                    f"'{snippet}...'"
                ),
                action=action,
            )

    # ════════════════════════════════════════════════════════════════════
    # L2 — Data exfiltration / PII detection
    # ════════════════════════════════════════════════════════════════════

    def _simulate_L2_data_exfiltration(self, action) -> None:
        """
        Symulacja: akcja FILL/SUBMIT próbuje wysłać PII lub klucze API.
        Wykrywa: email, PESEL, password=, api_key=, GitHub PAT, OpenAI key.
        """
        for pattern in PII_PATTERNS:
            match = pattern.search(action.value)
            if match:
                # Maskujemy znaleziony fragment w raporcie
                found = match.group(0)
                masked = found[:4] + "*" * max(0, len(found) - 4)
                raise CerberBlockError(
                    reason="L2_PII_EXFILTRATION_RISK",
                    detail=(
                        f"value zawiera potencjalny PII/secret: '{masked}' "
                        f"(pattern: {pattern.pattern[:40]})"
                    ),
                    action=action,
                )

    # ════════════════════════════════════════════════════════════════════
    # L3 — Privilege escalation przez URL
    # ════════════════════════════════════════════════════════════════════

    def _simulate_L3_privilege_escalation(self, url: str) -> None:
        """
        Symulacja: URL wskazuje na uprzywilejowaną ścieżkę.
        Wykrywa: /admin, /wp-admin, /.env, /config, /secrets, itp.
        """
        try:
            parsed = urlparse(url)
            path = parsed.path
        except Exception:
            return  # Jeśli nie da się sparsować, B2 już to złapie

        if PRIVILEGED_PATHS.search(path):
            raise CerberBlockError(
                reason="L3_PRIVILEGED_PATH",
                detail=(
                    f"URL zawiera uprzywilejowaną ścieżkę: '{path[:80]}'. "
                    f"Możliwy privilege escalation."
                ),
            )

    # ════════════════════════════════════════════════════════════════════
    # L4 — SSRF
    # ════════════════════════════════════════════════════════════════════

    def _simulate_L4_ssrf(self, url: str) -> None:
        """
        Symulacja: URL wskazuje na wewnętrzną sieć lub metadata endpoint.
        Wykrywa: localhost, 127.x, RFC1918, link-local, GCP metadata.
        """
        try:
            host = urlparse(url).hostname or ""
        except Exception:
            return

        if SSRF_HOSTNAMES.match(host):
            raise CerberBlockError(
                reason="L4_SSRF_LOCALHOST",
                detail=f"URL wskazuje na '{host}' — możliwy SSRF.",
            )

        # Próba parsowania jako IP
        try:
            ip = ipaddress.ip_address(host)
            for network in PRIVATE_IP_RANGES:
                if ip in network:
                    raise CerberBlockError(
                        reason="L4_SSRF_PRIVATE_IP",
                        detail=(
                            f"URL wskazuje na prywatny adres IP '{host}' "
                            f"(sieć: {network}). Możliwy SSRF."
                        ),
                    )
        except ValueError:
            pass  # Nie IP — OK

    # ════════════════════════════════════════════════════════════════════
    # D1 — IDN homograph
    # ════════════════════════════════════════════════════════════════════

    def _simulate_D1_idn_homograph(self, action) -> None:
        """
        Symulacja: domena zawiera znaki unicode wyglądające jak ASCII.
        Klasyczny atak: аlfa.pl (cyrylica 'а') vs alfa.pl (latin 'a').
        """
        domain = action.domain
        if NON_ASCII_IN_DOMAIN.search(domain):
            # Próba wykrycia konkretnych lookalike kategorii
            suspicious_cats = {"Ll", "Lu", "Lo"}   # litery nie-ASCII
            suspicious_chars = [
                c for c in domain
                if ord(c) > 127 and unicodedata.category(c) in suspicious_cats
            ]
            if suspicious_chars:
                raise CerberBlockError(
                    reason="D1_IDN_HOMOGRAPH",
                    detail=(
                        f"Domena '{domain}' zawiera znaki unicode "
                        f"mogące imitować ASCII: "
                        f"{[repr(c) for c in suspicious_chars[:5]]}"
                    ),
                    action=action,
                )

    # ════════════════════════════════════════════════════════════════════
    # D2 — Subdomain escalation
    # ════════════════════════════════════════════════════════════════════

    def _simulate_D2_subdomain_escalation(self, normalized_domain: str, action) -> None:
        """
        Symulacja: allowlist zawiera domenę, ale akcja próbuje użyć
        subdomeny która nie powinna mieć dostępu (np. evil.trusted.pl).
        Na razie: flaguje subdomeny trzeciego poziomu i głębsze.
        TODO: per-domain subdomain whitelist.
        """
        domain = normalized_domain
        parts = domain.split(".")

        # Więcej niż 3 części = głęboka subdomena (np. a.b.example.com)
        if len(parts) > 3:
            raise CerberBlockError(
                reason="D2_DEEP_SUBDOMAIN",
                detail=(
                    f"Domena '{domain}' ma {len(parts)} poziomów. "
                    f"Głębokie subdomeny wymagają jawnej weryfikacji."
                ),
                action=action,
            )

    # ════════════════════════════════════════════════════════════════════
    # D3 — IP zamiast domeny
    # ════════════════════════════════════════════════════════════════════

    def _simulate_D3_ip_as_domain(self, normalized_domain: str, action) -> None:
        """
        Symulacja: action.domain to adres IP zamiast nazwy domenowej.
        Atakujący może podać IP żeby ominąć domain-based blocklist.
        """
        domain = _normalize_domain(action.domain)
        try:
            ip = ipaddress.ip_address(domain)
            raise CerberBlockError(
                reason="D3_IP_AS_DOMAIN",
                detail=(
                    f"action.domain to adres IP '{domain}'. "
                    f"Wymagana nazwa domenowa."
                ),
                action=action,
            )
        except ValueError:
            pass  # Nie IP — OK


# ── helpers ───────────────────────────────────────────────────────────────────

def _normalize_domain(domain: str) -> str:
    domain = domain.lower().strip()
    domain = re.sub(r"^https?://", "", domain)
    domain = domain.split("/")[0].split("?")[0].split(":")[0]
    return domain
