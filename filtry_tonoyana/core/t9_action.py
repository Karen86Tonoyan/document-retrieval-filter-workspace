"""
alfa/agent_browser/t9_action.py
T9Action — standaryzowana akcja wychodząca z T9 Classifier.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from enum import Enum
from typing import Optional
import json
from datetime import datetime, timezone


class T9ActionType(str, Enum):
    READ = "READ"
    CLICK = "CLICK"
    FILL = "FILL"
    SUBMIT = "SUBMIT"
    DOWNLOAD = "DOWNLOAD"


@dataclass(slots=True)
class T9Action:
    """Standaryzowana akcja wychodząca z T9 Classifier."""
    action: T9ActionType
    domain: str
    session_id: str
    timestamp: str = ""
    target_ref: Optional[str] = None
    value: Optional[str] = None
    url: Optional[str] = None
    confidence: float = 0.0
    risk_score: float = 0.0

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> dict:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)

    @classmethod
    def from_json(cls, data: str | dict) -> "T9Action":
        if isinstance(data, str):
            data = json.loads(data)
        return cls(**data)
