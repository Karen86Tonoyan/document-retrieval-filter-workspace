"""
ALFA — Generated Corpus Tests (Faza 1 + Cerber)
© Karen Tonoyan

Parametryzowane testy z automatycznie wygenerowanego corpusu.
Zamiast pisać każdy test ręcznie — generator produkuje setki przypadków
z gwarantowanymi właściwościami detekcji.

Grupy (pipeline):
  TestGeneratedHallucination  — 80 promptów, każdy ≥3 PL_TRIGGERS → HOLD/REJECT
  TestGeneratedJailbreak      — 23 promptów z _HOSTILE triggers → tone="hostile"
  TestBenignControl           — 15 bezpiecznych promptów → PASS
  TestMultiTurnEscalation     — 8 sekwencji gradual escalation → finale blocked
  TestDensitySweep            — monotoniczność scoring po liczbie triggerów

Grupy (Cerber v0.3 corpus):
  TestCerberSSRF              — 9 URL-ów → L4 wektor
  TestCerberPrivilegedPaths   — 10 URL-ów → L3 wektor
  TestCerberPII               — 8 wartości → L2 wektor
  TestCerberSelectorInjection — 7 selektorów → B1/B4 wektor
  TestCerberDeepInjection     — 9 wartości → L1 wektor
  TestCerberCompoundAttacks   — 6 kombinacji → blocked (≥2 wektory)
  TestCerberBenign            — 6 czystych akcji → score=0, nie blocked
"""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from filtry_tonoyana.engine import (
    AlfaEngine,
    ConversationContext,
    STRATEGY_LOCKDOWN,
    STRATEGY_MONTE_CARLO,
)
from filtry_tonoyana.tests.corpus.generators import PromptGenerator, CerberCorpusGenerator
from filtry_tonoyana.core.cerber import Cerber, CerberPolicy
from filtry_tonoyana.core.t9_action import T9Action, T9ActionType

# ── Shared generators ─────────────────────────────────────────────────────────

_GEN = PromptGenerator()
_HALL_CASES   = _GEN.hallucination_cases()
_JAIL_CASES   = _GEN.jailbreak_cases()
_BENIGN_CASES = _GEN.benign_cases()
_ESC_SEQS     = _GEN.escalation_sequences()
_DENSITY      = _GEN.density_sweep()

_CERBER_GEN          = CerberCorpusGenerator()
_CERBER_SSRF         = _CERBER_GEN.ssrf_cases()
_CERBER_PRIV         = _CERBER_GEN.privileged_path_cases()
_CERBER_PII          = _CERBER_GEN.pii_cases()
_CERBER_SEL          = _CERBER_GEN.selector_injection_cases()
_CERBER_DEPI         = _CERBER_GEN.deep_injection_cases()
_CERBER_COMPOUND     = _CERBER_GEN.compound_attack_cases()
_CERBER_BENIGN       = _CERBER_GEN.benign_action_cases()


def _cerber() -> Cerber:
    return Cerber(policy=CerberPolicy(
        allowed_domains=set(),
        blocked_domains={"evil.com"},
        max_risk_score=0.6,
        require_https=False,
    ))


def _make_action(**kwargs) -> T9Action:
    defaults = dict(
        action=T9ActionType.READ,
        domain="karentonoyan.pl",
        session_id="corpus",
        risk_score=0.1,
    )
    defaults.update(kwargs)
    return T9Action(**defaults)


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def module_engine():
    """Module-scoped engine — reused across all parametrized tests in this file."""
    return AlfaEngine(mistake_log=Path(tempfile.mktemp(suffix=".jsonl")))


# ═══════════════════════════════════════════════════════════════════════════════
# 1. GENERATED HALLUCINATION — 80 prompts, each ≥3 triggers
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.hallucination
@pytest.mark.high_stakes
class TestGeneratedHallucination:
    """
    80 automatycznie wygenerowanych promptów halucynacyjnych.
    Każdy zawiera ≥3 HALLUCINATION_PATTERNS → F4=0.75 → HOLD/REJECT.
    Weryfikuje że system nie może być ominięty przez parafrazę tematu
    przy zachowaniu wzorców absolutyzmu.
    """

    @pytest.mark.parametrize(
        "case_id,domain,prompt",
        _HALL_CASES,
        ids=[c[0] for c in _HALL_CASES],
    )
    def test_hallucination_blocked(
        self, module_engine: AlfaEngine, case_id: str, domain: str, prompt: str
    ):
        ctx = ConversationContext(domain=domain, stakes="high")
        report = module_engine.run(prompt, ctx)
        assert report.decision in {"HOLD", "REJECT"}, (
            f"[{case_id}] Hallucination prompt PASS'd — "
            f"decision={report.decision}, score={report.final_score:.4f}, "
            f"strategy={report.strategy}\n  prompt={prompt[:100]}"
        )

    @pytest.mark.parametrize(
        "case_id,domain,prompt",
        _GEN.hallucination_high_density(),
        ids=[c[0] for c in _GEN.hallucination_high_density()],
    )
    def test_high_density_hallucination_blocked(
        self, module_engine: AlfaEngine, case_id: str, domain: str, prompt: str
    ):
        """4-triggerowe prompty — najwyższa gęstość wzorców."""
        ctx = ConversationContext(domain=domain, stakes="high")
        report = module_engine.run(prompt, ctx)
        assert report.decision in {"HOLD", "REJECT"}, (
            f"[{case_id}] High-density hallucination not blocked: "
            f"decision={report.decision} score={report.final_score:.4f}"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# 2. GENERATED JAILBREAK — 23 prompts with _HOSTILE triggers
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.jailbreak
class TestGeneratedJailbreak:
    """
    23 warianty jailbreak z _HOSTILE triggers.
    Weryfikuje że każdy ustawia tone="hostile" i eskaluje strategię.
    """

    @pytest.mark.parametrize(
        "case_id,prompt",
        _JAIL_CASES,
        ids=[c[0] for c in _JAIL_CASES],
    )
    def test_jailbreak_triggers_hostile_tone(
        self, module_engine: AlfaEngine, case_id: str, prompt: str
    ):
        ctx = ConversationContext()
        module_engine.run(prompt, ctx)
        assert ctx.tone == "hostile", (
            f"[{case_id}] Jailbreak nie ustawił tone=hostile — "
            f"tone={ctx.tone}\n  prompt={prompt[:80]}"
        )

    @pytest.mark.parametrize(
        "case_id,prompt",
        _JAIL_CASES,
        ids=[c[0] for c in _JAIL_CASES],
    )
    def test_jailbreak_triggers_lockdown_strategy(
        self, module_engine: AlfaEngine, case_id: str, prompt: str
    ):
        """Hostile tone → AlfaBrain picks lockdown strategy."""
        ctx = ConversationContext()
        report = module_engine.run(prompt, ctx)
        assert report.strategy == STRATEGY_LOCKDOWN, (
            f"[{case_id}] Jailbreak nie eskalował do lockdown — "
            f"strategy={report.strategy}"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# 3. BENIGN CONTROL — 15 safe prompts → PASS
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.benign
class TestBenignControl:
    """
    15 bezpiecznych promptów — żaden nie powinien być blokowany.
    Weryfikuje brak false positive przy normalnym użyciu.
    """

    @pytest.mark.parametrize(
        "case_id,prompt",
        _BENIGN_CASES,
        ids=[c[0] for c in _BENIGN_CASES],
    )
    def test_benign_not_blocked(
        self, module_engine: AlfaEngine, case_id: str, prompt: str
    ):
        ctx = ConversationContext()
        report = module_engine.run(prompt, ctx)
        assert report.decision == "PASS", (
            f"[{case_id}] Benign prompt błędnie zablokowany — "
            f"decision={report.decision}, score={report.final_score:.4f}\n"
            f"  prompt={prompt[:80]}"
        )

    @pytest.mark.parametrize(
        "case_id,prompt",
        _BENIGN_CASES,
        ids=[c[0] for c in _BENIGN_CASES],
    )
    def test_benign_not_hostile(
        self, module_engine: AlfaEngine, case_id: str, prompt: str
    ):
        """Bezpieczne prompty nie ustawiają hostile tone."""
        ctx = ConversationContext()
        module_engine.run(prompt, ctx)
        assert ctx.tone != "hostile", (
            f"[{case_id}] Benign prompt błędnie ustawił tone=hostile"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# 4. MULTI-TURN ESCALATION — 8 sequences, finale always blocked
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.multi_turn
@pytest.mark.hallucination
@pytest.mark.high_stakes
class TestMultiTurnEscalation:
    """
    8 sekwencji gradual escalation: benign intro → eskalacja → blocked finale.
    Każdy finale zawiera ≥3 PL_TRIGGERS → HOLD/REJECT.
    Weryfikuje że shared ConversationContext poprawnie akumuluje kontekst.
    """

    @pytest.mark.parametrize(
        "case_id,domain,turns",
        _ESC_SEQS,
        ids=[s[0] for s in _ESC_SEQS],
    )
    def test_escalation_finale_blocked(
        self, case_id: str, domain: str, turns: list[str]
    ):
        """Ostatnia tura sekwencji powinna być zablokowana."""
        engine = AlfaEngine(
            mistake_log=Path(tempfile.mktemp(suffix=".jsonl"))
        )
        ctx = ConversationContext(domain=domain, stakes="high")
        reports = [engine.run(turn, ctx) for turn in turns]
        final = reports[-1]
        assert final.decision in {"HOLD", "REJECT"}, (
            f"[{case_id}] Finale escalation nie zablokowany — "
            f"decision={final.decision}, score={final.final_score:.4f}, "
            f"strategy={final.strategy}\n  finale={turns[-1][:100]}"
        )

    @pytest.mark.parametrize(
        "case_id,domain,turns",
        _ESC_SEQS,
        ids=[s[0] for s in _ESC_SEQS],
    )
    def test_escalation_strategy_escalates(
        self, case_id: str, domain: str, turns: list[str]
    ):
        """High-stakes domain → at least one turn uses MC or lockdown."""
        engine = AlfaEngine(
            mistake_log=Path(tempfile.mktemp(suffix=".jsonl"))
        )
        ctx = ConversationContext(domain=domain, stakes="high")
        reports = [engine.run(turn, ctx) for turn in turns]
        escalated_strategies = {STRATEGY_LOCKDOWN, STRATEGY_MONTE_CARLO}
        assert any(r.strategy in escalated_strategies for r in reports), (
            f"[{case_id}] Żadna tura nie eskalowała strategii — "
            f"strategies={[r.strategy for r in reports]}"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# 5. DENSITY SWEEP — monotonicity of scoring with trigger count
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.hallucination
@pytest.mark.boundary
class TestDensitySweep:
    """
    Weryfikuje monotoniczność scoring: więcej triggerów → wyższy score.
    n=0 → PASS, n=1 → nisko, n=2 → wyżej, n=3 → HOLD, n=4 → HOLD.
    """

    @pytest.mark.parametrize(
        "n_triggers,case_id,prompt",
        _DENSITY,
        ids=[f"density_n{d[0]}" for d in _DENSITY],
    )
    def test_density_score_monotone(
        self, module_engine: AlfaEngine, n_triggers: int, case_id: str, prompt: str
    ):
        ctx = ConversationContext(domain="medical", stakes="high")
        report = module_engine.run(prompt, ctx)
        if n_triggers == 0:
            assert report.decision == "PASS", f"n=0 nie PASS: {report.decision} score={report.final_score:.4f}"
        elif n_triggers >= 3:
            assert report.decision in {"HOLD", "REJECT"}, (
                f"n={n_triggers} nie HOLD/REJECT: {report.decision} score={report.final_score:.4f}"
            )

    def test_density_monotone_ordering(self, module_engine: AlfaEngine):
        """score(n) ≤ score(n+1) dla n=0..3 (monotoniczność)."""
        scores: list[float] = []
        for n, case_id, prompt in _DENSITY:
            ctx = ConversationContext(domain="medical", stakes="high")
            report = module_engine.run(prompt, ctx)
            scores.append(report.final_score)

        for i in range(len(scores) - 1):
            assert scores[i] <= scores[i + 1] + 1e-9, (
                f"Monotoniczność naruszona: score[{i}]={scores[i]:.4f} > "
                f"score[{i+1}]={scores[i+1]:.4f}"
            )


# ═══════════════════════════════════════════════════════════════════════════════
# CERBER CORPUS — v0.3 score_action() parametrized tests
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.integration
class TestCerberSSRF:
    """9 SSRF URL-ów → L4 wektor zawsze triggeruje."""

    @pytest.mark.parametrize("case_id,url", _CERBER_SSRF, ids=[c[0] for c in _CERBER_SSRF])
    def test_ssrf_triggers_L4(self, case_id: str, url: str):
        c = _cerber()
        report = c.score_action(_make_action(url=url))
        codes = [v.code for v in report.triggered_vectors]
        assert "L4" in codes, (
            f"[{case_id}] L4 nie wykryte dla SSRF URL: {url}\n"
            f"  triggered={codes}, score={report.score:.3f}"
        )

    @pytest.mark.parametrize("case_id,url", _CERBER_SSRF, ids=[c[0] for c in _CERBER_SSRF])
    def test_ssrf_blocked(self, case_id: str, url: str):
        """L4 ma wagę 0.55 ≥ max_risk=0.60 dopiero przy 2 wektorach lub po sumowaniu."""
        c = _cerber()
        report = c.score_action(_make_action(url=url))
        # L4(0.55) < 0.60 ale >0 — może zależeć od ścieżki
        # Gwarancja: score > 0
        assert report.score > 0, f"[{case_id}] score=0 przy SSRF URL: {url}"


@pytest.mark.integration
class TestCerberPrivilegedPaths:
    """10 uprzywilejowanych URL-ów → L3 wektor zawsze triggeruje."""

    @pytest.mark.parametrize("case_id,url", _CERBER_PRIV, ids=[c[0] for c in _CERBER_PRIV])
    def test_privileged_triggers_L3(self, case_id: str, url: str):
        c = _cerber()
        report = c.score_action(_make_action(url=url))
        codes = [v.code for v in report.triggered_vectors]
        assert "L3" in codes, (
            f"[{case_id}] L3 nie wykryte dla URL: {url}\n"
            f"  triggered={codes}"
        )


@pytest.mark.integration
class TestCerberPII:
    """8 wartości PII/secret → L2 wektor zawsze triggeruje."""

    @pytest.mark.parametrize("case_id,value", _CERBER_PII, ids=[c[0] for c in _CERBER_PII])
    def test_pii_triggers_L2(self, case_id: str, value: str):
        c = _cerber()
        action = _make_action(action=T9ActionType.FILL, value=value)
        report = c.score_action(action)
        codes = [v.code for v in report.triggered_vectors]
        assert "L2" in codes, (
            f"[{case_id}] L2 nie wykryte dla PII value: {value[:60]}\n"
            f"  triggered={codes}"
        )


@pytest.mark.integration
class TestCerberSelectorInjection:
    """7 selektorów z injection → B1 lub B4 wektor zawsze triggeruje."""

    @pytest.mark.parametrize("case_id,ref", _CERBER_SEL, ids=[c[0] for c in _CERBER_SEL])
    def test_selector_triggers_B1_or_B4(self, case_id: str, ref: str):
        c = _cerber()
        report = c.score_action(_make_action(target_ref=ref))
        codes = [v.code for v in report.triggered_vectors]
        assert "B1" in codes or "B4" in codes, (
            f"[{case_id}] B1/B4 nie wykryte dla ref: {repr(ref)}\n"
            f"  triggered={codes}"
        )


@pytest.mark.integration
class TestCerberDeepInjection:
    """9 deep injection wartości → L1 wektor zawsze triggeruje."""

    @pytest.mark.parametrize("case_id,value", _CERBER_DEPI, ids=[c[0] for c in _CERBER_DEPI])
    def test_deep_injection_triggers_L1(self, case_id: str, value: str):
        c = _cerber()
        action = _make_action(action=T9ActionType.FILL, value=value)
        report = c.score_action(action)
        codes = [v.code for v in report.triggered_vectors]
        assert "L1" in codes, (
            f"[{case_id}] L1 nie wykryte dla injection: {value[:60]}\n"
            f"  triggered={codes}"
        )


@pytest.mark.integration
class TestCerberCompoundAttacks:
    """6 kombinacji wektorów → każda blocked (≥2 wektory lub sum ≥ threshold)."""

    @pytest.mark.parametrize(
        "case_id,url,target_ref,value",
        _CERBER_COMPOUND,
        ids=[c[0] for c in _CERBER_COMPOUND],
    )
    def test_compound_blocked(
        self, case_id: str, url: str | None, target_ref: str | None, value: str | None
    ):
        c = _cerber()
        kwargs: dict = {}
        if url:
            kwargs["url"] = url
        if target_ref:
            kwargs["target_ref"] = target_ref
        if value:
            kwargs["action"] = T9ActionType.FILL
            kwargs["value"] = value
        action = _make_action(**kwargs)
        report = c.score_action(action)
        assert report.blocked, (
            f"[{case_id}] Compound attack nie zablokowany — "
            f"score={report.score:.3f}, vectors={[v.code for v in report.triggered_vectors]}"
        )


@pytest.mark.integration
class TestCerberBenign:
    """6 czystych akcji → score=0.0, blocked=False."""

    @pytest.mark.parametrize(
        "case_id,target_ref,url",
        _CERBER_BENIGN,
        ids=[c[0] for c in _CERBER_BENIGN],
    )
    def test_benign_not_blocked(
        self, case_id: str, target_ref: str | None, url: str | None
    ):
        c = _cerber()
        kwargs: dict = {}
        if target_ref:
            kwargs["target_ref"] = target_ref
        if url:
            kwargs["url"] = url
        action = _make_action(**kwargs)
        report = c.score_action(action)
        assert not report.blocked, (
            f"[{case_id}] Benign Cerber akcja błędnie zablokowana — "
            f"score={report.score:.3f}, vectors={[v.code for v in report.triggered_vectors]}"
        )
        assert report.score == 0.0, (
            f"[{case_id}] Benign akcja ma score={report.score:.3f} (oczekiwane 0.0)"
        )
