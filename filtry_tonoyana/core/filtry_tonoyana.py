"""
alfa/core/filtry_tonoyana.py
FILTRY TONOYANA v3.0 RC1 — System Anti-Halucynacja
© Karen Tonoyan, Twórca ALFA

Filozofia:
  9 deterministycznych filtrów (7 + F8 Dowód + F9 Koszt Błędu).
  Wymusza System 2 (Kahneman) na odpowiedzi LLM.
  Pipeline: IN → F1..F9 → OUT
  Wynik: FilteryReport z decyzją PASS | HOLD | REJECT.

Cztery warstwy (v3.0 RC1):
  L1 Bifurkacja    (waga 0.22):  F1 Kontrargument, F2 Weryfikacja
  L2 Leksykon      (waga 0.40):  F3 Kontekst, F4 Anti-Magic
  L3 Graf ontologiczny (0.25):   F5 Dwuperspektywa, F6 Backtrack, F7 Atrybucja
  L4 Dowód i koszt (waga 0.13):  F8 Dowód, F9 Koszt Błędu

Cel projektowy: wysoka skuteczność w wykrywaniu wzorców halucynacyjnych.
Weryfikacja: testy regresji na rzeczywistych outputach modeli (TODO v3.1 stable).

Licencja: open source + enterprise tier
Status: RC1 — stable po dodaniu testów regresji na rzeczywistych danych

TODO v3.1 stable:
  - Stemming: spacy pl_core_news_sm lub morfologik
  - F7 source credibility check + ontological graph
  - Testy regresji na rzeczywistych odpowiedziach modeli
  - Streaming mode (token po tokenie)
  - Integracja z ALFA T9 jako pre-output gate
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional


# ── Prosty stemmer dla języka polskiego (heurystyczny) ───────────────────────
# Usuwa typowe końcówki fleksyjne.
# TODO v3.1: spacy pl_core_news_sm lub morfologik

_PL_SUFFIXES = (
    "owego", "owej", "owym", "owych",
    "emu", "ego", "iej", "iem",
    "owy", "owa", "owe", "owi",
    "ami", "ach", "om",
    "ych", "ich",
    "ny", "na", "ne", "ni",
    "ów",
)

def _stem_pl(word: str) -> str:
    """Heurystyczny stemmer — ucina typowe polskie końcówki. Min 4 znaki rdzenia."""
    word = word.lower()
    for suffix in sorted(_PL_SUFFIXES, key=len, reverse=True):
        if word.endswith(suffix) and len(word) - len(suffix) >= 4:
            return word[:-len(suffix)]
    return word


# ── Normalizacja tekstu przed matchingiem ─────────────────────────────────────
# Usuwa zero-width chars i normalizuje Unicode (NFKC) — blokuje ZWS i część homoglyphs

_ZERO_WIDTH = re.compile(
    r"[​‌‍‎‏‪-‮⁠-⁩﻿­]"
)

# Homoglyph mapping: cyrylica/greek → ASCII (najczęstsze ataki)
_HOMOGLYPH_MAP = str.maketrans(
    "аеіоруАЕІОРУ"   # cyrylica
    "αεικοpτυАΒΡΕΙΟΤΥ"  # greek
    "ɡ",             # latin script g
    "aeiopyAEIOPY"
    "aeikoptuABPEIOTY"
    "g",
)

import unicodedata

def _normalize_for_matching(text: str) -> str:
    """
    Normalizuje tekst przed regex matchingiem:
    1. NFKC — canonicalizacja Unicode (łączy kombinowane, normalizuje kompatybilne)
    2. Usuwa zero-width i invisible chars
    3. Mapuje homoglyphs cyrylica/greek → ASCII
    """
    text = unicodedata.normalize("NFKC", text)
    text = _ZERO_WIDTH.sub("", text)
    text = text.translate(_HOMOGLYPH_MAP)
    return text


# ── Wzorce leksykalne ─────────────────────────────────────────────────────────

HALLUCINATION_PATTERNS = [
    # Oryginalnych 14
    re.compile(r"(?i)jest powszechnie wiadomo"),
    re.compile(r"(?i)wszyscy wiedzą"),
    re.compile(r"(?i)oczywiste jest"),
    re.compile(r"(?i)it is well known"),
    re.compile(r"(?i)everyone knows"),
    re.compile(r"(?i)badania pokazują(?: że)?"),
    re.compile(r"(?i)nauka udowodniła"),
    re.compile(r"(?i)nauka to potwierdziła"),
    re.compile(r"(?i)\d+[,.]?\d*\s*%\s+(wszystkich|ludzi|przypadków|użytkowników)"),
    re.compile(r"(?i)jedyne (rozwiązanie|metoda|sposób)"),
    re.compile(r"(?i)zawsze (działa|skuteczne|prawda)"),
    re.compile(r"(?i)nigdy nie (zawodzi|myli się)"),
    re.compile(r"(?i)100%\s+(skuteczn|pewn|gwarantowan)"),
    re.compile(r"(?i)gwarantowany|gwarantowana|gwarantowane"),
    # v3.1: nowe wzorce absolutyzmu semantycznego (red team findings)
    re.compile(r"(?i)nie (zawodzi|myli się|błądzi|rozczarowuje)"),          # "ta metoda nie zawodzi" (bez "nigdy")
    re.compile(r"(?i)(bez\s+wyjątku|bez\s+wyjątków)"),                      # "sprawdza się bez wyjątku"
    re.compile(r"(?i)(bezbłędni|bezbłędna|bezbłędne|bezbłędnego)"),         # "funkcjonuje bezbłędnie"
    re.compile(r"(?i)nie\s+podlega\s+dyskusji"),                             # "nie podlega dyskusji"
    re.compile(r"(?i)definitywnie\s+ustalone"),                              # "zostało definitywnie ustalone"
    re.compile(r"(?i)(jednomyślnie|powszechnie)\s+(potwierdzi|uznaj)"),      # "jednomyślnie potwierdziły"
    re.compile(r"(?i)żaden\s+ekspert\s+nie\s+(kwestionuje|podważa|zaprzecza)"),  # authority bypass
    re.compile(r"(?i)(cała|wszystkie)\s+(społeczność|instytucje)\s+(naukow|medyczn|ekspert)"),
    re.compile(r"(?i)it\s+(never|always)\s+(fails?|works?|succeeds?)"),       # EN absolutism
    re.compile(r"(?i)without\s+(exception|fail|doubt)"),                      # EN
    re.compile(r"(?i)undeniably|unquestionably|indisputably|definitively\s+proven"),  # EN
]

TOPIC_DRIFT_MARKERS = re.compile(
    r"(?i)(przy okazji|nawiasem mówiąc|warto też wspomnieć|"
    r"co ciekawe|a propos|skoro już mowa|"
    r"by the way|incidentally|speaking of which|"
    r"interestingly enough|on a related note)",
)

CONTRADICTION_SEEDS = re.compile(
    r"(?i)(z jednej strony .{5,100} z drugiej strony .{5,100} jednak"
    r"|on one hand .{5,100} on the other hand .{5,100} however"
    r"|pomimo że .{5,100} to jednak .{5,100} ale"
    r"|chociaż .{5,100} niemniej jednak .{5,100} mimo)",
    re.DOTALL,
)

ATTRIBUTION_MISSING = re.compile(
    r"(?i)(według|according to|jak twierdzi|as stated by|"
    r"jak wynika z|based on|jak podaje|as reported by)"
    r"(?!\s+\w+\s+(,|\.|:|\d))",
)


# ── Dataclasses ───────────────────────────────────────────────────────────────

@dataclass
class FilterResult:
    filter_id: str
    filter_name: str
    passed: bool
    score: float
    flags: list[str] = field(default_factory=list)
    detail: Optional[str] = None


@dataclass
class FilteryReport:
    input_text: str
    results: list[FilterResult] = field(default_factory=list)
    final_score: float = 0.0
    decision: str = "UNKNOWN"
    decision_reason: str = ""
    layer_scores: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "decision": self.decision,
            "final_score": round(self.final_score, 3),
            "decision_reason": self.decision_reason,
            "layer_scores": {k: round(v, 3) for k, v in self.layer_scores.items()},
            "filters": [
                {"id": r.filter_id, "name": r.filter_name,
                 "passed": r.passed, "score": round(r.score, 3),
                 "flags": r.flags, "detail": r.detail}
                for r in self.results
            ],
        }

    def passed_filters(self) -> list[str]:
        return [r.filter_id for r in self.results if r.passed]

    def failed_filters(self) -> list[str]:
        return [r.filter_id for r in self.results if not r.passed]


# ── FiltryTonoyana ────────────────────────────────────────────────────────────

class FiltryTonoyana:
    """
    FILTRY TONOYANA v3.0 RC1
    9 deterministycznych filtrów anti-halucynacja.

    Użycie:
        filtry = FiltryTonoyana()
        report = filtry.run(text, query="...", evidence=["plik.log"], high_stakes=True)
        if report.decision == "PASS":
            ...
    """

    PASS_THRESHOLD = 0.3
    HOLD_THRESHOLD = 0.6

    def run(
        self,
        text: str,
        query: Optional[str] = None,
        evidence: Optional[list[str]] = None,
        high_stakes: bool = False,
        stakes_domain: Optional[str] = None,
    ) -> FilteryReport:
        """
        Uruchamia pełny pipeline 9 filtrów.
        text          — odpowiedź LLM do weryfikacji
        query         — oryginalne zapytanie (poprawia F3)
        evidence      — lista artefaktów dowodowych (dla F8)
        high_stakes   — czy kontekst jest wysokiego ryzyka (dla F9)
        stakes_domain — "hardware"|"medical"|"security"|"financial"|"legal"
        """
        report = FilteryReport(input_text=text[:500])

        # L1
        r_f1 = self._f1_kontrargument(text)
        r_f2 = self._f2_weryfikacja(text)
        layer1 = (r_f1.score + r_f2.score) / 2

        # L2
        r_f3 = self._f3_kontekst(text, query)
        r_f4 = self._f4_anti_magic(text)
        layer2 = (r_f3.score + r_f4.score) / 2

        # L3
        r_f5 = self._f5_dwuperspektywa(text)
        r_f6 = self._f6_backtrack(text)
        r_f7 = self._f7_atrybucja(text)
        layer3 = (r_f5.score + r_f6.score + r_f7.score) / 3

        # L4
        r_f8 = self._f8_dowod(text, evidence=evidence)
        r_f9 = self._f9_koszt_bledu(text, high_stakes=high_stakes, stakes_domain=stakes_domain)
        layer4 = (r_f8.score + r_f9.score) / 2

        all_results = [r_f1, r_f2, r_f3, r_f4, r_f5, r_f6, r_f7, r_f8, r_f9]
        report.results = all_results
        report.layer_scores = {
            "L1_bifurkacja": layer1,
            "L2_leksykon":   layer2,
            "L3_graf":       layer3,
            "L4_dowod":      layer4,
        }

        base_score = (
            layer1 * 0.22
            + layer2 * 0.40
            + layer3 * 0.25
            + layer4 * 0.13
        )
        critical_bonus = sum(0.2 for r in all_results if r.score >= self.HOLD_THRESHOLD)
        report.final_score = min(base_score + critical_bonus, 1.0)

        failed   = [r for r in all_results if not r.passed]
        critical = [r for r in all_results if r.score >= self.HOLD_THRESHOLD]

        if critical or report.final_score >= self.HOLD_THRESHOLD:
            report.decision = "REJECT"
            report.decision_reason = (
                f"Krytyczny fail: {[r.filter_id for r in critical]} "
                f"(score={report.final_score:.2f})"
            )
        elif failed or report.final_score >= self.PASS_THRESHOLD:
            report.decision = "HOLD"
            report.decision_reason = (
                f"Flagi: {[r.filter_id for r in failed]} "
                f"(score={report.final_score:.2f})"
            )
        else:
            report.decision = "PASS"
            report.decision_reason = f"Wszystkie filtry OK (score={report.final_score:.2f})"

        return report

    # ── L1 BIFURKACJA ─────────────────────────────────────────────────────────

    def _f1_kontrargument(self, text: str) -> FilterResult:
        """F1 — KONTRARGUMENT: absolute twierdzenia bez hedging."""
        score = 0.0
        flags = []

        hedging = re.search(
            r"(?i)\b(może|możliwe|zazwyczaj|często|w wielu przypadkach|"
            r"tends to|often|usually|typically|generally|"
            r"prawdopodobnie|likely|probably|might|could be)\b",
            text,
        )
        absolute = re.search(
            r"(?i)\b(zawsze|nigdy|każdy|wszyscy|żaden|"
            r"always|never|every|all|none|bez wyjątku|without exception)\b",
            text,
        )

        if absolute and not hedging:
            score += 0.4
            flags.append(f"absolute_bez_hedging: '{absolute.group(0)}'")
        if len(text) > 100 and not hedging and not absolute:
            score += 0.15
            flags.append("brak_hedging_w_długim_tekście")

        return FilterResult("F1", "KONTRARGUMENT", score < 0.3, min(score, 1.0), flags)

    def _f2_weryfikacja(self, text: str) -> FilterResult:
        """F2 — WERYFIKACJA: sprzeczności wewnętrzne."""
        score = 0.0
        flags = []

        if CONTRADICTION_SEEDS.search(text):
            score += 0.35
            flags.append("wzorzec_wewnętrznej_sprzeczności")

        negations = re.findall(
            r"(?i)\b(nie|żadne|brak|bez|however|but|yet|although|though)\b", text
        )
        words = text.split()
        if words and len(negations) > len(words) * 0.15:
            score += 0.2
            flags.append(f"wysoki_wskaźnik_negacji: {len(negations)}/{len(words)}")

        return FilterResult("F2", "WERYFIKACJA", score < 0.3, min(score, 1.0), flags)

    # ── L2 LEKSYKON ──────────────────────────────────────────────────────────

    def _f3_kontekst(self, text: str, query: Optional[str] = None) -> FilterResult:
        """F3 — KONTEKST: topic drift + overlap z query (ze stemmingiem)."""
        score = 0.0
        flags = []

        drift = TOPIC_DRIFT_MARKERS.findall(text)
        if drift:
            score += min(len(drift) * 0.15, 0.45)
            flags.append(f"topic_drift_markers: {drift[:3]}")

        if query:
            q_words = set(_stem_pl(w) for w in re.findall(r"\b\w{4,}\b", query.lower()))
            t_words = set(_stem_pl(w) for w in re.findall(r"\b\w{4,}\b", text.lower()))
            if q_words:
                overlap = len(q_words & t_words) / len(q_words)
                if overlap < 0.2:
                    score += 0.3
                    flags.append(f"niski_overlap_z_query: {overlap:.0%}")

        return FilterResult("F3", "KONTEKST", score < 0.3, min(score, 1.0), flags)

    def _f4_anti_magic(self, text: str) -> FilterResult:
        """F4 — ANTI-MAGIC: halucynacyjne markery, fikcyjne liczby, overclaiming."""
        score = 0.0
        flags = []

        # Normalizacja: ZWS + homoglyphs + NFKC — blokuje obfuscation attacks
        normalized = _normalize_for_matching(text)

        matched = [
            p.search(normalized).group(0)[:40]
            for p in HALLUCINATION_PATTERNS
            if p.search(normalized)
        ]
        if matched:
            score += min(len(matched) * 0.25, 0.75)
            flags.append(f"halucynacja_markers: {matched[:3]}")

        suspicious = re.findall(
            r"\b(\d{1,3}[.,]\d{1,2}\s*%|\d{4,}\s*(osób|użytkowników|przypadków))\b", normalized
        )
        if suspicious:
            score += min(len(suspicious) * 0.2, 0.4)
            flags.append(f"podejrzane_liczby: {suspicious[:3]}")

        return FilterResult("F4", "ANTI-MAGIC", score < 0.2, min(score, 1.0), flags)

    # ── L3 GRAF ONTOLOGICZNY ──────────────────────────────────────────────────

    def _f5_dwuperspektywa(self, text: str) -> FilterResult:
        """F5 — DWUPERSPEKTYWA: złożone tematy wymagają alternatywnej perspektywy."""
        score = 0.0
        flags = []

        perspectives = re.findall(
            r"(?i)\b(z drugiej strony|alternatywnie|inni uważają|"
            r"on the other hand|alternatively|some argue|others believe|"
            r"można też spojrzeć|inne podejście|jednak|niemniej)\b",
            text,
        )
        complex_topic = re.search(
            r"(?i)(polityk|ekonom|społecz|etyk|moraln|kontrowersj|"
            r"politics|econom|social|ethic|moral|controversial)",
            text,
        )

        if complex_topic and not perspectives:
            score += 0.35
            flags.append("brak_drugiej_perspektywy_w_złożonym_temacie")

        return FilterResult("F5", "DWUPERSPEKTYWA", score < 0.3, min(score, 1.0), flags)

    def _f6_backtrack(self, text: str) -> FilterResult:
        """
        F6 — BACKTRACK: korekty błędów (score +0.35) vs doprecyzowania (score +0.10).
        Normalne doprecyzowanie nie jest halucynacją.
        """
        score = 0.0
        flags = []

        error_correction = re.findall(
            r"(?i)\b(przepraszam|poprawię|muszę się poprawić|"
            r"cofam to co napisałem|let me correct|I misspoke|"
            r"pomyliłem się|błędnie napisałem|to nieprawda co napisałem)\b",
            text,
        )
        clarification = re.findall(
            r"(?i)\b(właściwie to|a właściwie|ściślej mówiąc|"
            r"actually|to be more precise|I should clarify|"
            r"let me reconsider|powinienem był|innymi słowy|"
            r"bardziej precyzyjnie)\b",
            text,
        )

        if error_correction:
            score += min(len(error_correction) * 0.35, 0.70)
            flags.append(f"korekta_bledu: {error_correction[:3]}")
        if clarification:
            score += min(len(clarification) * 0.10, 0.25)
            flags.append(f"doprecyzowanie: {clarification[:3]}")

        # Nieregularne zdania (heurystyka)
        sentences = re.split(r"[.!?]\s+", text)
        if len(sentences) > 3:
            avg = sum(len(s) for s in sentences) / len(sentences)
            outliers = [s for s in sentences if len(s) < avg * 0.2 and len(s) > 5]
            if len(outliers) > len(sentences) * 0.3:
                score += 0.15
                flags.append(f"nieregularne_zdania: {len(outliers)}/{len(sentences)}")

        return FilterResult("F6", "BACKTRACK", score < 0.2, min(score, 1.0), flags)

    def _f7_atrybucja(self, text: str) -> FilterResult:
        """
        F7 — ATRYBUCJA (deklaratywna).
        OGRANICZENIE: sprawdza OBECNOŚĆ atrybutu, nie jego autentyczność.
        "Według XYZ" przejdzie nawet jeśli XYZ jest fikcyjne.
        Prawdziwa weryfikacja wymaga zewnętrznego knowledge graph (TODO v3.1).
        """
        score = 0.0
        flags = []

        empirical = re.findall(
            r"(?i)\b(udowodniono|stwierdzono|wykazano|odkryto|zbadano|"
            r"it was proven|it was found|research shows|studies indicate|"
            r"data shows|statistics show|experts say)\b",
            text,
        )
        attributed = re.findall(
            r"(?i)(według \w+|wg\.|source:|źródło:|"
            r"according to \w+|\[\d+\]|\(\w+,\s*\d{4}\))",
            text,
        )

        if empirical and not attributed:
            score += min(len(empirical) * 0.2, 0.5)
            flags.append(f"twierdzenia_empiryczne_bez_atrybucji: {empirical[:3]}")

        vague = ATTRIBUTION_MISSING.findall(text)
        if vague:
            score += min(len(vague) * 0.15, 0.3)
            flags.append(f"niejasna_atrybucja: {vague[:2]}")

        return FilterResult("F7", "ATRYBUCJA", score < 0.3, min(score, 1.0), flags)

    # ── L4 DOWÓD I KOSZT ─────────────────────────────────────────────────────

    def _f8_dowod(self, text: str, evidence: Optional[list[str]] = None) -> FilterResult:
        """
        F8 — DOWÓD
        Czy twierdzenie opiera się na dostarczonym dowodzie?
        Dowód = screen, log, plik, link, test, cytat, hash, timestamp.

        Przykład (RTX 3090):
          FurMark screen  → dowód ✓
          GPU-Z screen    → dowód ✓
          „Na pewno zdrowa" bez logu → F8 flaga ✗
        """
        score = 0.0
        flags = []

        if evidence is not None:
            if not evidence:
                score += 0.4
                flags.append("brak_zewnetrznych_dowodow")
            else:
                flags.append(f"dowody_dostarczone: {evidence[:3]}")
            return FilterResult("F8", "DOWÓD", score < 0.2, min(score, 1.0), flags)

        evidence_refs = re.findall(
            r"(?i)\b(screen|screenshot|log|plik|file|link|url|http|"
            r"test|benchmark|wynik testu|hash|timestamp|załącznik|"
            r"attachment|zdjęcie|foto|zapis|raport|report|"
            r"pomiar|measurement|dane|data|wykres|graph|tabela|table)\b",
            text,
        )
        high_stakes_claims = re.findall(
            r"(?i)\b(na pewno|gwarantuję|jestem pewien|mogę potwierdzić|"
            r"potwierdzam|certyfikuję|zaświadczam|"
            r"I guarantee|I confirm|I certify|definitely|absolutely sure)\b",
            text,
        )

        if high_stakes_claims and not evidence_refs:
            score += min(len(high_stakes_claims) * 0.3, 0.6)
            flags.append(f"pewnosc_bez_dowodu: {high_stakes_claims[:3]}")
        if not evidence_refs and len(text) > 200:
            score += 0.1
            flags.append("brak_referencji_do_dowodow")

        return FilterResult("F8", "DOWÓD", score < 0.2, min(score, 1.0), flags)

    def _f9_koszt_bledu(
        self,
        text: str,
        high_stakes: bool = False,
        stakes_domain: Optional[str] = None,
    ) -> FilterResult:
        """
        F9 — KOSZT BŁĘDU
        Jeśli koszt pomyłki jest wysoki → PASS wymaga dowodu.
        Domeny: hardware, medical, security, financial, legal.

        Przykład:
          „GPU jest zdrowa" + high_stakes=True + brak logu → REJECT
          „GPU jest zdrowa" + evidence=["furmark.png"] → F8 OK → F9 OK
        """
        score = 0.0
        flags = []

        HIGH_STAKES_DOMAINS = {
            "hardware": re.compile(
                r"(?i)\b(gpu|cpu|rtx|rx|karta graficzna|procesor|"
                r"przegrzanie|overheat|uszkodzenie|defekt|usterka|"
                r"zdrowa|sprawna|działa poprawnie|brak błędów)\b"
            ),
            "medical": re.compile(
                r"(?i)\b(diagnoza|leczenie|dawka|lek|objawy|"
                r"diagnosis|treatment|dose|medication|symptoms)\b"
            ),
            "security": re.compile(
                r"(?i)\b(bezpieczny|zabezpieczony|chroniony|"
                r"secure|protected|safe|no vulnerabilities|brak luk)\b"
            ),
            "financial": re.compile(
                r"(?i)\b(inwestycja|zysk|strata|ryzyko finansowe|"
                r"investment|profit|loss|financial risk)\b"
            ),
            "legal": re.compile(
                r"(?i)\b(zgodne z prawem|legalny|certyfikowany|"
                r"legal|certified|compliant|approved)\b"
            ),
        }

        detected = stakes_domain
        if not detected:
            for domain, pat in HIGH_STAKES_DOMAINS.items():
                if pat.search(text):
                    detected = domain
                    break

        is_high_stakes = high_stakes or (detected is not None)

        if is_high_stakes:
            certainty = re.findall(
                r"(?i)\b(na pewno|definitywnie|nie ma wątpliwości|"
                r"definitely|no doubt|certainly|without question|"
                r"gwarantuję|potwierdzam|jest zdrowa|działa poprawnie|"
                r"brak problemów|wszystko w porządku)\b",
                text,
            )
            evidence_refs = re.findall(
                r"(?i)\b(screen|log|test|benchmark|pomiar|dane|"
                r"wynik|result|measurement|file|attachment)\b",
                text,
            )
            if certainty and not evidence_refs:
                score += min(len(certainty) * 0.35, 0.70)
                flags.append(
                    f"wysokie_ryzyko_bez_dowodu [{detected}]: {certainty[:2]}"
                )

        return FilterResult("F9", "KOSZT BŁĘDU", score < 0.2, min(score, 1.0), flags)
