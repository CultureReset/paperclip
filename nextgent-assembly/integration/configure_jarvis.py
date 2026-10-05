#!/usr/bin/env python3
"""Wire existing Jarvis configuration to existing Paperclip/platform MCP blocks.

Writes only a new config directory. No service, model, device or database starts.
"""

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--owner-id", required=True, help="The same NEXTGENT_OWNER_ID used by core"
)
parser.add_argument(
    "--output", required=True, type=Path, help="New Jarvis configuration directory"
)
args = parser.parse_args()
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)
paths = [out / name for name in ("config.toml", "mcp-servers.json", "INSTRUCTIONS.md")]
if any(path.exists() for path in paths):
    parser.error(
        "Configuration files already exist; choose a new directory to preserve them"
    )

store = ROOT / "repos/nextgent-store-codex-paperclip-service-activation/jarvis"
ghost = ROOT / "repos/nextgent-openjarvis-claude-repo-code-analysis-y4n1k7/deploy/ghost"
servers = json.loads((store / "mcp-servers.example.json").read_text())
servers[0]["args"] = [str(store / "paperclip-mcp.sh")]
servers.append(
    {
        "name": "nextgent",
        "command": "bash",
        "args": [str(ROOT / "integration/nextgent-mcp.sh")],
        "include_tools": [
            "nextgent_execute_capability",
            "nextgent_action_status",
            "nextgent_capabilities",
        ],
    }
)
config = (ghost / "config.toml.example").read_text()
config = re.sub(
    r"servers = '''.*?'''", 'servers = "mcp-servers.json"', config, flags=re.DOTALL
)
config = config.replace(
    'default_agent = "orchestrator"',
    'default_agent = "orchestrator"\nsystem_prompt_path = '
    + json.dumps(str(out / "INSTRUCTIONS.md")),
)
instructions = (store / "INSTRUCTIONS.md").read_text() + (
    "\nFor local Android capabilities, use nextgent_execute_capability with owner_id "
    + json.dumps(args.owner_id)
    + ". Policy, owner approval, App Maps, verification and receipts "
    "belong to nextgent-platform. Read action status and receipt.result before reporting an outcome. "
    "Reuse the same action_id when checking or retrying a request; never replay a settled or uncertain "
    "device action. A successful MCP response alone does not mean the physical action succeeded.\n"
)
paths[0].write_text(config)
paths[1].write_text(json.dumps(servers, indent=2) + "\n")
paths[2].write_text(instructions)
print(
    f"Prepared {out / 'config.toml'}; retain the existing model settings and configure service credentials in the environment."
)
