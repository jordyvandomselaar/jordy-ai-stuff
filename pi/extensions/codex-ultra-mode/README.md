# Codex Ultra Mode for Pi

A standalone Pi extension for explicitly enabling Codex's proactive multi-agent delegation policy. Its collaboration baseline is Codex commit [`8cf9a1b1f8ea35c724831a739fea2d725d72c582`](https://github.com/openai/codex/commit/8cf9a1b1f8ea35c724831a739fea2d725d72c582).

Requires Pi 0.80.6 or newer, whose built-in `openai-codex` catalog provides Sol and Terra without replacing configured provider models.

## Usage

1. Select `openai-codex/gpt-5.6-sol` or `openai-codex/gpt-5.6-terra`.
2. Select any supported Pi thinking level, such as `medium`.
3. Run `/ultra` to enable proactive delegation. Run it again to disable the mode.

The footer shows the active mode and thinking level, for example `Ultra (medium)`. The setting persists in the current Pi session. Switching to an unsupported model pauses Ultra until a supported model is selected again.

Ultra does not rewrite provider reasoning effort. The root and every newly spawned child use the thinking level selected in Pi when their runtime is created.

## Collaboration contract

| Capability | Behavior |
| --- | --- |
| Supported models | `openai-codex/gpt-5.6-sol` and `openai-codex/gpt-5.6-terra` |
| Activation | Explicit, session-persistent `/ultra` toggle |
| Reasoning | Preserve Pi's currently selected thinking level |
| Delegation policy | Ultra selects Codex's proactive multi-agent policy; normal mode selects its explicit-request-only policy |
| Collaboration tools | `spawn_agent`, `send_message`, `followup_task`, `wait_agent`, `interrupt_agent`, and `list_agents` |
| Capacity | Four active or reserved agents across the complete tree, including `/root` |
| Context forks | `fork_turns` accepts `none`, `all`, or a positive integer and defaults to `all` |
| Wait bounds | 10-second minimum, 30-second default, one-hour maximum |
| Shutdown bound | Child interruption and unload are bounded to two seconds, with exactly-once late cleanup |

Stable model identities, limits, and source paths are vendored in [`src/ultra-contract.ts`](src/ultra-contract.ts). The exact pinned V2 model-facing tool descriptions and parameter metadata are vendored in [`src/collaboration/tool-contract.ts`](src/collaboration/tool-contract.ts). Runtime code does not read the Codex checkout.

## Standalone boundary

The package exposes only [`src/index.ts`](src/index.ts) through its Pi manifest. It uses Pi's extension and SDK platform and contains no dependency on another Pi plugin. Child-agent execution, scheduling, messaging, policy, provider adaptation, rendering, and cleanup are owned by this package.

Triggering and queue-only child input use one typed `codex-ultra-collaboration` custom-message channel. Root-directed communications are first appended to the owning Pi session and are removed from the coordinator only after that durable append succeeds. A context hook consumes each persisted root communication once, so idle delivery survives until the next provider turn without relying on Pi's transient `nextTurn` queue.

Each spawned actor captures an immutable runtime snapshot from its direct parent. Child sessions disable extension discovery and install only this package's Ultra hooks and six actor-bound collaboration tools. The coordinator remains the sole owner of actor paths and lifecycle state.

Actor path, ancestry, latest task, fork context, effective runtime, and complete child transcript are checkpointed in the owning Pi session as messages settle. Root outbox envelopes use durable collision-resistant identities and survive coordinator replacement independently of model consumption. Session resume reconstructs retained child sessions and follow-up targets; an actor that was still active when the previous runtime ended is restored as interrupted rather than falsely reported as running.

## Collaboration source map

- `codex-rs/core/src/context/multi_agent_mode_instructions.rs`: exact off/on policy text
- `codex-rs/core/src/config/mod.rs`: V2 usage hints, capacity, and wait bounds
- `codex-rs/core/src/tools/handlers/multi_agents_spec.rs`: V2 tool contract
- `codex-rs/core/src/tools/handlers/multi_agents_v2/`: V2 runtime behavior
- `codex-rs/models-manager/models.json`: Sol/Terra Ultra availability
