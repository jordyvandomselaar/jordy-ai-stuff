# Context windows

Use local checkpoints and history retrieval instead of conversation summaries. Enable the extension for individual provider/model pairs. The preference survives restarts.

## Commands

```text
/context-windows on
/context-windows off
/context-windows status
/context-windows reset
/context-windows budget 200000
/context-windows budget default
```

`on`, `off`, and `budget` apply to the currently selected provider and model. Run them while Pi is idle. `budget <tokens>` saves a positive whole-token work limit, capped at the model's default work limit. `budget default` restores the model-derived limit.

`/compact [instructions]` and `/context-windows reset` ask the current agent to create or update `checkpoint.md` before resetting. The agent keeps the current context and can use only the notes and history tools during this step. The reset waits for a fresh, nonempty checkpoint and a successful end to the run. Cancelling or failing keeps the current window. New input during `/context-windows reset` cancels the reset and preserves the input. Native `/compact` rejects new prompts until compaction finishes. A completed reset reports its new window ID and stays idle. The next user request can recover the checkpoint and continue unfinished authorized work.

If a `pi-goal` goal is active, run `/goal pause` before a manual reset. Its automatic continuation prevents the checkpoint run from settling. The extension rejects this case before starting the checkpoint; it never silently pauses, resumes, or completes a goal. Automatic window resets remain available while a goal is active.

The commands save configuration automatically to `$PI_CODING_AGENT_DIR/context-windows.json`, or `~/.pi/agent/context-windows.json`. You do not need to edit this file. For reference, the stored format looks like this:

```json
{
  "version": 1,
  "enabledModels": ["example-provider/example-model"],
  "workBudgets": {
    "example-provider/example-model": 200000
  }
}
```

The commands use the selected model's actual provider and model ID in place of `example-provider/example-model`. `workBudgets` is optional. Writes use an atomic rename and a cross-process lock. If a crashed process leaves `context-windows.json.lock`, confirm no session is saving the config before removing that empty lock directory.

## Install

Install the extension from the repository:

```bash
pi install git:github.com/jordyvandomselaar/jordy-ai-stuff
```

Then run these commands in Pi to load it and enable it for the selected model:

```text
/reload
/context-windows on
```

Requires Pi 0.85.1 or later. No Pi core patches, external backend, or extra credentials are required. Tool-capable models can use the extension. Model quality after a reset depends on checkpointing and history retrieval.

## Tools

- `context_notes`: list, read, search, write, or append branch-local virtual notes. Lists show recently updated notes first with byte sizes and update timestamps; `order: "name"` sorts by path. Keep the task checkpoint in `checkpoint.md`.
- `context_history`: list windows, list messages, read an item, or search original message text. Lists and searches show newest entries first; `order: "oldest"` reverses that order. Reads are bounded and support one image attachment at a time.
- `get_context_remaining`: show the estimated current-window budget.
- `new_context`: request a reset after the current tool batch completes.

Notes use virtual relative paths. They cannot read or write filesystem paths, unrelated sessions, or sibling branches. Each note has a 1,000,000-byte UTF-8 limit; a branch supports at most 100 note paths. Read/search results are paged. Original user messages and their authority remain intact. Notes never grant new permission.

Checkpoint the requested outcome, constraints, accepted corrections, completed work, remaining work, verification results, and useful history IDs. After resetting, the model reads its checkpoint and retrieves missing details from original history.

## Window behavior

The normal work budget is 90% of the active model's declared context window, matching Codex's default calculation. A warning appears 6,144 tokens before checkpointing is due. The reset threshold is the smaller of the work budget plus 16,384 checkpoint tokens and 95% of the model's context window. Both thresholds round down to whole tokens. An explicit work budget can lower the work threshold. If the model's capacity is unknown, the tool reports null limits and automatic resets stay off unless you set an explicit budget. Manual and model-requested resets still work.

A model declaring 272,000 tokens gets a 244,800-token work budget and a 258,400-token reset threshold. A model declaring 872,000 tokens gets a 784,800-token work budget and an 801,184-token reset threshold. The extension uses Pi's model metadata, which may differ from Codex's catalog. Counts combine provider usage and estimates; they are not exact tokenization.

The extension checks the work window before new prompts and after tool turns. When the work budget is exhausted, the checkpoint instruction requires one note write or append followed by `new_context`, not a final answer. Text-only replies save warnings for the next request without starting an extra turn. Queued user follow-ups above the hard threshold enter a fresh window. Old-window warnings never carry into the new window.

Budget and model-requested resets happen after tools finish, inside the running agent loop. They do not call native manual compaction, end the agent run, or submit a replacement user request. A correction queued beside `new_context` stays in the fresh request, rather than running once in the old window and then disappearing. The original transcript stays in the same Pi session. Resume and forks restore window and note state from the session branch.

Automatic capacity resets and overflow recovery receive local recovery instructions without generating a checkpoint. Native manual `/compact` interrupts the current run, saves a checkpoint, and resets without restarting the task. `/context-windows reset` requires an idle agent and follows the same checkpoint and reset steps. For very small sessions, Pi may reject `/compact` before extensions run; use `/context-windows reset` instead.

Disabling prevents new automatic soft-budget resets and hides `new_context`. A session that already reset keeps its current window and recovery tools, so disabling or switching models never resends all historical messages. That session retains local recovery at Pi's capacity boundary. Fresh sessions for the disabled model use normal Pi compaction. Keep the extension loaded for sessions that contain its window records.

## Live context and extension integration

The system prompt remains in each request. Ultra mailbox context already rebuilds from branch-persisted deliveries and appends to the request. Permission Gate keeps authorization outside the projected messages; resets do not modify it.

For `pi-goal`, the extension reads the latest branch-persisted goal state and adds a transient recovery message. It reflects active, paused, budget-limited, complete, and cleared states without replaying stale goal events. It does not change goal state or authorization.

Every reset emits `context-windows:reset` with `{ sessionId, window, previous, reason }`. Other extensions should rebuild live context from their own state and append it in their `context` handler. Do not remove the window marker. Custom resets do not synthesize `session_compact`; that event carries real native compaction records and has different consumers. The extension does not replay arbitrary session-start hooks or restore unknown extensions' old messages.

## Caching

System instructions, tool schemas, the session cache key, and each window's recovery message stay stable between calls. Note changes stay outside the prompt until read. Budget warnings append at the tail. A reset changes the conversation prefix once; the next window grows normally.

A reset tells the updated `pi-codex-tools` extension to close the old Codex WebSocket continuation. It preserves the session cache key, active Codex turn-routing state, and any pending `end_turn: false` continuation. The next real task clears turn-scoped state. `pi-codex-tools` also declines native compaction when this extension owns the session. The extensions communicate through optional events and do not import one another.

## Scope and limits

- This is local context management, not Codex's private encrypted history service. Notes and tool outputs appear in the local session log.
- The old transcript remains in local memory and on disk. This is not a disk-space cleanup tool.
- History currently covers the active session branch, not arbitrary agents or other sessions. Provider-encrypted reasoning is not exposed as text.
- Other context extensions should append live context after the window boundary. Rewriting or removing the boundary causes an explicit error and stops tools.
- Codex transport exposes the model's `end_turn` continuation signal. The Vercel adapter does not expose that signal; a text-only final response cannot be treated as an unfinished turn by guessing. Tool-based continuation works on both adapters.
- Use the included `pi-codex-tools` integration when both extensions are installed. Other compaction extensions must yield ownership rather than compete.
- Permission Gate, goal state, and session identity are retained. A reset does not extend authorization or start proactive follow-up work.

## Validation

The implementation was checked with real Pi 0.85.1 sessions and scripted model responses for two resets, history recovery, per-model command persistence, disable/model switching, threshold resets, overflow retry, rejected note paths, resume, and fork isolation. Manual-reset checks cover staying idle after an interrupted run and recovering on the next user request, checkpoint creation and replacement, repeated compaction, disk recovery, cancelled runs, new user input, provider errors, failed writes, stale or empty notes, and tool restrictions. Further checks cover text-only warnings and preflight limits, queued reset/follow-up input, current goal-state recovery, active-goal refusal followed by a paused-goal reset through the real installed extension, per-model budget persistence, unknown capacity, and lookup ordering.

Live model runs through one provider route verified hard-limit, checkpoint-triggered, model-requested, and manual resets. The automatic-reset checks observed one agent start and one final completion across the reset, with the remaining note-writing task completed in the fresh window. Manual compaction wrote the codeword and constraints to the session log, reset, and stayed idle. The next user request recovered the exact codeword by reading `checkpoint.md`. Requests retained one cache key and reported cache-read tokens after the reset. This proves operation on that route, not a general quality or cost improvement over native compaction.
