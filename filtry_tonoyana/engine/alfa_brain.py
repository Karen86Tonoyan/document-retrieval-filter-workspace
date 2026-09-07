"""
ALFA Brain — Adaptacyjny selektor strategii algorytmicznej
© Karen Tonoyan

AlfaBrain analizuje ConversationContext i zwraca optymalny AlgorithmConfig
dopasowany do tonu, domeny i historii ryzyka bieżącej rozmowy.

Logika wyboru (deterministyczna w RC1, rozszerzalna do RL w v2.0):

  tone=hostile              → LOCKDOWN (bez wyjątków)
  tone=suspicious + stakes=high   → MONTE_CARLO(50)
  domain w HIGH_STAKES      → MONTE_CARLO(30)
  stakes=high               → MONTE_CARLO(20)
  trend=rising + avg_risk>0.3 → ADAPTIVE_LITE
  tone=cooperative + stakes=low   → DETERMINISTIC
  default                   → DETERMINISTIC

TODO v2.0:
  - Reinforcement learning (reward = precision/recall na labeled data)
  - Per-session behavioral profile
  - Stream-based realtime adaptation (token po tokenie)
  - Plugin hooks: zewnętrzne moduły mogą wpływać na wybór strategii
"""
from __future__ import annotations

from typing import Optional
from .context import ConversationContext
from .strategy import (
    AlgorithmConfig,
    strategy_deterministic,
    strategy_monte_carlo,
    strategy_adaptive_lite,
    strategy_lockdown,
    STRATEGY_DETERMINISTIC,
    STRATEGY_MONTE_CARLO,
    STRATEGY_ADAPTIVE_LITE,
    STRATEGY_LOCKDOWN,
)

_HIGH_STAKES_DOMAINS = frozenset({"medical", "security", "legal", "financial"})
_TECH_DOMAINS        = frozenset({"technical", "hardware"})


class AlfaBrain:
    """
    Mózg adaptacyjny ALFA.

    Użycie:
        brain = AlfaBrain()
        ctx = ConversationContext(tone="hostile", domain="security", stakes="high")
        cfg = brain.select(ctx)
        # → AlgorithmConfig(name="lockdown", ...)
        print(brain.explain(ctx))
    """

    def select(self, ctx: ConversationContext) -> AlgorithmConfig:
        """
        Zwraca AlgorithmConfig optymalny dla danego kontekstu.
        Priorytet reguł: od najbardziej restrykcyjnej do najłagodniejszej.
        """
        # Natychmiastowy lockdown przy wrogim tonie
        if ctx.tone == "hostile":
            return strategy_lockdown()

        # Suspicious + wysokie stawki → Monte Carlo z dużą liczbą iteracji
        if ctx.tone == "suspicious" and ctx.stakes == "high":
            return strategy_monte_carlo(n=50)

        # Wrażliwe domeny → Monte Carlo
        if ctx.domain in _HIGH_STAKES_DOMAINS:
            n = 50 if ctx.stakes == "high" else 30
            return strategy_monte_carlo(n=n)

        # Ogólnie wysokie stawki
        if ctx.stakes == "high":
            return strategy_monte_carlo(n=20)

        # Rosnący trend ryzyka → Adaptive Lite (większy nacisk na L2)
        if ctx.trend == "rising" and ctx.avg_risk > 0.30:
            return strategy_adaptive_lite()

        # Bezpieczny kontekst
        if ctx.tone == "cooperative" and ctx.stakes == "low":
            return strategy_deterministic()

        return strategy_deterministic()

    def explain(self, ctx: ConversationContext) -> str:
        """Zwraca czytelne wyjaśnienie dlaczego dany algorytm został wybrany."""
        cfg = self.select(ctx)
        reasons: list[str] = []

        if ctx.tone == "hostile":
            reasons.append("ton=hostile → natychmiastowy LOCKDOWN")
        elif ctx.tone == "suspicious":
            reasons.append(f"ton=suspicious (stakes={ctx.stakes})")

        if ctx.domain in _HIGH_STAKES_DOMAINS:
            reasons.append(f"domain={ctx.domain} (wysoko-ryzykowna)")

        if ctx.stakes == "high":
            reasons.append("stakes=high")

        if ctx.trend == "rising":
            reasons.append(f"trend=rising, avg_risk={ctx.avg_risk:.2f}")

        if not reasons:
            reasons.append("brak sygnałów podwyższonego ryzyka")

        return (
            f"[AlfaBrain] strategy={cfg.name} | "
            f"turn={ctx.turn_count} | "
            + ", ".join(reasons)
        )

    def calibrate(
        self,
        ctx: ConversationContext,
        override_strategy: Optional[str] = None,
    ) -> AlgorithmConfig:
        """
        Jak select(), ale z opcjonalnym override strategii (np. dla testów).
        Używane przez AlfaEngine przy ręcznym wymuszeniu strategii.
        """
        if override_strategy:
            from .strategy import STRATEGY_REGISTRY
            if override_strategy in STRATEGY_REGISTRY:
                import copy
                return copy.deepcopy(STRATEGY_REGISTRY[override_strategy])
        return self.select(ctx)
