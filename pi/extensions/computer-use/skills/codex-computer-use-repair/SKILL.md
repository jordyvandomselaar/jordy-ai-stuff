---
name: codex-computer-use-repair
description: Diagnose and repair macOS Pi/Codex Computer Use failures where get_app_state or list_apps hangs, times out, reports Apple event error -1743, or Codex app-server exits before response. Use official Codex Computer Use helpers only and never bypass macOS malware/XProtect warnings.
compatibility: macOS with Codex.app installed in /Applications and the bundled Pi computer-use extension loaded.
---

# Codex Computer Use Repair

Use this when Pi Computer Use on macOS is broken, especially when `get_app_state(...)` or `list_apps`:

- hangs after the internal “Allow Codex to use <app>?” consent prompt,
- times out waiting for Finder/app state,
- returns `Apple event error -1743`, or
- says `codex app-server exited before returning a response`.

## Safety rules

- Use **official Codex/OpenAI install paths only**.
- Do **not** bypass Gatekeeper/XProtect/malware warnings for `codex-aarch64-apple-darwin` or any copied helper.
- Do **not** run installers, bootstrap scripts, or setup commands as part of this repair.
- Before running the Automation-toggle helper script, say that it will open Privacy & Security → Automation and press disabled `Codex Computer Use` checkboxes, then get explicit approval in the current conversation.
- Before resetting TCC permissions with `tccutil reset`, say exactly which bundle IDs will be reset and get explicit approval in the current conversation unless the user has already approved permission repair.
- If macOS shows a password, Touch ID, Privacy & Security, or Automation prompt, let the user approve it. Do not spoof user approval.

## Bundled extension paths

This skill is bundled inside the `computer-use` extension. Resolve relative paths from this skill directory first.

Run shell snippets from this skill directory unless a command says otherwise:

```bash
SKILL_DIR="$PWD"
COMPUTER_USE_EXTENSION_DIR="$(cd "$SKILL_DIR/../.." && pwd)"
```

## Known paths

```bash
CODEX_APP="${PI_CUA_CODEX_APP_PATH:-/Applications/Codex.app}"
CODEX_NODE="${PI_CUA_CODEX_NODE_PATH:-$CODEX_APP/Contents/Resources/node}" # older Codex builds
CODEX_CUA_NODE="$CODEX_APP/Contents/Resources/cua_node/bin/node" # current Codex builds
BUNDLED_CUA="$CODEX_APP/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app"
RUNTIME_CUA="$HOME/.codex/computer-use/Codex Computer Use.app"
PI_CUA_VENDOR="${PI_CUA_NATIVE_APP_PATH:-$COMPUTER_USE_EXTENSION_DIR/vendor/Codex Computer Use.app}"
PI_CUA_LAUNCHER="$COMPUTER_USE_EXTENSION_DIR/launcher.cjs"
```

Bundle IDs seen in TCC/Automation:

- `com.openai.codex`
- `com.openai.sky.CUAService`
- `com.openai.sky.CUAService.cli`

## Repair workflow

### 1. Confirm the failure

Run the Computer Use tool directly first:

```text
get_app_state(app="Finder")
```

If it works, stop. If it hangs/timeouts, continue.

### 2. Inspect helper versions and signatures

```bash
SKILL_DIR="$PWD"
COMPUTER_USE_EXTENSION_DIR="$(cd "$SKILL_DIR/../.." && pwd)"
CODEX_APP="${PI_CUA_CODEX_APP_PATH:-/Applications/Codex.app}"
CODEX_NODE="${PI_CUA_CODEX_NODE_PATH:-$CODEX_APP/Contents/Resources/node}"
CODEX_CUA_NODE="$CODEX_APP/Contents/Resources/cua_node/bin/node"
BUNDLED_CUA="$CODEX_APP/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app"
PI_CUA_VENDOR="${PI_CUA_NATIVE_APP_PATH:-$COMPUTER_USE_EXTENSION_DIR/vendor/Codex Computer Use.app}"

/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$BUNDLED_CUA/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$PI_CUA_VENDOR/Contents/Info.plist" 2>/dev/null || true
codesign --verify --deep --strict "$BUNDLED_CUA"
codesign --verify --deep --strict "$PI_CUA_VENDOR" 2>/dev/null || true
for node in "$CODEX_NODE" "$CODEX_CUA_NODE"; do
  [ -x "$node" ] && codesign --verify --deep --strict "$node"
done
```

If `get_app_state` fails with only `/Applications/Codex.app/Contents/Resources/node` missing, Codex has likely moved Node to `cua_node/bin/node` while the current Pi session still has an older extension version loaded. Verify the extension has both node candidates, then reload Pi with `/reload` or start a new Pi session.

If the Pi vendored helper is missing, stale, or fails codesign, refresh it from the official bundled helper only:

```bash
set -euo pipefail
backup="$PI_CUA_VENDOR.backup.$(date +%Y%m%d-%H%M%S)"
[ -e "$PI_CUA_VENDOR" ] && mv "$PI_CUA_VENDOR" "$backup"
mkdir -p "$(dirname "$PI_CUA_VENDOR")"
cp -R "$BUNDLED_CUA" "$PI_CUA_VENDOR"
codesign --verify --deep --strict "$PI_CUA_VENDOR"
```

### 3. Restart stuck Codex app-server/helper processes

Quit stale app-server/client/helper processes, then reopen Codex.

```bash
for pattern in \
  '/Applications/Codex.app/Contents/Resources/codex app-server --listen stdio://' \
  '/Applications/Codex.app/Contents/Resources/node_repl' \
  '/Applications/Codex.app/Contents/Resources/cua_node/bin/node_repl' \
  'SkyComputerUseClient' \
  'SkyComputerUseService'
do
  pids=$(pgrep -f "$pattern" || true)
  [ -n "$pids" ] && kill $pids || true
done
sleep 1
open "/Applications/Codex.app"
```

Check what remains:

```bash
ps ax -o pid,ppid,comm,args | rg -i 'Codex|SkyComputer|app-server|node_repl' | rg -v rg || true
```

### 4. Fix hidden Automation toggles

The common wedged state is: MCP initializes, Codex internal consent appears, but `tools/call` never returns. The root cause can be a hidden macOS Automation row where **Codex Computer Use → Codex Computer Use** is switched off.

Open the Automation pane:

```bash
open 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation'
```

Then run the bundled helper script from this skill directory:

```bash
swift scripts/enable-codex-computer-use-automation.swift
```

The script opens Privacy & Security → Automation, expands visible disclosure rows, scans rows for `Codex Computer Use`, and presses any disabled checkbox in those rows. It prints how many switches it changed.

If the script cannot find rows, manually search `Codex` in System Settings → Privacy & Security → Automation, expand matching parent apps, and enable every relevant `Codex Computer Use` child switch.

### 5. Reset AppleEvents TCC only if needed

If Automation toggles look correct but calls still fail with `-1743`, ask for approval and then reset AppleEvents for the Codex Computer Use bundle IDs:

```bash
tccutil reset AppleEvents com.openai.sky.CUAService.cli
tccutil reset AppleEvents com.openai.sky.CUAService
tccutil reset AppleEvents com.openai.codex
```

After reset, retry `get_app_state(app="Finder")` and let the user click **Allow** for any macOS Automation prompt.

### 6. Verify

Use the Computer Use tool again:

```text
get_app_state(app="Finder")
```

Success looks like:

```text
Computer Use state (CUA App Version: ...)
App=/System/Library/CoreServices/Finder.app/ ...
Window: "Desktop", App: Finder.
...
```

Once Finder works, optionally verify app listing:

```text
list_apps()
```

## Notes from the original fix

The final fix that worked was:

1. refreshed Pi’s vendored `Codex Computer Use.app` from `/Applications/Codex.app`,
2. killed stale `SkyComputerUse*` / Codex app-server processes,
3. opened System Settings → Privacy & Security → Automation,
4. enabled a hidden off switch for `Codex Computer Use`, and
5. verified `get_app_state(Finder)` returned Finder’s accessibility tree and screenshot.
