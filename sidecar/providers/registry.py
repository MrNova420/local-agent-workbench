from __future__ import annotations

from typing import Any, Iterable

from .contracts import ModelDescriptor, ProviderAdapter


class ProviderRegistry:
    def __init__(self, providers: Iterable[ProviderAdapter] = ()):
        self._providers: dict[str, ProviderAdapter] = {}
        for provider in providers:
            self.register(provider)

    def register(self, provider: ProviderAdapter) -> None:
        if not provider.provider_id or provider.provider_id in self._providers:
            raise ValueError(f"Provider identifier is empty or already registered: {provider.provider_id}")
        self._providers[provider.provider_id] = provider

    def by_id(self, provider_id: str) -> ProviderAdapter:
        try:
            return self._providers[provider_id]
        except KeyError:
            raise ValueError(f"Unknown model provider: {provider_id}") from None

    def resolve(self, model_id: str, provider_id: str | None = None) -> ProviderAdapter:
        if provider_id:
            provider = self.by_id(provider_id)
            if not provider.owns(model_id):
                raise ValueError(f"Model reference does not belong to provider {provider_id}.")
            return provider
        matches = [provider for provider in self._providers.values() if provider.owns(model_id)]
        if len(matches) != 1:
            raise ValueError("Model reference does not identify exactly one provider.")
        return matches[0]

    def models(self) -> list[ModelDescriptor]:
        return [descriptor for provider in self._providers.values() for descriptor in provider.models()]

    def runtime_for(self, model_id: str, default_runtime: Any, provider_id: str | None = None) -> Any:
        return self.resolve(model_id, provider_id).runtime(default_runtime)
