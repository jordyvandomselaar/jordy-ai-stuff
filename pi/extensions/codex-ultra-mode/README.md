# Codex Ultra Mode for Pi

A Pi extension for explicitly enabling Codex's proactive multi-agent delegation policy. Its collaboration baseline is Codex commit [`f029bb795ccbbd8471511f5a8b93e56d8f2b6d31`](https://github.com/openai/codex/commit/f029bb795ccbbd8471511f5a8b93e56d8f2b6d31).

Agent-role behavior follows Codex commit [`f029bb795ccbbd8471511f5a8b93e56d8f2b6d31`](https://github.com/openai/codex/commit/f029bb795ccbbd8471511f5a8b93e56d8f2b6d31), adapted to Pi's Markdown agent definitions.

Requires Pi 0.80.6 or newer.

## Usage

1. Select any available Pi model.
2. Select any supported Pi thinking level, such as `medium`.
3. Run `/ultra` to toggle proactive delegation.

The footer shows the active mode and thinking level, for example `Ultra (medium)`. The setting persists in the current Pi session and remains enabled when switching models. Ultra pauses only when no model is active.

Ultra does not rewrite provider reasoning effort. The root and every newly spawned child use the thinking level selected in Pi when their runtime is created.

## Configuration

Ultra allows three spawned agents by default. `/root` does not consume a configured subagent slot, so the default permits four active agents in total.

Set `defaultsOn` or `maxConcurrentThreadsPerSession` in one of these JSON files:

- `$PI_CODING_AGENT_DIR/codex-ultra-mode.json` for all projects. Pi uses `~/.pi/agent` when `PI_CODING_AGENT_DIR` is not set.
- `<project>/.pi/codex-ultra-mode.json` for one trusted project. Project configuration overrides the global value.

For example, this enables Ultra for new sessions and permits `/root` plus up to eight subagents:

```json
{
  "defaultsOn": true,
  "maxConcurrentThreadsPerSession": 8
}
```

`defaultsOn` defaults to `false`. It applies when a session has no saved `/ultra` choice, so toggling Ultra still wins when that session is resumed. `maxConcurrentThreadsPerSession` counts spawned agents rather than `/root` and must be a safe integer of at least `1`. Configuration is loaded when a Pi session starts, so start a new session after changing it.

`spawn_agent` exposes per-child `model` and `reasoning_effort` overrides by default. Set `exposeSpawnAgentModelOverrides` to `false` to hide them. Set `waitAgentEnabled` to `false` to remove `wait_agent` from the collaboration tool surface.

## Agent roles

Ultra discovers Pi agent definitions from:

- `$PI_CODING_AGENT_DIR/agents/*.md` for global roles.
- The nearest trusted `<project>/.pi/agents/*.md` directory for project roles.

Project roles replace global roles with the same `name`. Untrusted project roles are never loaded.

```markdown
---
name: worker
description: Use for execution and production work.
model: openai-codex/gpt-5.6-sol
thinking: high
tools: read, write, bash
---

Own the assigned files and do not revert another agent's work.
```

Supported frontmatter fields are `name`, `description`, `model`, `thinking`, and `tools`. The Markdown body is appended as role-specific system instructions. A role's model, thinking level, and tools take precedence over spawn-time overrides. A tools list narrows the parent's active tools; collaboration tools remain available.

When at least one role is available, `spawn_agent` exposes `agent_type`. Explicit role selection requires `fork_turns="none"` or a positive integer. A full-history fork inherits its parent's role configuration.

Run `/ultra-agents-init` to scaffold Codex's `default`, `explorer`, and `worker` Markdown roles. The command asks whether to use the global or current project's agent directory. Missing defaults are created immediately. Identical files are left alone; if a default file has been customized or an upstream template changes, the command asks before replacing the differing defaults. Other agent files are never touched, so the command is safe to rerun when Ultra adds new built-in roles.

## Collaboration contract

| Capability | Behavior |
| --- | --- |
| Supported models | Any active Pi model |
| Activation | Session-persistent `/ultra` toggle, initially controlled by `defaultsOn` |
| Reasoning | Preserve Pi's currently selected thinking level |
| Delegation policy | Ultra selects Codex's proactive multi-agent policy; normal mode selects its explicit-request-only policy |
| Collaboration tools | `spawn_agent`, `send_message`, `followup_task`, `interrupt_agent`, `list_agents`, and optionally `wait_agent` |
| Capacity | Three spawned agents by default, plus `/root` |
| Context forks | `fork_turns` accepts `none`, `all`, or a positive integer and defaults to `all` |
| Agent roles | Global and trusted-project Pi agent Markdown; selected with `agent_type` |
| Wait bounds | 10-second minimum, 30-second default, one-hour maximum |
| Shutdown bound | Child interruption and unload are bounded to two seconds, with exactly-once late cleanup |

Pinned policy text, collaboration tool names, shutdown limits, and source paths are vendored in [`src/ultra-contract.ts`](src/ultra-contract.ts). The exact pinned V2 model-facing tool descriptions and parameter metadata are vendored in [`src/collaboration/tool-contract.ts`](src/collaboration/tool-contract.ts). Runtime code does not read the Codex checkout.

## Runtime architecture

Triggering and queue-only child input use one typed `codex-ultra-collaboration` custom-message channel. Root-directed communications are first appended to the owning Pi session and are removed from the coordinator only after that durable append succeeds. A context hook consumes each persisted root communication once, so idle delivery survives until the next provider turn without relying on Pi's transient `nextTurn` queue.

Each spawned actor captures an immutable runtime snapshot from its direct parent. Child sessions reload the parent's active extension sources and install Ultra hooks and six actor-bound collaboration tools. Parent-only SDK-injected and inline tools are omitted because Pi cannot recreate their executable definitions. The coordinator remains the sole owner of actor paths and lifecycle state.

Actor path, ancestry, latest task, fork context, effective runtime, and complete child transcript are checkpointed in the owning Pi session as messages settle. Root outbox envelopes use durable collision-resistant identities and survive coordinator replacement independently of model consumption. Session resume reconstructs retained child sessions and follow-up targets; an actor that was still active when the previous runtime ended is restored as interrupted rather than falsely reported as running.

## Collaboration source map

- `codex-rs/core/src/context/multi_agent_mode_instructions.rs`: exact off/on policy text
- `codex-rs/core/src/config/mod.rs`: V2 usage hints, capacity, and wait bounds
- `codex-rs/core/src/tools/handlers/multi_agents_spec.rs`: V2 tool contract
- `codex-rs/core/src/tools/handlers/multi_agents_v2/`: V2 runtime behavior
