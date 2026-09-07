"""
alfa/core/exceptions.py
Wyjątki ALFA — hierarchia błędów dla warstwy egzekucji.
"""
from __future__ import annotations
from typing import Optional, Any


class ALFAError(Exception):
    """Bazowy wyjątek ALFA."""
    pass


class CerberBlockError(ALFAError):
    """
    Cerber zablokował akcję.
    reason: kod blokady (DOMAIN_BLOCKED, RISK_SCORE_EXCEEDED, ...)
    detail: czytelny opis
    action: T9Action który był blokowany (może być None)
    """
    def __init__(self, reason: str, detail: str, action: Optional[Any] = None):
        self.reason = reason
        self.detail = detail
        self.action = action
        super().__init__(f"[CERBER BLOCK] {reason}: {detail}")


class LasuchBlockError(ALFAError):
    """
    Łasuch wykrył prompt injection lub niebezpieczną treść.
    """
    def __init__(self, reason: str, detail: str, snippet: Optional[str] = None):
        self.reason = reason
        self.detail = detail
        self.snippet = snippet
        super().__init__(f"[ŁASUCH BLOCK] {reason}: {detail}")


class ALFAExecutionError(ALFAError):
    """
    Błąd podczas wykonania przez agent-browser.
    """
    def __init__(self, message: str, details: Optional[dict] = None):
        self.details = details or {}
        super().__init__(message)
