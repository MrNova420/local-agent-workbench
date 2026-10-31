from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from llama_cpp_runtime import LlamaCppRuntime

from .contracts import ModelDescriptor


class LlamaCppProvider:
    provider_id = "llama.cpp"

    def __init__(self, server: Any, models: Callable[[], list[dict[str, Any]]]):
        self.server, self._models = server, models

    def owns(self, model_id: str) -> bool:
        return model_id.startswith("gguf::")

    def models(self) -> list[ModelDescriptor]:
        return [ModelDescriptor(provider_id=self.provider_id, model_id=row["id"],
                                display_name=row.get("label") or Path(row["path"]).name,
                                source=(row.get("source") or {}).get("repo", "local GGUF"), format="GGUF",
                                context=row.get("context"), context_known=isinstance(row.get("context"), int),
                                reasoning={"support": "levels", "default": "auto",
                                           "values": [False, True, "minimal", "low", "medium", "high", "xhigh", "max"]},
                                tools="chat-template dependent", runtime_state="loaded" if self.server.status().get("model") == row.get("path") else "available")
                for row in self._models()]

    def runtime(self, default_runtime: Any) -> Any:
        return LlamaCppRuntime(self.server)
