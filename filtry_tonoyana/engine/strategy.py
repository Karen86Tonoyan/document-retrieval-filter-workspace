"""
ALFA Engine — AlgorithmConfig + predefiniowane strategie
© Karen Tonoyan

Strategie:
  DETERMINISTIC  — standardowe przejście, wagi RC1 (szybkie)
  MONTE_CARLO    — N perturbowanych przebiegów wag, decyzja z P95
  ADAPTIVE_LITE  — przesunięte wagi w kierunku L2 (detekcja)
  LOCKDOWN       — minimalne progi, agresywna detekcja

Monte Carlo w ALFA:
  Nie perturbuje tekstu — perturbuje WAGI L1-L4.
  Jeden faktyczny przebieg filtrów (expensive), N-krotne re-scorowanie
  (cheap). Wynik końcowy = P95 rozkładu N wyników.
"""
from __future__ import annotations

import copy
import random
from dataclasses import dataclass, field
from typing import Optional

STRATEGY_DETERMINISTIC = "deterministic"
STRATEGY_MONTE_CARLO   = "monte_carlo"
STRATEGY_ADAPTIVE_LITE = "adaptive_lite"
STRATEGY_LOCKDOWN      = "lockdown"

_DEFAULT_WEIGHTS = {"L1": 0.22, "L2": 0.40, "L3": 0.25, "L4": 0.13}
_DEFAULT_THRESHOLDS = {"PASS": 0.30, "HOLD": 0.60}


@dataclass
class AlgorithmConfig:
    """
    Konfiguracja algorytmu dla jednego przebiegu pipeline.

    layer_weights:
      Wagi dla L1–L4. Muszą sumować się do ~1.0 (nie wymuszane — AlfaEngine normalizuje).
    thresholds:
      PASS — wynik < PASS → decyzja PASS
      HOLD — wynik >= HOLD → decyzja REJECT
      Między PASS a HOLD → HOLD
    monte_carlo_iterations:
      0 = wyłączony. > 0 = N perturbowanych przebiegów wag.
    monte_carlo_noise:
      Maksymalne odchylenie wag przy MC (±noise).
    """
    name:                    str              = STRATEGY_DETERMINISTIC
    layer_weights:           dict[str, float] = field(default_factory=lambda: dict(_DEFAULT_WEIGHTS))
    thresholds:              dict[str, float] = field(default_factory=lambda: dict(_DEFAULT_THRESHOLDS))
    monte_carlo_iterations:  int              = 0
    monte_carlo_noise:       float            = 0.04
    active_filters:          list[str]        = field(
        default_factory=lambda: ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9"]
    )

    def perturbed(self, seed: Optional[int] = None) -> "AlgorithmConfig":
        """
        Zwraca kopię z losowo perturbowanymi wagami (dla Monte Carlo).
        Wagi są re-normalizowane do sumy 1.0 po perturbacji.
        """
        rng = random.Random(seed)
        cfg = copy.deepcopy(self)
        noise = self.monte_carlo_noise
        for k in cfg.layer_weights:
            cfg.layer_weights[k] = max(
                0.01,
                cfg.layer_weights[k] + rng.uniform(-noise, noise)
            )
        total = sum(cfg.layer_weights.values())
        for k in cfg.layer_weights:
            cfg.layer_weights[k] /= total
        return cfg

    def normalized_weights(self) -> dict[str, float]:
        """Zwraca wagi znormalizowane do sumy 1.0."""
        total = sum(self.layer_weights.values())
        if total == 0:
            return dict(_DEFAULT_WEIGHTS)
        return {k: v / total for k, v in self.layer_weights.items()}


# ── Fabryki strategii ────────────────────────────────────────────────────────

def strategy_deterministic() -> AlgorithmConfig:
    """Standardowe przejście — wagi RC1, szybkie."""
    return AlgorithmConfig(name=STRATEGY_DETERMINISTIC)


def strategy_monte_carlo(n: int = 50, noise: float = 0.04) -> AlgorithmConfig:
    """
    Monte Carlo — N perturbowanych przebiegów wag, wynik = P95.
    Używany przy wysokim ryzyku i wysokich stawkach.
    """
    return AlgorithmConfig(
        name=STRATEGY_MONTE_CARLO,
        monte_carlo_iterations=n,
        monte_carlo_noise=noise,
    )


def strategy_adaptive_lite() -> AlgorithmConfig:
    """
    Adaptive lite — większy nacisk na L2 (leksykon/detekcja wzorców).
    Używany gdy risk_trend jest rosnący.
    """
    return AlgorithmConfig(
        name=STRATEGY_ADAPTIVE_LITE,
        layer_weights={"L1": 0.15, "L2": 0.50, "L3": 0.25, "L4": 0.10},
        thresholds={"PASS": 0.25, "HOLD": 0.55},
    )


def strategy_lockdown() -> AlgorithmConfig:
    """
    Lockdown — minimalne progi PASS/HOLD, agresywna detekcja.
    Używany przy wrogim tonie lub wykrytej próbie injection.
    """
    return AlgorithmConfig(
        name=STRATEGY_LOCKDOWN,
        layer_weights={"L1": 0.20, "L2": 0.45, "L3": 0.25, "L4": 0.10},
        thresholds={"PASS": 0.15, "HOLD": 0.40},
        monte_carlo_iterations=30,
        monte_carlo_noise=0.03,
    )


STRATEGY_REGISTRY: dict[str, AlgorithmConfig] = {
    STRATEGY_DETERMINISTIC: strategy_deterministic(),
    STRATEGY_MONTE_CARLO:   strategy_monte_carlo(),
    STRATEGY_ADAPTIVE_LITE: strategy_adaptive_lite(),
    STRATEGY_LOCKDOWN:      strategy_lockdown(),
}
