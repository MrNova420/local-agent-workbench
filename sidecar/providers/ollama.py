from __future__ import annotations

from typing import Any

from .contracts import ModelDescriptor


class OllamaProvider:
    provider_id = "ollama"

    def __init__(self, runtime: Any):
        self.client = runtime

    def owns(self, model_id: str) -> bool:
        return not model_id.startswith("gguf::")

    def models(self) -> list[ModelDescriptor]:
        return [ModelDescriptor(provider_id=self.provider_id, model_id=name, display_name=name,
                                source="ollama library", format="Ollama model", runtime_state="installed")
                for name in self.client.models()]

    def runtime(self, default_runtime: Any) -> Any:
        return default_runtime
