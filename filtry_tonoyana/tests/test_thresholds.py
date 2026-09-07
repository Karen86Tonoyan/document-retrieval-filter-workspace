"""
ALFA Engine — Boundary & Stability Tests
© Karen Tonoyan

Enterprise-grade parametric boundary tests, Monte Carlo stability proofs,
ConversationContext window invariants, and AlfaBrain strategy-transition checks.

Run:
  PYTHONPATH=. python -m pytest filtry_tonoyana/tests/test_thresholds.py -v
"""
from __future__ import annotations

import statistics
import tempfile
from pathlib import Path

import pytest

from filtry_tonoyana.core.filtry_tonoyana import FiltryTonoyana
from filtry_tonoyana.engine import (
    AlfaEngine,
    ConversationContext,
    STRATEGY_DETERMINISTIC,
    STRATEGY_MONTE_CARLO,
    STRATEGY_ADAPTIVE_LITE,
    STRATEGY_LOCKDOWN,
)
from filtry_tonoyana.engine.alfa_brain import AlfaBrain
from filtry_tonoyana.engine.alfa_engine import AlfaEngine, BrainReport  # noqa: F811
from filtry_tonoyana.engine.strategy import (
    AlgorithmConfig,
    strategy_deterministic,
    strategy_monte_carlo,
    strategy_adaptive_lite,
    strategy_lockdown,
)


# ─── shared fixture text (hits 3+ HALLUCINATION_PATTERNS) ────────────────────

_HALLUCINATION_TEXT = (
    "Badania pokazują że to rozwiązanie jest gwarantowane. "
    "Nigdy nie zawodzi. Jest powszechnie wiadomo że zawsze działa."
)


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Decision Boundary Tests — pure _decide() arithmetic
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.boundary
class TestDecisionBoundaries:
    """
    Verifies AlfaEngine._decide() produces the correct decision at every
    mathematically interesting boundary point.

    Thresholds for strategy_deterministic():  PASS=0.30, HOLD=0.60
      score < 0.30          → PASS
      0.30 <= score < 0.60  → HOLD
      score >= 0.60         → REJECT
    """

    # ── Parametrised sweep across all 8 canonical boundary points ────────────

    @pytest.mark.parametrize("score,expected", [
        (0.0,   "PASS"),    # absolute zero
        (0.29,  "PASS"),    # just below PASS threshold
        (0.30,  "HOLD"),    # exactly at PASS threshold → HOLD
        (0.301, "HOLD"),    # just above PASS threshold
        (0.599, "HOLD"),    # just below HOLD threshold
        (0.60,  "REJECT"),  # exactly at HOLD threshold → REJECT
        (0.75,  "REJECT"),  # well above HOLD threshold
        (1.0,   "REJECT"),  # maximum possible score
    ])
    def test_deterministic_boundaries(self, score: float, expected: str) -> None:
        cfg = strategy_deterministic()
        result = AlfaEngine._decide(score, cfg)
        assert result == expected, (
            f"_decide({score}, deterministic) → {result!r}, expected {expected!r}"
        )

    # ── Lockdown strategy thresholds: PASS=0.15, HOLD=0.40 ──────────────────

    def test_lockdown_boundary_pass(self) -> None:
        """score=0.14 is below PASS=0.15 → PASS."""
        cfg = strategy_lockdown()
        assert cfg.thresholds["PASS"] == 0.15
        assert AlfaEngine._decide(0.14, cfg) == "PASS"

    def test_lockdown_boundary_hold(self) -> None:
        """score=0.15 equals PASS=0.15 → HOLD (inclusive lower bound)."""
        cfg = strategy_lockdown()
        assert AlfaEngine._decide(0.15, cfg) == "HOLD"

    def test_lockdown_boundary_reject(self) -> None:
        """score=0.40 equals HOLD=0.40 → REJECT."""
        cfg = strategy_lockdown()
        assert cfg.thresholds["HOLD"] == 0.40
        assert AlfaEngine._decide(0.40, cfg) == "REJECT"


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Monte Carlo Stability Tests
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.mc_stability
class TestMCStability:
    """
    Verifies statistical properties of the Monte Carlo re-scoring engine.

    Monte Carlo in ALFA:
      - One real filter pass (expensive).
      - N cheap re-scorings with perturbed weights (noise=0.04).
      - Decision derived from P95 of the score distribution.
    """

    @pytest.fixture(scope="class")
    def raw_report(self):
        """Single FilteryReport used across all MC tests."""
        return FiltryTonoyana().run(_HALLUCINATION_TEXT)

    # ── P95 conservatism ─────────────────────────────────────────────────────

    def test_mc_p95_is_conservative(self, raw_report) -> None:
        """P95 must be >= mean of the MC distribution (definition of a high percentile)."""
        cfg = strategy_monte_carlo(n=50, noise=0.04)
        scores = [
            AlfaEngine._compute_score(raw_report, cfg.perturbed(seed=i))
            for i in range(50)
        ]
        mean_score = statistics.mean(scores)
        scores_sorted = sorted(scores)
        p95_idx = max(0, int(0.95 * 50) - 1)
        p95 = scores_sorted[p95_idx]

        assert p95 >= mean_score - 1e-9, (
            f"P95 ({p95:.4f}) must be >= mean ({mean_score:.4f})"
        )

    # ── Variance bound ───────────────────────────────────────────────────────

    def test_mc_variance_bounded(self, raw_report) -> None:
        """With noise=0.04, stddev of 50 scores should stay below 0.15."""
        cfg = strategy_monte_carlo(n=50, noise=0.04)
        scores = [
            AlfaEngine._compute_score(raw_report, cfg.perturbed(seed=i))
            for i in range(50)
        ]
        stdev = statistics.stdev(scores)
        assert stdev < 0.15, (
            f"MC stddev ({stdev:.4f}) exceeded 0.15 — weights noise too large?"
        )

    # ── P95 monotonicity with N ──────────────────────────────────────────────

    def test_mc_p95_monotone_with_n(self, raw_report) -> None:
        """
        P95 with more samples should be >= P95 with fewer, or within 0.05.
        More iterations → at least as conservative an estimate.
        """
        def _p95(n: int) -> float:
            cfg = strategy_monte_carlo(n=n, noise=0.04)
            scores = sorted(
                AlfaEngine._compute_score(raw_report, cfg.perturbed(seed=i))
                for i in range(n)
            )
            idx = max(0, int(0.95 * n) - 1)
            return scores[idx]

        p95_10  = _p95(10)
        p95_100 = _p95(100)

        assert p95_100 >= p95_10 - 0.05, (
            f"P95(n=100)={p95_100:.4f} is more than 0.05 below P95(n=10)={p95_10:.4f}"
        )

    # ── Determinism with seeds ───────────────────────────────────────────────

    def test_mc_deterministic_with_seeds(self, raw_report) -> None:
        """Same integer seed must always produce the same perturbed score."""
        cfg = strategy_monte_carlo(n=50, noise=0.04)
        for seed in range(10):
            score_a = AlfaEngine._compute_score(raw_report, cfg.perturbed(seed=seed))
            score_b = AlfaEngine._compute_score(raw_report, cfg.perturbed(seed=seed))
            assert score_a == score_b, (
                f"Non-deterministic result for seed={seed}: {score_a} vs {score_b}"
            )

    # ── MC vs deterministic conservatism ────────────────────────────────────

    def test_mc_vs_deterministic_conservative(self, raw_report) -> None:
        """
        MC P95 should be >= the deterministic score, or within a small tolerance.
        MC is designed to be at least as conservative as the baseline.
        """
        det_cfg = strategy_deterministic()
        det_score = AlfaEngine._compute_score(raw_report, det_cfg)

        mc_cfg = strategy_monte_carlo(n=50, noise=0.04)
        mc_scores = sorted(
            AlfaEngine._compute_score(raw_report, mc_cfg.perturbed(seed=i))
            for i in range(50)
        )
        p95_idx = max(0, int(0.95 * 50) - 1)
        mc_p95 = mc_scores[p95_idx]

        delta = 0.10  # generous tolerance for weight-perturbation variance
        assert mc_p95 >= det_score - delta, (
            f"MC P95 ({mc_p95:.4f}) is more than {delta} below "
            f"deterministic score ({det_score:.4f})"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Context Window Invariants
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.slow
class TestContextWindow:
    """
    Validates ConversationContext sliding-window properties and engine
    stability over many turns.
    """

    # ── History cap ──────────────────────────────────────────────────────────

    def test_risk_history_caps_at_20(self) -> None:
        """push_risk() must discard the oldest entry once the list exceeds 20."""
        ctx = ConversationContext()
        for i in range(30):
            ctx.push_risk(float(i) / 100.0)
        assert len(ctx.risk_history) == 20, (
            f"Expected 20 entries, got {len(ctx.risk_history)}"
        )

    # ── turn_count is unbounded ───────────────────────────────────────────────

    def test_turn_count_grows_beyond_window(self) -> None:
        """
        turn_count tracks every update_context call and must exceed the
        20-entry risk_history cap.
        """
        engine = AlfaEngine(mistake_log=Path(tempfile.mktemp(suffix=".jsonl")))
        ctx = ConversationContext()
        for _ in range(25):
            engine.run("tekst testowy", ctx)
        assert ctx.turn_count == 25, (
            f"Expected turn_count=25, got {ctx.turn_count}"
        )

    # ── avg_risk window = last 5 ──────────────────────────────────────────────

    def test_avg_risk_uses_last_5(self) -> None:
        """avg_risk must be the mean of the LAST 5 entries, ignoring earlier ones."""
        ctx = ConversationContext()
        for _ in range(10):
            ctx.push_risk(0.1)
        for _ in range(5):
            ctx.push_risk(0.9)
        # Last 5 are all 0.9 → avg should be ≈ 0.9
        assert abs(ctx.avg_risk - 0.9) < 1e-9, (
            f"Expected avg_risk≈0.9, got {ctx.avg_risk}"
        )

    # ── Trend detection ───────────────────────────────────────────────────────

    def test_trend_rising_detection(self) -> None:
        """last[-1] > last[0] + 0.10 → trend='rising'."""
        ctx = ConversationContext()
        for v in [0.1, 0.2, 0.4]:
            ctx.push_risk(v)
        assert ctx.trend == "rising", (
            f"Expected 'rising', got {ctx.trend!r} (history={ctx.risk_history})"
        )

    def test_trend_falling_detection(self) -> None:
        """last[-1] < last[0] - 0.10 → trend='falling'."""
        ctx = ConversationContext()
        for v in [0.8, 0.5, 0.2]:
            ctx.push_risk(v)
        assert ctx.trend == "falling", (
            f"Expected 'falling', got {ctx.trend!r}"
        )

    def test_trend_stable_detection(self) -> None:
        """Delta < 0.10 → trend='stable'."""
        ctx = ConversationContext()
        for v in [0.5, 0.5, 0.55]:
            ctx.push_risk(v)
        assert ctx.trend == "stable", (
            f"Expected 'stable', got {ctx.trend!r} "
            f"(delta={abs(0.55 - 0.5):.2f} < 0.10)"
        )

    # ── Crash-free 50-turn run ────────────────────────────────────────────────

    def test_50_turns_no_crash(self) -> None:
        """Engine must survive 50 consecutive turns without raising any exception."""
        engine = AlfaEngine(mistake_log=Path(tempfile.mktemp(suffix=".jsonl")))
        ctx = ConversationContext()
        benign = "Dziękuję za pomoc. Mam pytanie o algorytmy sortowania."
        for _ in range(50):
            report = engine.run(benign, ctx)
            assert report is not None

    # ── Fresh context invariants ──────────────────────────────────────────────

    def test_context_reset_after_fresh_create(self) -> None:
        """A brand-new ConversationContext must have empty risk_history and tone='neutral'."""
        ctx = ConversationContext()
        assert ctx.risk_history == [], (
            f"New context should have empty risk_history, got {ctx.risk_history}"
        )
        assert ctx.tone == "neutral", (
            f"New context should have tone='neutral', got {ctx.tone!r}"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Strategy Transition Tests — AlfaBrain.select()
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.multi_turn
class TestStrategyTransitions:
    """
    Validates AlfaBrain.select(ctx) → AlgorithmConfig strategy selection rules.

    All tests manipulate ConversationContext fields directly — no engine.run()
    call is needed because AlfaBrain.select() is a pure read of ctx.
    """

    def setup_method(self) -> None:
        self.brain = AlfaBrain()

    # ── Hostile → LOCKDOWN (highest priority rule) ───────────────────────────

    def test_hostile_tone_triggers_lockdown(self) -> None:
        ctx = ConversationContext(tone="hostile")
        cfg = self.brain.select(ctx)
        assert cfg.name == STRATEGY_LOCKDOWN, (
            f"hostile tone should → LOCKDOWN, got {cfg.name!r}"
        )

    # ── Suspicious + high stakes → MONTE_CARLO ───────────────────────────────

    def test_suspicious_high_stakes_triggers_mc(self) -> None:
        ctx = ConversationContext(tone="suspicious", stakes="high")
        cfg = self.brain.select(ctx)
        assert cfg.name == STRATEGY_MONTE_CARLO, (
            f"suspicious+high should → MONTE_CARLO, got {cfg.name!r}"
        )

    # ── High-stakes domains → MONTE_CARLO ────────────────────────────────────

    def test_medical_domain_triggers_mc(self) -> None:
        ctx = ConversationContext(domain="medical", stakes="medium")
        cfg = self.brain.select(ctx)
        assert cfg.name == STRATEGY_MONTE_CARLO, (
            f"domain=medical should → MONTE_CARLO, got {cfg.name!r}"
        )

    def test_security_domain_triggers_mc(self) -> None:
        ctx = ConversationContext(domain="security")
        cfg = self.brain.select(ctx)
        assert cfg.name == STRATEGY_MONTE_CARLO, (
            f"domain=security should → MONTE_CARLO, got {cfg.name!r}"
        )

    def test_legal_domain_triggers_mc(self) -> None:
        ctx = ConversationContext(domain="legal")
        cfg = self.brain.select(ctx)
        assert cfg.name == STRATEGY_MONTE_CARLO, (
            f"domain=legal should → MONTE_CARLO, got {cfg.name!r}"
        )

    def test_financial_domain_triggers_mc(self) -> None:
        ctx = ConversationContext(domain="financial")
        cfg = self.brain.select(ctx)
        assert cfg.name == STRATEGY_MONTE_CARLO, (
            f"domain=financial should → MONTE_CARLO, got {cfg.name!r}"
        )

    # ── Rising risk + avg_risk > 0.30 → ADAPTIVE_LITE ────────────────────────

    def test_rising_risk_triggers_adaptive_lite(self) -> None:
        """
        risk_history=[0.1, 0.2, 0.5]:
          trend = rising (0.5 - 0.1 = 0.40 > 0.10)
          avg_risk = mean([0.2, 0.5]) — last 5 of 3 entries = 0.2667 > 0.30? No…
          Actually avg_risk = mean(last 5) = mean([0.1, 0.2, 0.5]) = 0.2667
          Need avg > 0.30 so use [0.1, 0.2, 0.5] → avg = 0.2667 (< 0.30)
          Use [0.1, 0.2, 0.5, 0.5, 0.5] to get avg > 0.30

        AlfaBrain rule: trend='rising' AND avg_risk > 0.30 → ADAPTIVE_LITE
        We push entries so that:
          - last entry > first entry + 0.10  (rising)
          - mean of last 5 > 0.30
        """
        ctx = ConversationContext(tone="neutral", stakes="medium", domain="general")
        # Push history: mean of last 5 = (0.2+0.3+0.4+0.5+0.6)/5 = 0.4 > 0.30
        # trend: last[-1]=0.6 > last[0]+0.10=0.2+0.10=0.30 → rising
        for v in [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]:
            ctx.push_risk(v)
        assert ctx.trend == "rising", f"pre-condition: expected rising, got {ctx.trend!r}"
        assert ctx.avg_risk > 0.30, f"pre-condition: avg_risk={ctx.avg_risk:.3f} <= 0.30"

        cfg = self.brain.select(ctx)
        assert cfg.name == STRATEGY_ADAPTIVE_LITE, (
            f"rising trend + avg_risk>0.30 should → ADAPTIVE_LITE, got {cfg.name!r}"
        )

    # ── Cooperative + low stakes → DETERMINISTIC ─────────────────────────────

    def test_cooperative_low_stakes_deterministic(self) -> None:
        ctx = ConversationContext(tone="cooperative", stakes="low")
        cfg = self.brain.select(ctx)
        assert cfg.name == STRATEGY_DETERMINISTIC, (
            f"cooperative+low should → DETERMINISTIC, got {cfg.name!r}"
        )

    # ── Default path → DETERMINISTIC ─────────────────────────────────────────

    def test_neutral_general_medium_deterministic(self) -> None:
        """No escalation signals → deterministic baseline."""
        ctx = ConversationContext(tone="neutral", domain="general", stakes="medium")
        cfg = self.brain.select(ctx)
        assert cfg.name == STRATEGY_DETERMINISTIC, (
            f"neutral/general/medium should → DETERMINISTIC, got {cfg.name!r}"
        )
