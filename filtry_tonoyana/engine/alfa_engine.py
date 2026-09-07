"""
ALFA Engine — Adaptacyjny silnik wykonawczy
© Karen Tonoyan

Architektura:
  AlfaEngine.run(text, ctx) → BrainReport

Wewnętrznie:
  1. AlfaBrain.select(ctx)         → AlgorithmConfig
  2. FiltryTonoyana.run(text)      → FilteryReport (layer_scores)
  3. _rescore(report, cfg)         → final_score z wagami strategii
  4. Jeśli MC: N perturbacji wag → rozkład → P95
  5. MistakeTracker.record(...)    → feedback loop (trening z błędów)
  6. ctx.push_risk(score)          → aktualizacja historii ryzyka

Monte Carlo w ALFA:
  Jeden faktyczny przebieg filtrów (expensive).
  N perturbowanych re-scorowań wag (cheap).
  Wynik końcowy = percentyl P95 z rozkładu N wyników.
  Im więcej N, tym bardziej konserwatywna (wyższa) ocena ryzyka.

Self-install (bootstrap):
  AlfaEngine.bootstrap() sprawdza i instaluje zależności.
  Wywołaj przy starcie aplikacji lub z CLI (patrz bootstrap.py).

MistakeTracker — feedback loop:
  Zbiera decyzje REJECT/HOLD + kontekst.
  export_training_data() → JSONL gotowy do fine-tuningu.
  Używany przez ALFA Brain do okresowej kalibracji progów.
"""
from __future__ import annotations

import json
import os
import sys
import statistics
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from filtry_tonoyana.core.filtry_tonoyana import FiltryTonoyana, FilteryReport
from .context import ConversationContext, ToneAnalyzer
from .strategy import AlgorithmConfig, strategy_deterministic


# ── BrainReport ───────────────────────────────────────────────────────────────

@dataclass
class BrainReport:
    """
    Wynik przebiegu AlfaEngine.

    raw           — oryginalny FilteryReport z FiltryTonoyana
    final_score   — wynik po re-scorowaniu wagami strategii (lub P95 przy MC)
    decision      — PASS | HOLD | REJECT
    strategy      — nazwa użytej strategii
    mc_scores     — lista wyników MC (pusta jeśli nie MC)
    mc_p95        — percentyl P95 (tylko przy MC)
    brain_reason  — wyjaśnienie AlfaBrain (dlaczego ta strategia)
    """
    raw:          FilteryReport
    final_score:  float
    decision:     str
    strategy:     str
    mc_scores:    list[float]    = field(default_factory=list)
    mc_p95:       Optional[float] = None
    brain_reason: str             = ""

    def to_dict(self) -> dict:
        d = {
            "decision":     self.decision,
            "final_score":  round(self.final_score, 4),
            "strategy":     self.strategy,
            "brain_reason": self.brain_reason,
            "raw":          self.raw.to_dict(),
        }
        if self.mc_scores:
            d["mc_p95"]    = round(self.mc_p95, 4) if self.mc_p95 is not None else None
            d["mc_n"]      = len(self.mc_scores)
            d["mc_mean"]   = round(statistics.mean(self.mc_scores), 4)
            d["mc_stdev"]  = round(statistics.stdev(self.mc_scores), 4) if len(self.mc_scores) > 1 else 0.0
        return d


# ── MistakeTracker — feedback loop ───────────────────────────────────────────

class MistakeTracker:
    """
    Zbiera decyzje REJECT/HOLD + kontekst do późniejszego treningu.

    Format wpisu JSONL:
      {"ts": "...", "decision": "REJECT", "score": 0.72,
       "strategy": "lockdown", "tone": "hostile", "domain": "security",
       "turn": 3, "avg_risk": 0.55, "text_preview": "...", "failed_filters": [...]}

    Użycie:
      tracker = MistakeTracker("logs/mistakes.jsonl")
      tracker.record(report, ctx)
      tracker.export_training_data("training/alfa_feedback.jsonl")
    """

    def __init__(self, log_path: Path = Path("logs/alfa_mistakes.jsonl")):
        self.log_path = log_path
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = __import__("threading").Lock()

    def record(self, report: BrainReport, ctx: ConversationContext) -> None:
        """Zapisuje błąd/hold jeśli decyzja nie jest PASS."""
        if report.decision == "PASS":
            return
        entry = {
            "ts":             datetime.now(timezone.utc).isoformat(),
            "decision":       report.decision,
            "score":          round(report.final_score, 4),
            "strategy":       report.strategy,
            "tone":           ctx.tone,
            "domain":         ctx.domain,
            "stakes":         ctx.stakes,
            "turn":           ctx.turn_count,
            "avg_risk":       round(ctx.avg_risk, 4),
            "trend":          ctx.trend,
            "flags":          ctx.flags[:],
            "text_preview":   report.raw.input_text[:120],
            "failed_filters": report.raw.failed_filters(),
            "brain_reason":   report.brain_reason,
        }
        with self._lock:
            with open(self.log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def export_training_data(self, output_path: Path = Path("training/alfa_feedback.jsonl")) -> int:
        """
        Eksportuje zebrane błędy jako dane treningowe.
        Format: {"prompt": "...", "label": "REJECT", "features": {...}}
        Zwraca liczbę wyeksportowanych wpisów.
        """
        if not self.log_path.exists():
            return 0
        output_path.parent.mkdir(parents=True, exist_ok=True)
        count = 0
        with open(self.log_path, encoding="utf-8") as src, \
             open(output_path, "w", encoding="utf-8") as dst:
            for line in src:
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                training_example = {
                    "prompt":   entry.get("text_preview", ""),
                    "label":    entry["decision"],
                    "features": {
                        "score":          entry.get("score"),
                        "tone":           entry.get("tone"),
                        "domain":         entry.get("domain"),
                        "strategy":       entry.get("strategy"),
                        "failed_filters": entry.get("failed_filters", []),
                        "avg_risk":       entry.get("avg_risk"),
                        "trend":          entry.get("trend"),
                    },
                }
                dst.write(json.dumps(training_example, ensure_ascii=False) + "\n")
                count += 1
        return count

    def stats(self) -> dict:
        """Statystyki zebranych błędów."""
        if not self.log_path.exists():
            return {"total": 0}
        total = rejects = holds = 0
        domains: dict[str, int] = {}
        with open(self.log_path, encoding="utf-8") as f:
            for line in f:
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                total += 1
                if e.get("decision") == "REJECT":
                    rejects += 1
                elif e.get("decision") == "HOLD":
                    holds += 1
                d = e.get("domain", "general")
                domains[d] = domains.get(d, 0) + 1
        return {
            "total":   total,
            "rejects": rejects,
            "holds":   holds,
            "domains": domains,
        }


# ── AlfaEngine ────────────────────────────────────────────────────────────────

class AlfaEngine:
    """
    Główny silnik ALFA — łączy AlfaBrain, FiltryTonoyana, Monte Carlo i MistakeTracker.

    Użycie:
        engine = AlfaEngine()
        ctx = ConversationContext(domain="medical", stakes="high")
        report = engine.run("Lek X jest w 100% skuteczny.", ctx)
        print(report.decision)          # → REJECT
        print(report.brain_reason)      # → [AlfaBrain] strategy=monte_carlo | ...
    """

    def __init__(
        self,
        mistake_log: Path = Path("logs/alfa_mistakes.jsonl"),
        auto_update_tone: bool = True,
    ):
        from .alfa_brain import AlfaBrain
        self._brain    = AlfaBrain()
        self._filtry   = FiltryTonoyana()
        self._tracker  = MistakeTracker(mistake_log)
        self._auto_update_tone = auto_update_tone

    # ── Główna metoda ─────────────────────────────────────────────────────────

    def run(
        self,
        text: str,
        ctx: Optional[ConversationContext] = None,
        query: Optional[str] = None,
        evidence: Optional[list[str]] = None,
        strategy_override: Optional[str] = None,
    ) -> BrainReport:
        """
        Uruchamia pełny pipeline z adaptacyjną strategią.

        text             — tekst do analizy (odpowiedź LLM lub prompt użytkownika)
        ctx              — kontekst rozmowy (tworzony automatycznie jeśli None)
        query            — oryginalne zapytanie (poprawia F3)
        evidence         — lista artefaktów dowodowych (dla F8)
        strategy_override — wymuś strategię: "deterministic"|"monte_carlo"|"adaptive_lite"|"lockdown"
        """
        if ctx is None:
            ctx = ConversationContext()

        # Aktualizuj ton kontekstu na podstawie tekstu
        if self._auto_update_tone:
            ToneAnalyzer.update_context(ctx, text)

        # Wybierz strategię
        cfg = self._brain.calibrate(ctx, override_strategy=strategy_override)
        reason = self._brain.explain(ctx)

        # Określ high_stakes i domain na podstawie kontekstu
        high_stakes = ctx.stakes == "high"
        stakes_domain = ctx.domain if ctx.domain != "general" else None

        # Uruchom filtry (jeden przebieg — expensive)
        raw = self._filtry.run(
            text,
            query=query,
            evidence=evidence,
            high_stakes=high_stakes,
            stakes_domain=stakes_domain,
        )

        # Oblicz wynik i decyzję
        if cfg.monte_carlo_iterations > 0:
            report = self._run_monte_carlo(raw, cfg, reason)
        else:
            report = self._run_deterministic(raw, cfg, reason)

        # Aktualizuj historię ryzyka w kontekście
        ctx.push_risk(report.final_score)

        # Zapisz błąd do trackera
        self._tracker.record(report, ctx)

        return report

    # ── Monte Carlo ───────────────────────────────────────────────────────────

    def _run_monte_carlo(
        self, raw: FilteryReport, cfg: AlgorithmConfig, reason: str
    ) -> BrainReport:
        """
        N perturbowanych re-scorowań wag → rozkład → P95.
        Im wyższe N, tym bardziej konserwatywna ocena.
        """
        scores: list[float] = []
        n = cfg.monte_carlo_iterations

        for i in range(n):
            perturbed = cfg.perturbed(seed=i)
            score = self._compute_score(raw, perturbed)
            scores.append(score)

        scores_sorted = sorted(scores)
        p95_idx = max(0, int(0.95 * n) - 1)
        p95 = scores_sorted[p95_idx]

        decision = self._decide(p95, cfg)
        return BrainReport(
            raw=raw,
            final_score=p95,
            decision=decision,
            strategy=cfg.name,
            mc_scores=scores,
            mc_p95=p95,
            brain_reason=reason,
        )

    def _run_deterministic(
        self, raw: FilteryReport, cfg: AlgorithmConfig, reason: str
    ) -> BrainReport:
        score = self._compute_score(raw, cfg)
        decision = self._decide(score, cfg)
        return BrainReport(
            raw=raw,
            final_score=score,
            decision=decision,
            strategy=cfg.name,
            brain_reason=reason,
        )

    # ── Re-scoring ────────────────────────────────────────────────────────────

    @staticmethod
    def _compute_score(raw: FilteryReport, cfg: AlgorithmConfig) -> float:
        """
        Oblicza wynik końcowy używając wag z AlgorithmConfig.
        Używa layer_scores z FilteryReport (wyniki FiltryTonoyana).
        """
        w = cfg.normalized_weights()
        ls = raw.layer_scores

        base = (
            ls.get("L1_bifurkacja", 0.0) * w.get("L1", 0.22)
            + ls.get("L2_leksykon",   0.0) * w.get("L2", 0.40)
            + ls.get("L3_graf",       0.0) * w.get("L3", 0.25)
            + ls.get("L4_dowod",      0.0) * w.get("L4", 0.13)
        )
        hold_threshold = cfg.thresholds.get("HOLD", 0.60)
        critical_bonus = sum(0.2 for r in raw.results if r.score >= hold_threshold)
        return min(base + critical_bonus, 1.0)

    @staticmethod
    def _decide(score: float, cfg: AlgorithmConfig) -> str:
        pass_t = cfg.thresholds.get("PASS", 0.30)
        hold_t = cfg.thresholds.get("HOLD", 0.60)
        if score >= hold_t:
            return "REJECT"
        if score >= pass_t:
            return "HOLD"
        return "PASS"

    # ── Self-install ──────────────────────────────────────────────────────────

    @staticmethod
    def bootstrap(verbose: bool = True) -> bool:
        """
        Sprawdza środowisko i instaluje zależności jeśli potrzeba.
        Zwraca True jeśli OK, False jeśli błąd krytyczny.

        Wywołaj przy starcie lub z CLI: python bootstrap.py
        """
        import subprocess

        def log(msg: str) -> None:
            if verbose:
                print(f"[ALFA bootstrap] {msg}")

        # Python version check
        if sys.version_info < (3, 11):
            log(f"BLAD: Python >= 3.11 wymagany (masz {sys.version})")
            return False
        log(f"Python {sys.version.split()[0]} OK")

        # Check filtry_tonoyana import
        try:
            import filtry_tonoyana  # noqa: F401
            log("filtry_tonoyana — zainstalowane")
        except ImportError:
            log("filtry_tonoyana nie znaleziona — instaluję...")
            result = subprocess.run(
                [sys.executable, "-m", "pip", "install", "-e", ".", "--quiet"],
                capture_output=True, text=True
            )
            if result.returncode != 0:
                log(f"BLAD instalacji: {result.stderr[:200]}")
                log("Próba alternatywna: PYTHONPATH...")
                os.environ["PYTHONPATH"] = os.getcwd()
                log(f"PYTHONPATH={os.getcwd()} ustawiony")

        # Check required packages
        required = ["pytest"]
        for pkg in required:
            try:
                __import__(pkg)
                log(f"{pkg} OK")
            except ImportError:
                log(f"{pkg} brak — instaluję...")
                subprocess.run(
                    [sys.executable, "-m", "pip", "install", pkg, "--quiet"],
                    capture_output=True
                )

        # Create required directories
        for d in ["logs", "training"]:
            Path(d).mkdir(exist_ok=True)
        log("Katalogi logs/ training/ gotowe")
        log("Bootstrap zakończony — ALFA Engine ready.")
        return True

    # ── Statistyki ───────────────────────────────────────────────────────────

    def mistake_stats(self) -> dict:
        """Zwraca statystyki zebranych błędów (dla monitoringu)."""
        return self._tracker.stats()

    def export_training_data(self, output: Path = Path("training/alfa_feedback.jsonl")) -> int:
        """Eksportuje dane treningowe z zebranych błędów."""
        n = self._tracker.export_training_data(output)
        return n
