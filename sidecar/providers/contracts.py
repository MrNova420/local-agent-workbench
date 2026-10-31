from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True)
class ModelDescriptor:
    provider_id: str
    model_id: str
    display_name: str
    source: str = "local"
    format: str = "unknown"
    context: int | None = None
    context_known: bool = False
    max_output_tokens: int | None = None
    reasoning: dict[str, Any] = field(default_factory=lambda: {"support": "unknown", "default": None, "values": []})
    tools: str = "unknown"
    runtime_state: str = "available"

    @property
    def key(self) -> str:
        return f"{self.provider_id}::{self.model_id}"

    def to_dict(self) -> dict[str, Any]:
        return {**asdict(self), "key": self.key}


class ProviderAdapter(Protocol):
    provider_id: str
    def owns(self, model_id: str) -> bool: ...
    def models(self) -> list[ModelDescriptor]: ...
    def runtime(self, default_runtime: Any) -> Any: ...
