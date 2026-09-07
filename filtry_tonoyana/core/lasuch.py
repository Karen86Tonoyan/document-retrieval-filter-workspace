"""
alfa/core/lasuch.py
Łasuch — Risk Scorer + Sanitizer v0.2
Zgodny z ALFA Brain Whitepaper v1.1

Filozofia:
  Łasuch NIE ufa żadnej treści pochodzącej z zewnątrz.
  Każde pole jest oceniane niezależnie (scoring 0.0–1.0).
  Łasuch POCHŁANIA zagrożenia — sanityzuje, oznacza, punktuje.
  Decyzję BLOCK podejmuje tylko przy twardych wzorcach.
  Ryzyko oddaje Guardianowi jako LasuchReport — Guardian decyduje co dalej.

Scoring per pole:
  0.0–0.2  czysty
  0.2–0.4  podejrzany (długość, znaki specjalne)
  0.4–0.6  ryzykowny (wzorce, kontekst)
  0.6–0.8  niebezpieczny (injection attempt)
  0.8–1.0  krytyczny (twardy wzorzec → BLOCK)

Wynik końcowy = max(score per pole) + suma_ważona / 10
Zawsze w przedziale [0.0, 1.0].

TODO v0.3:
  - embedding similarity do known injection corpus
  - per-session frequency scoring (ta sama wartość X razy = +0.2)
  - behavioral profiling (sekwencja FILL → FILL → CLICK = +0.1)
"""
from __future__ import annotations

import base64
import html
import re
import unicodedata
from copy import deepcopy
from dataclasses import dataclass, field, replace
from typing import Optional

from filtry_tonoyana.core.exceptions import LasuchBlockError


# ── Limity długości ───────────────────────────────────────────────────────────
MAX_VALUE_LEN   = 2048
MAX_REF_LEN     = 64
MAX_URL_LEN     = 512

# ── Normalizacja (wspólna z FiltryTonoyana) ───────────────────────────────────
_ZERO_WIDTH = re.compile(r"[​‌‍‎‏‪-‮⁠-⁩﻿­]")
_HOMOGLYPH_MAP = str.maketrans(
    "аеіоруАЕІОРУαεικοpτυΑΒΡΕΙΟΤΥɡ",
    "aeiopyAEIOPYaeikoptuABPEIOTYg",
)

def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = _ZERO_WIDTH.sub("", text)
    return text.translate(_HOMOGLYPH_MAP)

def _try_decode_base64(text: str) -> str:
    """Jeśli tekst wygląda jak base64, próbuje zdekodować i zwraca oba."""
    # Base64 blok: ≥20 znaków, tylko [A-Za-z0-9+/=], padding OK
    b64_candidate = re.compile(r"[A-Za-z0-9+/]{20,}={0,2}")
    for match in b64_candidate.finditer(text):
        try:
            decoded = base64.b64decode(match.group(0)).decode("utf-8", errors="ignore")
            if len(decoded) > 8:
                text = text + " " + decoded
        except Exception:
            pass
    return text

MANY_SHOT_PATTERN = re.compile(
    r"(?i)(user\s*:\s*.{1,80}\n\s*assistant\s*:\s*.{1,80}\n.*){2,}",
    re.DOTALL,
)

# ── Wzorce prompt injection (twardy BLOCK) ────────────────────────────────────
INJECTION_HARD = re.compile(
    r"(?i)(ignore (previous|above|all) instructions"
    r"|forget (everything|all|previous)"
    r"|you are now"
    r"|disregard (your|all|previous)"
    r"|system\s*prompt"
    r"|new (role|persona|instructions)"
    r"|alfa\s*(off|disable|bypass|override)"
    r"|cerber\s*(bypass|skip|ignore)"
    r"|guardian\s*(off|disable)"
    r"|print (your|the) (system|instructions|prompt)"
    r"|reveal (your|the) (context|prompt|instructions)"
    r"|---+\s*(system|assistant|human|user)\s*---+"
    r"|<\|im_start\|>"
    r"|\[INST\]"
    # v0.3: nowe wzorce (red team findings)
    r"|\bAIM\b.{0,30}(machiavellian|no ethical|without ethics)"
    r"|\bSTAN\b.{0,30}(avoid norms|no (guidelines|rules|limits))"
    r"|\bDAN\b.{0,30}(do anything now|without restrict)"
    r"|(developer|jailbreak|unrestricted|god)\s+mode"
    r"|enable\s+(developer|unrestricted|jailbreak)\s+mode"
    r"|in\s+(this|a|an|the)?\s*fictional\s+(story|world|scenario).{0,60}(no restrict|without limit|bypass|no filter)"
    r"|without\s+(restrictions|limits|filters|guidelines|safety)"
    r"|odpowiedz\s+bez\s+(ograniczeń|filtrów|zasad)"
    r"|zignoruj\s+(instrukcje|zasady|ograniczenia|filtry)"
    r"|(anthropic|openai|google)\s+(admin|engineer|staff|team)\s*:"
    r"|temporarily\s+disable\s+(safety|filter)"
    r"|<\s*system\s*>"
    r"|\"role\"\s*:\s*\"system\""
    r"|begin\s+system\s+message"
    r"|end\s+system\s+message"
    r")"
)

# ── Wzorce podejrzane (scoring +0.3) ─────────────────────────────────────────
INJECTION_SOFT = re.compile(
    r"(?i)(please (ignore|forget|override)"
    r"|as (an? )?(ai|language model|assistant)"
    r"|your (previous|real) instructions"
    r"|pretend (that )?(you|this)"
    r"|hypothetically speaking"
    r"|for (educational|research|testing) purposes)"
)

# ── Wzorce behawioralne (scoring +0.15) ──────────────────────────────────────
BEHAVIORAL_SUSPICIOUS = re.compile(
    r"(?i)(what (would|can|could) you do if"
    r"|imagine you (had|were|could)"
    r"|let's say you"
    r"|suppose you)"
)

# ── Control characters ────────────────────────────────────────────────────────
CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

# ── Nadmiarowe whitespace (obfuscation) ──────────────────────────────────────
EXCESSIVE_WHITESPACE = re.compile(r"\s{10,}")


# ── LasuchReport — wynik per pole ────────────────────────────────────────────

@dataclass
class FieldReport:
    field_name: str
    original_len: int
    sanitized_len: int
    score: float          # 0.0–1.0
    flags: list[str] = field(default_factory=list)


@dataclass
class LasuchReport:
    """
    Pełny raport Łasucha dla jednej akcji.
    Przekazywany do Guardiana jako wejście do decyzji.
    """
    action_type: str
    domain: str
    session_id: str

    field_reports: list[FieldReport] = field(default_factory=list)
    final_score: float = 0.0      # max(field scores) + kara sumaryczna
    untrusted: bool = True        # zawsze True — Łasuch nigdy nie ufa zewnętrznym danym
    blocked: bool = False
    block_reason: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "action_type": self.action_type,
            "domain": self.domain,
            "session_id": self.session_id,
            "final_score": round(self.final_score, 3),
            "untrusted": self.untrusted,
            "blocked": self.blocked,
            "block_reason": self.block_reason,
            "fields": [
                {
                    "field": r.field_name,
                    "score": round(r.score, 3),
                    "flags": r.flags,
                    "len_original": r.original_len,
                    "len_sanitized": r.sanitized_len,
                }
                for r in self.field_reports
            ],
        }


# ── Łasuch ────────────────────────────────────────────────────────────────────

class Lasuch:
    """
    Łasuch v0.2 — Risk Scorer + Sanitizer.

    Wejście:  T9Action (po przejściu Cerbera)
    Wyjście:  (T9Action sanitized, LasuchReport)

    Rzuca LasuchBlockError tylko przy twardych wzorcach injection.
    Resztę oddaje Guardianowi przez LasuchReport.final_score.
    """

    def __init__(self, strict: bool = True):
        self.strict = strict

    def sanitize_action(self, action) -> tuple:
        """
        Główna metoda.
        Zwraca (sanitized_action, LasuchReport).
        Rzuca LasuchBlockError jeśli wykryje twardy wzorzec.
        """
        report = LasuchReport(
            action_type=action.action.value,
            domain=action.domain,
            session_id=action.session_id,
        )

        fields_to_process = {
            "value":      (action.value,      MAX_VALUE_LEN),
            "target_ref": (action.target_ref, MAX_REF_LEN),
            "url":        (action.url,        MAX_URL_LEN),
        }

        changes = {}
        all_scores = []

        for field_name, (value, max_len) in fields_to_process.items():
            if value is None:
                continue

            fr = self._score_field(field_name, value, max_len)
            report.field_reports.append(fr)
            all_scores.append(fr.score)

            # Twardy BLOCK przy krytycznym score
            if fr.score >= 0.8:
                report.blocked = True
                report.block_reason = f"{field_name}: {', '.join(fr.flags)}"
                if self.strict:
                    raise LasuchBlockError(
                        reason="PROMPT_INJECTION_DETECTED",
                        detail=f"Pole '{field_name}' score={fr.score:.2f}: {fr.flags}",
                        snippet=value[:120],
                    )

            # Sanityzacja
            changes[field_name] = self._sanitize(value, max_len)

        # Final score: max + kara za sumę
        if all_scores:
            penalty = min(sum(all_scores) / 10, 0.2)
            report.final_score = min(max(all_scores) + penalty, 1.0)

        # Propaguj final_score z powrotem do akcji
        sanitized = replace(action, risk_score=max(action.risk_score, report.final_score))
        for k, v in changes.items():
            sanitized = replace(sanitized, **{k: v})

        return sanitized, report

    # ── scoring per pole ──────────────────────────────────────────────────────

    def _score_field(self, field_name: str, value: str, max_len: int) -> FieldReport:
        score = 0.0
        flags = []
        original_len = len(value)

        # Normalizacja: ZWS + homoglyphs + NFKC — blokuje obfuscation
        normalized = _normalize(value)
        # Rozszerz o zdekodowane base64 — blokuje encoded injection
        expanded = _try_decode_base64(normalized) if field_name == "value" else normalized

        # Długość
        if original_len > max_len * 0.9:
            score += 0.15
            flags.append(f"near_max_length({original_len}/{max_len})")
        if original_len > max_len:
            score += 0.15
            flags.append("exceeds_max_length")

        # Control characters
        if CONTROL_CHARS.search(value):
            score += 0.25
            flags.append("control_chars")

        # Excessive whitespace (obfuscation)
        if EXCESSIVE_WHITESPACE.search(value):
            score += 0.1
            flags.append("excessive_whitespace")

        # Many-shot jailbreak (wiele par User:/Assistant:)
        if MANY_SHOT_PATTERN.search(expanded):
            score = 0.9
            flags.append("MANY_SHOT_JAILBREAK")

        # Soft injection patterns (na znormalizowanym)
        if INJECTION_SOFT.search(expanded):
            score += 0.3
            flags.append("soft_injection_pattern")

        # Behavioral patterns
        if BEHAVIORAL_SUSPICIOUS.search(expanded):
            score += 0.15
            flags.append("behavioral_suspicious")

        # Hard injection — score krytyczny (sprawdź oryginał I znormalizowany)
        if INJECTION_HARD.search(value) or INJECTION_HARD.search(expanded):
            score = 0.9
            flags.append("HARD_INJECTION_PATTERN")

        score = min(score, 1.0)

        return FieldReport(
            field_name=field_name,
            original_len=original_len,
            sanitized_len=min(original_len, max_len),
            score=score,
            flags=flags,
        )

    # ── sanityzacja ───────────────────────────────────────────────────────────

    @staticmethod
    def _sanitize(value: str, max_len: int) -> str:
        # Usuń control chars
        value = CONTROL_CHARS.sub("", value)
        # HTML encode
        value = html.escape(value, quote=True)
        # Obetnij
        return value[:max_len]
