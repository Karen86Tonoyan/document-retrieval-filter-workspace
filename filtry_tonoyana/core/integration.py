"""
alfa/agent_browser/integration.py
Warstwa integracyjna T9 ↔ agent-browser v0.2
Zgodna z ALFA Brain Whitepaper v1.1 — Sandbox-First

Pipeline:
  T9Action
    → Cerber.validate_action()         [BLOCK → CerberBlockError]
    → Lasuch.sanitize_action()         [BLOCK → LasuchBlockError, score → LasuchReport]
    → Guardian.decide()                [CORE_LOCK / HUMAN_REVIEW / PASS]
    → [tylko PASS] agent-browser CLI   [timeout / non-zero → ALFAExecutionError]
    → Guardian.log_execution()         [ExecutionReport → JSONL]

Zwraca ExecutionReport (zawsze) lub rzuca wyjątek.
"""
from __future__ import annotations

import json
import subprocess
from datetime import datetime, timezone
from typing import Any

from filtry_tonoyana.core.cerber import Cerber
from filtry_tonoyana.core.lasuch import Lasuch
from filtry_tonoyana.core.guardian import Guardian, ExecutionReport
from filtry_tonoyana.core.exceptions import (
    ALFAExecutionError,
    CerberBlockError,
    LasuchBlockError,
)
from filtry_tonoyana.core.t9_action import T9Action, T9ActionType
from pathlib import Path

AGENT_BROWSER_BIN = Path("/usr/local/bin/agent-browser")


def execute_controlled_action(
    action: T9Action,
    cerber: Cerber,
    lasuch: Lasuch,
    guardian: Guardian,
    timeout: int = 30,
) -> ExecutionReport:
    """
    Sandbox-First pipeline.
    Zawsze zwraca ExecutionReport — nawet przy blokadzie (po złapaniu wyjątku
    przez wywołującego). Rzuca tylko jeśli blokada lub błąd egzekucji.
    """
    report = ExecutionReport.from_action(action)

    # ── 1. CERBER ─────────────────────────────────────────────────────────────
    try:
        cerber.validate_action(action)
        report.cerber_decision = "PASS"
    except CerberBlockError as e:
        report.cerber_decision = "BLOCK"
        report.cerber_reason = f"{e.reason}: {e.detail}"
        report.guardian_decision = "CORE_LOCK"
        report.guardian_reason = "Cerber BLOCK"
        report.success = False
        guardian.log_block(action, layer="CERBER", reason=e.reason, detail=e.detail)
        guardian.log_execution(report)
        raise

    # ── 2. ŁASUCH ────────────────────────────────────────────────────────────
    try:
        sanitized, lasuch_report = lasuch.sanitize_action(action)
        report.lasuch_decision = "SANITIZED"
        report.lasuch_risk_score = lasuch_report.final_score
        report.lasuch_report = lasuch_report.to_dict()
    except LasuchBlockError as e:
        report.lasuch_decision = "BLOCK"
        report.lasuch_reason = f"{e.reason}: {e.detail}"
        report.guardian_decision = "CORE_LOCK"
        report.guardian_reason = "Łasuch hard injection BLOCK"
        report.success = False
        guardian.log_block(action, layer="ŁASUCH", reason=e.reason, detail=e.detail)
        guardian.log_execution(report)
        raise

    # ── 3. GUARDIAN — decyzja ────────────────────────────────────────────────
    decision, reason = guardian.decide(
        action=sanitized,
        cerber_passed=True,
        lasuch_risk=lasuch_report.final_score,
        lasuch_blocked=lasuch_report.blocked,
    )
    report.guardian_decision = decision
    report.guardian_reason = reason

    if decision in ("CORE_LOCK", "HUMAN_REVIEW"):
        report.success = False
        report.error = f"Guardian {decision}: {reason}"
        guardian.log_execution(report)
        raise ALFAExecutionError(report.error, details=report.to_dict())

    # ── 4. EGZEKUCJA — tylko przy PASS ───────────────────────────────────────
    cmd = _build_command(sanitized)
    report.executed = True

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        report.error = f"agent-browser timeout po {timeout}s"
        report.success = False
        guardian.log_timeout(action, timeout)
        guardian.log_execution(report)
        raise ALFAExecutionError(report.error)

    report.browser_exit_code = result.returncode
    report.browser_output = _parse_output(result.stdout, result.stderr)
    report.success = result.returncode == 0

    if not report.success:
        report.error = f"agent-browser exit_code={result.returncode}"

    # ── 5. LOG ────────────────────────────────────────────────────────────────
    guardian.log_execution(report)

    if not report.success:
        raise ALFAExecutionError(report.error, details=report.to_dict())

    return report


def _build_command(action: T9Action) -> list[str]:
    base = [str(AGENT_BROWSER_BIN), "--json", "--session", action.session_id]

    match action.action:
        case T9ActionType.READ:
            return base + ["snapshot", "--ref", action.target_ref or "body"]
        case T9ActionType.CLICK:
            if not action.target_ref:
                raise ALFAExecutionError("CLICK wymaga target_ref")
            return base + ["click", action.target_ref]
        case T9ActionType.FILL:
            if not action.target_ref or action.value is None:
                raise ALFAExecutionError("FILL wymaga target_ref i value")
            return base + ["fill", action.target_ref, action.value]
        case T9ActionType.SUBMIT:
            return base + ["submit"] + ([action.target_ref] if action.target_ref else [])
        case T9ActionType.DOWNLOAD:
            if not action.target_ref:
                raise ALFAExecutionError("DOWNLOAD wymaga target_ref")
            return base + ["download", action.target_ref]
        case _:
            raise ALFAExecutionError(f"Nieobsługiwana akcja: {action.action}")


def _parse_output(stdout: str, stderr: str) -> dict[str, Any]:
    if stdout.strip():
        try:
            return json.loads(stdout)
        except json.JSONDecodeError:
            pass
    return {"raw_stdout": stdout, "stderr": stderr}
