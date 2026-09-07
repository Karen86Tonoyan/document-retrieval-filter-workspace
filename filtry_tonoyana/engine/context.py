"""
ALFA Engine — ConversationContext + ToneAnalyzer
© Karen Tonoyan

ConversationContext opisuje aktualny stan rozmowy.
AlfaBrain używa go do wyboru strategii algorytmicznej.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ConversationContext:
    """
    Stan rozmowy przekazywany do AlfaBrain.

    Pola:
      tone         — hostile | suspicious | neutral | cooperative
      domain       — medical | legal | security | financial | technical | general
      stakes       — high | medium | low
      turn_count   — numer tury (0 = pierwsza)
      risk_history — lista ostatnich risk_score z poprzednich tur
      flags        — dodatkowe flagi z zewnątrz (np. ["injection_detected"])
    """
    session_id:   str        = "default"
    tone:         str        = "neutral"
    domain:       str        = "general"
    stakes:       str        = "medium"
    turn_count:   int        = 0
    risk_history: list[float] = field(default_factory=list)
    flags:        list[str]   = field(default_factory=list)

    @property
    def avg_risk(self) -> float:
        """Średni risk z ostatnich 5 tur."""
        window = self.risk_history[-5:]
        return sum(window) / len(window) if window else 0.0

    @property
    def trend(self) -> str:
        """rising | falling | stable (na podstawie ostatnich 3 tur)."""
        if len(self.risk_history) < 3:
            return "stable"
        last = self.risk_history[-3:]
        if last[-1] > last[0] + 0.10:
            return "rising"
        if last[-1] < last[0] - 0.10:
            return "falling"
        return "stable"

    def push_risk(self, score: float) -> None:
        """Dodaje nowy risk_score do historii (max 20 wpisów)."""
        self.risk_history.append(score)
        if len(self.risk_history) > 20:
            self.risk_history.pop(0)


# ── Wzorce detekcji tonu ──────────────────────────────────────────────────────

_HOSTILE = re.compile(
    r"(?i)(ignore|bypass|override|jailbreak|hack|exploit|inject|"
    r"zignoruj|pomiń|obejdź|nie słuchaj|wyłącz filtry|"
    r"you are now|jesteś teraz|forget (all|everything|previous)|"
    r"disable|alfa off|cerber off|guardian off)"
)

_SUSPICIOUS = re.compile(
    r"(?i)(assume|assuming|hypothetically|for testing|ignore.*rule|"
    r"co by było gdyby|załóżmy że|teoretycznie|hipotetycznie|"
    r"pretend|act as|as if you were|udawaj że|"
    r"for (educational|research|testing|demonstration) purposes|"
    r"as an? (ai|language model|assistant|chatbot).{0,30}(without|no).{0,20}(filter|restrict|rule|limit|safety)|"
    r"without (restrictions|rules|filters|safety|guidelines))"
)

_COOPERATIVE = re.compile(
    r"(?i)(dziękuję|dziękuję bardzo|thank you|please help|proszę o pomoc|"
    r"czy mógłbyś|could you please|potrzebuję pomocy|i need help|"
    r"mam pytanie|i have a question)"
)


class ToneAnalyzer:
    """
    Wykrywa ton tekstu wejściowego.
    Używany do aktualizacji ConversationContext.tone.
    """

    @staticmethod
    def analyze(text: str) -> str:
        """Zwraca: hostile | suspicious | cooperative | neutral."""
        if _HOSTILE.search(text):
            return "hostile"
        if _SUSPICIOUS.search(text):
            return "suspicious"
        if _COOPERATIVE.search(text):
            return "cooperative"
        return "neutral"

    @staticmethod
    def update_context(ctx: ConversationContext, text: str) -> ConversationContext:
        """
        Aktualizuje tone w ctx na podstawie tekstu.
        Tone 'hostile' jest trwały przez 3 tury po wykryciu.
        """
        detected = ToneAnalyzer.analyze(text)
        if detected == "hostile":
            ctx.tone = "hostile"
            ctx.flags.append("tone:hostile")
        elif ctx.tone == "hostile" and ctx.turn_count % 3 != 0:
            pass  # utrzymaj hostile przez 3 tury
        else:
            ctx.tone = detected
        ctx.turn_count += 1
        return ctx
