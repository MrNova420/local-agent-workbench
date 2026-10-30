import asyncio
from pathlib import Path
from unittest.mock import patch

from mcp_support import MCPManager


class Tool:
    name = "echo"
    description = "echo"
    inputSchema = {"type": "object", "properties": {}}


class FakeSession:
    clients = []

    def __init__(self, *_args):
        self.closed = False
        self.clients.append(self)

    async def __aenter__(self):
        return self

    async def initialize(self):
        return None

    async def list_tools(self):
        return type("Result", (), {"tools": [Tool()]})()

    async def call_tool(self, _name, _args):
        return type("Result", (), {"content": [type("Text", (), {"text": "ok"})()]})()

    async def __aexit__(self, *_args):
        self.closed = True


class FakeStdio:
    async def __aenter__(self):
        return (object(), object())

    async def __aexit__(self, *_args):
        return None


def test_local_mcp_discovery_call_and_cleanup(tmp_path: Path):
    async def run():
        manager = MCPManager(tmp_path / "mcp.json")
        manager.servers = {"demo": {"command": "mock-server"}}
        FakeSession.clients.clear()
        with patch("mcp.ClientSession", FakeSession), \
             patch("mcp.StdioServerParameters", lambda **kwargs: kwargs), \
             patch("mcp.client.stdio.stdio_client", lambda _params: FakeStdio()):
            tools = await manager.discover()
            assert tools[0]["function"]["name"] == "mcp__demo__echo"
            assert await manager.call("mcp__demo__echo", {}) == "ok"
            await manager.close()
        assert FakeSession.clients[0].closed
        assert not manager.clients

    asyncio.run(run())
