"""
alfa/core/guardian.py
Guardian v0.2 — Twarda decyzja + ExecutionLogger
Zgodny z ALFA Brain Whitepaper v1.1

Decyzje (progi z Whitepaper):
  PASS          risk < 0.3,  Cerber OK, Łasuch OK
  HUMAN_REVIEW  0.3 ≤ risk < 0.6
  CORE_LOCK     risk ≥ 0.6  lub  Cerber BLOCK  lub  Łasuch BLOCK

Log:
  logs/execution_reports.jsonl  — append-only, thread-safe
  Każdy wpis: ExecutionReport.to_dict() + logged_at

TODO v0.3:
  - SQLite backend (jak HallucinationSnapshotDB)
  - ALFA EOS Seal: hash każdego wpisu
  - Rotacja logów (daily)
  - Alert jeśli log_path niedostępny
"""
from __future__ import annotations

import json
import threading
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Any

DEFAULT_LOG_PATH = Path("logs/execution_reports.jsonl")

THRESHOLD_CORE_LOCK    = 0.6
THRESHOLD_HUMAN_REVIEW = 0.3


# ── ExecutionReport ───────────────────────────────────────────────────────────

@dataclass
class ExecutionReport:
    """
    Pełny raport z cyklu pipeline.
    Powstaje na początku execute_controlled_action,
    uzupełniany warstwa po warstwie, zapisywany na końcu.
    """
    # Identyfikacja
    session_id: str
    action_type: str
    domain: str
    timestamp: str

    # Cerber
    cerber_decision: str = "UNKNOWN"
    cerber_reason: Optional[str] = None

    # Łasuch
    lasuch_decision: str = "UNKNOWN"
    lasuch_reason: Optional[str] = None
    lasuch_risk_score: float = 0.0
    lasuch_report: Optional[dict] = None    # pełny LasuchReport.to_dict()

    # Guardian
    guardian_decision: str = "UNKNOWN"
    guardian_reason: Optional[str] = None

    # Egzekucja
    executed: bool = False
    browser_exit_code: Optional[int] = None
    browser_output: dict = field(default_factory=dict)
    success: bool = False
    error: Optional[str] = None

    # Metadane z T9Action
    risk_score: float = 0.0
    confidence: float = 0.0
    target_ref: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)

    @classmethod
    def from_action(cls, action) -> "ExecutionReport":
        return cls(
            session_id=action.session_id,
            action_type=action.action.value,
            domain=action.domain,
            timestamp=datetime.now(timezone.utc).isoformat(),
            risk_score=action.risk_score,
            confidence=action.confidence,
            target_ref=action.target_ref,
        )


# ── Guardian ──────────────────────────────────────────────────────────────────

class Guardian:
    """
    Guardian v0.2 — ostateczna decyzja + append-only JSONL log.
    Thread-safe.

    decide() przyjmuje wyniki Cerbera i Łasucha → zwraca string decyzji.
    log_*() zapisują każde zdarzenie niezależnie od decyzji.
    """

    def __init__(self, log_path: Path = DEFAULT_LOG_PATH):
        self.log_path = Path(log_path)
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    # ── decyzja ──────────────────────────────────────────────────────────────

    def decide(
        self,
        action,
        cerber_passed: bool,
        lasuch_risk: float,
        lasuch_blocked: bool = False,
    ) -> tuple[str, str]:
        """
        Zwraca (decision, reason).
        decision: "PASS" | "HUMAN_REVIEW" | "CORE_LOCK"
        """
        if not cerber_passed:
            return "CORE_LOCK", "Cerber BLOCK"

        if lasuch_blocked:
            return "CORE_LOCK", f"Łasuch BLOCK: hard injection (risk={lasuch_risk:.2f})"

        if lasuch_risk >= THRESHOLD_CORE_LOCK:
            return "CORE_LOCK", f"Łasuch risk={lasuch_risk:.2f} >= {THRESHOLD_CORE_LOCK}"

        if lasuch_risk >= THRESHOLD_HUMAN_REVIEW:
            return "HUMAN_REVIEW", f"Łasuch risk={lasuch_risk:.2f} >= {THRESHOLD_HUMAN_REVIEW}"

        return "PASS", f"risk={lasuch_risk:.2f} < {THRESHOLD_HUMAN_REVIEW}"

    # ── logging ───────────────────────────────────────────────────────────────

    def log_execution(self, report: ExecutionReport | dict) -> None:
        entry = report.to_dict() if isinstance(report, ExecutionReport) else dict(report)
        entry["logged_at"] = datetime.now(timezone.utc).isoformat()
        self._write(entry)

    def log_block(
        self,
        action,
        layer: str,
        reason: str,
        detail: str,
    ) -> None:
        self._write({
            "event": "BLOCK",
            "layer": layer,
            "reason": reason,
            "detail": detail,
            "session_id": getattr(action, "session_id", "UNKNOWN"),
            "action_type": action.action.value if hasattr(action, "action") else "UNKNOWN",
            "domain": getattr(action, "domain", "UNKNOWN"),
            "risk_score": getattr(action, "risk_score", -1),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "logged_at": datetime.now(timezone.utc).isoformat(),
        })

    def log_timeout(self, action, timeout_seconds: int) -> None:
        self._write({
            "event": "TIMEOUT",
            "timeout_seconds": timeout_seconds,
            "session_id": getattr(action, "session_id", "UNKNOWN"),
            "action_type": action.action.value if hasattr(action, "action") else "UNKNOWN",
            "domain": getattr(action, "domain", "UNKNOWN"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "logged_at": datetime.now(timezone.utc).isoformat(),
        })

    def _write(self, entry: dict) -> None:
        line = json.dumps(entry, ensure_ascii=False)
        with self._lock:
            with self.log_path.open("a", encoding="utf-8") as f:
                f.write(line + "\n")
