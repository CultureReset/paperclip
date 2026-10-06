# Python and Bash helpers in App Maps

Helpers live beside their versioned `map.yaml` in the maps repository. Publish the entire pinned repository commit through the existing signed Ghost plan in **Plat-admin → App Maps & box updates**. The existing updater installs the accepted bundle and restarts map consumers. Do not publish loose scripts through a separate execution service.

```yaml
helpers:
  choose_text:
    path: helpers/choose_text.py
    interpreter: python  # or bash
    timeout_s: 15       # 1–60 seconds
```

A transition selects a declared helper with `action: {helper: choose_text}`. Its existing `from`, `to`, and `expect` states still apply. A helper receives JSON on stdin containing `parameters`, the observed UI `snapshot`, and `environment_id`. It prints exactly one existing map action as JSON on stdout:

```python
import json
import sys
request = json.load(sys.stdin)
print(json.dumps({"type_text": request["parameters"]["message"]}))
```

For Bash, `printf '%s' '{"home":true}'` selects Home. Scripts can inspect the scraped UI and compute selectors/actions. Multiple physical steps use multiple map transitions, preserving observation between steps. Cursor/Android execution remains in the existing executor. This interface does not hand a script an unrestricted raw ADB command endpoint.

Paths are relative to the map directory; missing files, traversal and escaping symlinks are rejected. Python uses the core's interpreter; Bash runs without profile or rc files. Parameters are JSON, never interpolated into a shell command. Nonzero exit, timeout, malformed/oversized output and nested helper actions fail execution. Helpers inherit PATH and locale, not unrelated core service secrets.

These are administrator-published executable programs, **not a sandbox for untrusted code**. Sign/review the complete bundle and its dependencies. Bundled scripts can use dependencies already installed in that box environment; do not assume a new Python dependency arrives merely by publishing a map. Existing capability policy, owner approval and release permission consent still gate execution. A zero exit code cannot mark success: the runner observes the phone again, checks the declared destination, and the existing verifier/receipt flow remains authoritative.

Run the maps validator before publication and the platform helper tests against the runtime. These tests use fixture phones; a released map still needs acceptance on the actual reference phone.
