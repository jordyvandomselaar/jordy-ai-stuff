# Pi Computer Use Extension

Adds Pi tools backed by OpenAI's signed Codex Computer Use native helper:

- `list_apps`
- `get_app_state`
- `click`
- `perform_secondary_action`
- `set_value`
- `scroll`
- `drag`
- `press_key`
- `type_text`

The native helper bundle is copied into `vendor/Codex Computer Use.app`. The extension launches the helper through an OpenAI-signed Codex Node binary because the helper checks that its responsible process is signed by OpenAI. Current Codex builds use `/Applications/Codex.app/Contents/Resources/cua_node/bin/node`; older builds used `/Applications/Codex.app/Contents/Resources/node`.

If the bundled helper is missing, the extension falls back to the helper inside `/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/`.

## Commands

- `/computer-use-status` — show resolved native paths and process status.
- `/computer-use-reset` — stop the MCP process and clear per-session list-app confirmation.
- `/computer-use-allow-app <app>` — permanently auto-approve Computer Use app approval prompts for an app name, app path, or bundle identifier.
- `/computer-use-deny-app <app>` — remove an app from the permanent Computer Use allowlist.
- `/computer-use-allowed-apps` — show the permanent Computer Use allowlist.
- `/skill:codex-computer-use-repair` — load the bundled repair runbook for hung MCP calls, `-1743` Automation failures, stale native helpers, or broken Codex app-server sessions.

The allowlist is stored in `~/.pi/computer-use-allowlist.json` by default. Prefer bundle identifiers, for example:

```text
/computer-use-allow-app com.apple.Safari
```

Wildcards are intentionally not supported.

## Environment overrides

- `PI_CUA_CODEX_NODE_PATH` — OpenAI-signed Codex Node binary path. Use this if Codex moves Node somewhere other than the built-in candidates.
- `PI_CUA_CODEX_APP_PATH` — Codex.app bundle path when it is not in `/Applications/Codex.app`.
- `PI_CUA_NATIVE_APP_PATH` — `Codex Computer Use.app` bundle path.
- `PI_CUA_ALLOWLIST_PATH` — permanent app allowlist path. Defaults to `~/.pi/computer-use-allowlist.json`.

Reload Pi after editing or installing: `/reload`.

## Bundled repair skill

This extension publishes `skills/codex-computer-use-repair/` through Pi resource discovery. Use it when `get_app_state` or `list_apps` hangs, times out, returns Apple event error `-1743`, or reports that the Codex app-server exited before returning a response.

The skill is deliberately a guided repair runbook, not automatic self-healing: it may kill stale helper processes, refresh the vendored helper from the official Codex bundle, open macOS Privacy & Security, or reset AppleEvents TCC after explicit user approval.

## Refreshing the bundled helper

If Codex.app updates its Computer Use helper, refresh the local copy with:

```sh
cd /path/to/pi/extensions/computer-use
ditto "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app" \
  "vendor/Codex Computer Use.app"
```
