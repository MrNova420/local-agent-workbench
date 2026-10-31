from sidecar.providers.contracts import ModelDescriptor
from sidecar.providers.registry import ProviderRegistry


def test_provider_model_identity_is_not_its_display_name():
    ollama = ModelDescriptor(provider_id="ollama", model_id="team/model:latest", display_name="Coder 9B")
    gguf = ModelDescriptor(provider_id="llama.cpp", model_id="gguf::C:/models/model.gguf", display_name="Coder 9B")
    assert ollama.key != gguf.key
    assert ollama.to_dict()["display_name"] == gguf.to_dict()["display_name"]


def test_registry_routes_model_by_stable_provider_reference():
    ollama = type("Ollama", (), {"provider_id": "ollama", "owns": lambda self, value: not value.startswith("gguf::")})()
    llama = type("Llama", (), {"provider_id": "llama.cpp", "owns": lambda self, value: value.startswith("gguf::")})()
    registry = ProviderRegistry([ollama, llama])
    assert registry.resolve("gguf::C:/models/a.gguf") is llama
    assert registry.resolve("team/a:latest") is ollama
