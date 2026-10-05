"""Actual Jarvis discovery and tool adapter talking to the platform over stdio.

No model or phone is simulated. Approval is queued locally; a dispatch against
the unavailable Android service records a real failed receipt.
"""

import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

from tests import test_core_service

HEADERS = test_core_service.HEADERS
client = test_core_service.client


def test_jarvis_discovers_platform_and_reads_durable_failed_receipt(
    client, tmp_path: Path, monkeypatch
):
    root = Path(__file__).resolve().parents[1]
    jarvis_src = root / "repos/nextgent-openjarvis-claude-repo-code-analysis-y4n1k7/src"
    platform_src = root / "repos/nextgent-platform-main/src"
    monkeypatch.syspath_prepend(str(jarvis_src))
    monkeypatch.setenv("NEXTGENT_PYTHON", sys.executable)
    monkeypatch.setenv(
        "PYTHONPATH", os.pathsep.join([str(jarvis_src), str(platform_src)])
    )
    from openjarvis.mcp.loader import load_mcp_tools_from_config

    names = {
        "nextgent_execute_capability",
        "nextgent_action_status",
        "nextgent_capabilities",
    }
    (tmp_path / "servers.json").write_text(
        json.dumps(
            [
                {
                    "name": "nextgent",
                    "command": "bash",
                    "args": [str(root / "integration/nextgent-mcp.sh")],
                    "include_tools": sorted(names),
                }
            ]
        )
    )
    tools, clients = load_mcp_tools_from_config(
        SimpleNamespace(enabled=True, servers="servers.json"), config_dir=tmp_path
    )
    try:
        by_name = {tool.spec.name: tool for tool in tools}
        assert set(by_name) == names
        assert len(clients) == 1

        def call(name, **params):
            result = by_name[name].execute(**params)
            assert result.success, result.content
            return json.loads(result.content)

        assert call("nextgent_capabilities")["capabilities"] == [
            "android.settings.open_display"
        ]
        action = {
            "capability": "android.settings.open_display",
            "owner_id": "matt",
            "action_id": "act_jarvis_mcp",
        }
        asked = call("nextgent_execute_capability", **action)
        assert asked["action"]["status"] == "APPROVAL_REQUIRED"
        retry = call("nextgent_execute_capability", **action)
        assert retry["approval"] == asked["approval"]
        assert len(client.get("/sms/out", headers=HEADERS).json()["messages"]) == 1
        # The real owner approves; the absent Android service causes failure.
        approved = client.post(
            "/sms/in",
            headers=HEADERS,
            json={
                "message_id": "jarvis-owner-yes",
                "sender": "+15555550100",
                "body": f"YES {asked['approval']['ref']}",
            },
        )
        assert approved.json()["handled"] == "approved"
        outcome = call("nextgent_action_status", action_id=action["action_id"])
        assert outcome["action"]["status"] == "FAILED"
        assert outcome["receipt"]["result"] == "FAILED"
        assert (
            call("nextgent_execute_capability", **action)["receipt"]
            == outcome["receipt"]
        )
    finally:
        for connection in clients:
            connection.close()
