"""
ALFA Engine — adaptacyjny silnik algorytmiczny
© Karen Tonoyan

Eksportuje: AlfaBrain, AlfaEngine, ConversationContext, AlgorithmConfig
"""
from .context import ConversationContext, ToneAnalyzer
from .strategy import AlgorithmConfig, STRATEGY_DETERMINISTIC, STRATEGY_MONTE_CARLO, STRATEGY_ADAPTIVE_LITE, STRATEGY_LOCKDOWN
from .alfa_brain import AlfaBrain
from .alfa_engine import AlfaEngine, BrainReport

__all__ = [
    "AlfaBrain",
    "AlfaEngine",
    "BrainReport",
    "ConversationContext",
    "ToneAnalyzer",
    "AlgorithmConfig",
    "STRATEGY_DETERMINISTIC",
    "STRATEGY_MONTE_CARLO",
    "STRATEGY_ADAPTIVE_LITE",
    "STRATEGY_LOCKDOWN",
]
