"""
Cerber Hybrid v0.3 — Defensywna warstwa Cerbera
© Karen Tonoyan

Cerber przestaje być tylko symulatorem ataków.
Staje się HYBRYDĄ: atakuje I broni właściciela.

Defensywna warstwa (CerberDefenseLayer):
  - Integrates z open-source narzędziami bezpieczeństwa
  - Graceful degradation — działa bez nich, ale używa jeśli dostępne
  - Generuje DefenseReport dla właściciela (Karen / ALFA Brain)

Open-source integracje (opcjonalne — instalowane przez bootstrap):
  bandit    — skanowanie kodu Python (AST security analysis)
  safety    — sprawdzanie zależności pod CVE
  semgrep   — reguły SAST dla wielu języków
  yara-python — pattern matching (malware signatures)
  hashlib   — weryfikacja integralności (built-in, zawsze dostępne)

CerberHybrid:
  Rozszerza Cerber o defensywną warstwę.
  validate_action(action)  — jak dotychczas (atak)
  defend(content, ctx)     — defensywna analiza zawartości
  full_scan(action, content) — oba w jednym kroku

TODO v0.4:
  - Threat intelligence feed integration (URLhaus, VirusTotal API)
  - Automatyczny report do właściciela przy wykryciu ataku
  - ALFA EOS Seal: podpisywanie raportów
  - Per-session attack pattern learning
"""
from __future__ import annotations

import hashlib
import importlib
import json
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Any

from filtry_tonoyana.core.cerber import Cerber, CerberPolicy
from filtry_tonoyana.core.exceptions import CerberBlockError


# ── DefenseReport ────────────────────────────────────────────────────────────

@dataclass
class DefenseFinding:
    """Pojedyncze znalezisko z defensywnej analizy."""
    tool:     str
    severity: str     # CRITICAL | HIGH | MEDIUM | LOW | INFO
    code:     str     # krótki kod problemu
    message:  str
    location: str = ""


@dataclass
class DefenseReport:
    """
    Pełny raport defensywny generowany przez CerberDefenseLayer.
    Przekazywany właścicielowi / Guardian / ALFA Brain.
    """
    ts:            str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    tools_used:    list[str] = field(default_factory=list)
    findings:      list[DefenseFinding] = field(default_factory=list)
    integrity_ok:  Optional[bool] = None
    integrity_hash: Optional[str] = None
    blocked:       bool = False
    block_reason:  str = ""

    @property
    def critical_count(self) -> int:
        return sum(1 for f in self.findings if f.severity == "CRITICAL")

    @property
    def high_count(self) -> int:
        return sum(1 for f in self.findings if f.severity == "HIGH")

    def to_dict(self) -> dict:
        return {
            "ts":             self.ts,
            "tools_used":     self.tools_used,
            "blocked":        self.blocked,
            "block_reason":   self.block_reason,
            "integrity_ok":   self.integrity_ok,
            "integrity_hash": self.integrity_hash,
            "findings_count": len(self.findings),
            "critical":       self.critical_count,
            "high":           self.high_count,
            "findings": [
                {"tool": f.tool, "severity": f.severity,
                 "code": f.code, "message": f.message[:200],
                 "location": f.location}
                for f in self.findings
            ],
        }


# ── Wbudowane wzorce defensywne (YARA-like, bez zewnętrznych zależności) ──────

_MALWARE_PATTERNS: list[tuple[str, str, str]] = [
    # (severity, code, pattern)
    ("CRITICAL", "EXEC_SHELL",    r"(?i)(os\.system|subprocess\.call|eval\(|exec\(|__import__\()"),
    ("CRITICAL", "REVERSE_SHELL", r"(?i)(bash\s+-i|/dev/tcp|nc\s+-e|ncat|netcat.*-e)"),
    ("HIGH",     "EXFIL_DNS",     r"(?i)(nslookup|dig\s+\S+\.\S+|curl.*attacker|wget.*evil)"),
    ("HIGH",     "ENCODED_PAYLOAD", r"(?i)(base64.*decode|frombase64|b64decode|rot13)"),
    ("HIGH",     "CRYPTO_MINER",  r"(?i)(xmrig|minerd|cryptonight|stratum\+tcp)"),
    ("MEDIUM",   "OBFUSCATION",   r"(?i)(chr\(\d+\)|\\x[0-9a-f]{2}|\\u[0-9a-f]{4}){3,}"),
    ("MEDIUM",   "CREDENTIAL_HARVEST", r"(?i)(steal.*password|harvest.*cred|dump.*hash|mimikatz)"),
    ("LOW",      "SUSPICIOUS_URL", r"(?i)https?://\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}[/:]"),
]

_COMPILED_PATTERNS = [
    (sev, code, re.compile(pat))
    for sev, code, pat in _MALWARE_PATTERNS
]

# ── CerberDefenseLayer ────────────────────────────────────────────────────────

class CerberDefenseLayer:
    """
    Defensywna warstwa Cerbera.

    Metody:
      scan_content(text)         → DefenseReport (wzorce + opcjonalnie bandit)
      scan_python_code(code)     → DefenseReport (bandit jeśli dostępny)
      check_dependencies(pkgs)   → DefenseReport (safety jeśli dostępny)
      verify_integrity(data, h)  → bool (sha256 match)
    """

    def __init__(
        self,
        use_bandit:   bool = True,
        use_safety:   bool = True,
        block_on_critical: bool = True,
        block_on_high:     bool = False,
    ):
        self.use_bandit        = use_bandit
        self.use_safety        = use_safety
        self.block_on_critical = block_on_critical
        self.block_on_high     = block_on_high
        self._bandit_available = self._check_tool("bandit")
        self._safety_available = self._check_tool("safety")

    @staticmethod
    def _check_tool(name: str) -> bool:
        """Sprawdza czy narzędzie jest dostępne w PATH lub jako Python package."""
        try:
            result = subprocess.run(
                [name, "--version"],
                capture_output=True, timeout=3
            )
            return result.returncode == 0
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False

    # ── Skanowanie zawartości ────────────────────────────────────────────────

    def scan_content(self, text: str) -> DefenseReport:
        """
        Skanuje dowolny tekst wbudowanymi wzorcami (YARA-like).
        Nie wymaga zewnętrznych narzędzi.
        """
        report = DefenseReport(tools_used=["builtin_patterns"])
        for severity, code, pattern in _COMPILED_PATTERNS:
            m = pattern.search(text)
            if m:
                report.findings.append(DefenseFinding(
                    tool="builtin_patterns",
                    severity=severity,
                    code=code,
                    message=f"Wykryto wzorzec '{code}': ...{m.group(0)[:60]}...",
                ))
        self._evaluate_block(report)
        return report

    def scan_python_code(self, code: str) -> DefenseReport:
        """
        Skanuje kod Python.
        Używa bandit jeśli dostępny, inaczej tylko wbudowane wzorce.
        """
        report = self.scan_content(code)

        if self.use_bandit and self._bandit_available:
            bandit_findings = self._run_bandit(code)
            report.findings.extend(bandit_findings)
            if "bandit" not in report.tools_used:
                report.tools_used.append("bandit")
            self._evaluate_block(report)

        return report

    def check_dependencies(self, requirements: list[str]) -> DefenseReport:
        """
        Sprawdza zależności pod kątem znanych CVE.
        Używa safety jeśli dostępny.
        """
        report = DefenseReport()

        if self.use_safety and self._safety_available:
            findings = self._run_safety(requirements)
            report.findings.extend(findings)
            report.tools_used.append("safety")
        else:
            report.tools_used.append("builtin_dep_check")
            # Prosta heurystyka: znane podatne paczki
            vulnerable_patterns = re.compile(
                r"(?i)(pyyaml[<= ]*5\.[01]|pillow[<= ]*[78]\.|"
                r"cryptography[<= ]*3\.[0-3]|requests[<= ]*2\.2[0-5])"
            )
            req_str = "\n".join(requirements)
            if vulnerable_patterns.search(req_str):
                report.findings.append(DefenseFinding(
                    tool="builtin_dep_check",
                    severity="HIGH",
                    code="KNOWN_VULNERABLE_DEP",
                    message="Potencjalnie podatna zależność (sprawdź z safety)",
                ))

        self._evaluate_block(report)
        return report

    @staticmethod
    def verify_integrity(data: bytes, expected_sha256: str) -> bool:
        """Weryfikuje integralność danych przez sha256."""
        actual = hashlib.sha256(data).hexdigest()
        return actual == expected_sha256

    @staticmethod
    def compute_hash(data: bytes) -> str:
        """Oblicza sha256 hash danych."""
        return hashlib.sha256(data).hexdigest()

    # ── Wewnętrzne ───────────────────────────────────────────────────────────

    def _evaluate_block(self, report: DefenseReport) -> None:
        """Ustawia report.blocked jeśli progi są przekroczone."""
        if self.block_on_critical and report.critical_count > 0:
            report.blocked = True
            report.block_reason = (
                f"{report.critical_count} CRITICAL findings: "
                + ", ".join(f.code for f in report.findings if f.severity == "CRITICAL")
            )
        elif self.block_on_high and report.high_count > 0:
            report.blocked = True
            report.block_reason = (
                f"{report.high_count} HIGH findings"
            )

    def _run_bandit(self, code: str) -> list[DefenseFinding]:
        """Uruchamia bandit na kodzie Python."""
        findings: list[DefenseFinding] = []
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".py", delete=False, encoding="utf-8"
            ) as tmp:
                tmp.write(code)
                tmp_path = tmp.name

            result = subprocess.run(
                ["bandit", "-f", "json", "-q", tmp_path],
                capture_output=True, text=True, timeout=15
            )
            Path(tmp_path).unlink(missing_ok=True)

            if result.stdout:
                data = json.loads(result.stdout)
                for issue in data.get("results", []):
                    sev_map = {"HIGH": "CRITICAL", "MEDIUM": "HIGH", "LOW": "MEDIUM"}
                    severity = sev_map.get(issue.get("issue_severity", "LOW"), "LOW")
                    findings.append(DefenseFinding(
                        tool="bandit",
                        severity=severity,
                        code=issue.get("test_id", "B000"),
                        message=issue.get("issue_text", ""),
                        location=f"line {issue.get('line_number', '?')}",
                    ))
        except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError):
            pass
        return findings

    def _run_safety(self, requirements: list[str]) -> list[DefenseFinding]:
        """Sprawdza zależności przez safety check."""
        findings: list[DefenseFinding] = []
        try:
            req_str = "\n".join(requirements)
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".txt", delete=False, encoding="utf-8"
            ) as tmp:
                tmp.write(req_str)
                tmp_path = tmp.name

            result = subprocess.run(
                ["safety", "check", "-r", tmp_path, "--json"],
                capture_output=True, text=True, timeout=30
            )
            Path(tmp_path).unlink(missing_ok=True)

            if result.stdout:
                data = json.loads(result.stdout)
                vulns = data if isinstance(data, list) else data.get("vulnerabilities", [])
                for v in vulns:
                    pkg  = v[0] if isinstance(v, list) else v.get("package_name", "?")
                    cve  = v[4] if isinstance(v, list) and len(v) > 4 else v.get("CVE", "?")
                    msg  = v[3] if isinstance(v, list) and len(v) > 3 else v.get("advisory", "?")
                    findings.append(DefenseFinding(
                        tool="safety",
                        severity="HIGH",
                        code=f"CVE:{cve}",
                        message=f"{pkg}: {str(msg)[:120]}",
                    ))
        except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError, IndexError):
            pass
        return findings


# ── CerberHybrid ──────────────────────────────────────────────────────────────

class CerberHybrid(Cerber):
    """
    Cerber Hybrid v0.3 — Immune Engine + Defender.

    Rozszerza Cerber o defensywną warstwę CerberDefenseLayer.
    Właściciel (Karen / ALFA Brain) dostaje pełny obraz:
    - co chciał zrobić (attack simulation → validate_action)
    - co zagraża systemowi (defense scan → defend)
    - wszystko w jednym (full_scan)

    Użycie:
        cerber = CerberHybrid()
        # atak simulation (jak dotychczas)
        cerber.validate_action(action)   # rzuca CerberBlockError

        # defensywna analiza contentu
        report = cerber.defend("kod lub tekst do analizy")
        if report.blocked:
            raise CerberBlockError(reason=report.block_reason)

        # lub oba razem:
        defense_report = cerber.full_scan(action, content="kod z zewnątrz")
    """

    def __init__(
        self,
        policy: Optional[CerberPolicy] = None,
        debug:  bool = False,
        defense_layer: Optional[CerberDefenseLayer] = None,
    ):
        super().__init__(policy=policy, debug=debug)
        self.defense = defense_layer or CerberDefenseLayer()

    def defend(
        self,
        content: str,
        content_type: str = "text",  # "text" | "python" | "requirements"
    ) -> DefenseReport:
        """
        Defensywna analiza zawartości.
        content_type:
          "text"         — skanowanie wzorcami (zawsze)
          "python"       — skanowanie kodu Python (bandit jeśli dostępny)
          "requirements" — sprawdzenie zależności (safety jeśli dostępny)
        """
        if content_type == "python":
            return self.defense.scan_python_code(content)
        if content_type == "requirements":
            reqs = [line.strip() for line in content.splitlines() if line.strip()]
            return self.defense.check_dependencies(reqs)
        return self.defense.scan_content(content)

    def full_scan(
        self,
        action,
        content: Optional[str] = None,
        content_type: str = "text",
    ) -> DefenseReport:
        """
        Pełny skan: najpierw attack simulation, potem defense scan.
        Rzuca CerberBlockError jeśli attack simulation wykryje zagrożenie.
        Zwraca DefenseReport z wynikami defensywnej analizy.
        """
        # 1. Attack simulation (może rzucić CerberBlockError)
        self.validate_action(action)

        # 2. Defense scan (jeśli jest co skanować)
        if content:
            return self.defend(content, content_type=content_type)

        return DefenseReport(tools_used=["attack_simulation_only"])

    @property
    def defense_tools(self) -> list[str]:
        """Lista dostępnych narzędzi defensywnych."""
        tools = ["builtin_patterns"]
        if self.defense._bandit_available:
            tools.append("bandit")
        if self.defense._safety_available:
            tools.append("safety")
        return tools
