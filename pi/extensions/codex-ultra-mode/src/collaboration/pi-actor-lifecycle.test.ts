import { describe, expect, test } from "bun:test"
import type { AgentSession } from "@earendil-works/pi-coding-agent"
import {
  appendForkHistory,
  bindChildSessionExtensions,
} from "./pi-actor-session.ts"

describe("Pi actor history and extension lifecycle", () => {
  test("replays a leading compaction as native Pi session entries", () => {
    const operations: unknown[] = []
    let leaf: string | null = null
    let nextId = 1
    const manager = {
      appendMessage(message: AgentSession["messages"][number]) {
        const id = `entry-${nextId++}`
        operations.push({ kind: "message", message })
        leaf = id
        return id
      },
      appendCompaction(summary: string, firstKeptEntryId: string, tokensBefore: number) {
        const id = `entry-${nextId++}`
        operations.push({ kind: "compaction", summary, firstKeptEntryId, tokensBefore })
        leaf = id
        return id
      },
      branchWithSummary(branchFromId: string | null, summary: string) {
        const id = `entry-${nextId++}`
        operations.push({ kind: "branchSummary", branchFromId, summary })
        leaf = id
        return id
      },
      getLeafId: () => leaf,
    }
    const history: AgentSession["messages"] = [
      { role: "compactionSummary", summary: "Earlier work", tokensBefore: 100, timestamp: 1 },
      { role: "user", content: "Kept turn", timestamp: 2 },
      { role: "branchSummary", summary: "Side branch", fromId: "old", timestamp: 3 },
    ]

    appendForkHistory(manager, history)
    expect(operations).toEqual([
      { kind: "message", message: history[1] },
      { kind: "branchSummary", branchFromId: "entry-1", summary: "Side branch" },
      {
        kind: "compaction",
        summary: "Earlier work",
        firstKeptEntryId: "entry-1",
        tokensBefore: 100,
      },
    ])
  })

  test("binds and shuts down inherited extensions exactly once", async () => {
    const events: string[] = []
    const session = {
      async bindExtensions() { events.push("session_start") },
      dispose() { events.push("dispose") },
      extensionRunner: {
        hasHandlers: () => true,
        async emit(event: { type: string }) { events.push(event.type) },
      },
    } as Pick<AgentSession, "bindExtensions" | "dispose" | "extensionRunner">

    const shutdown = await bindChildSessionExtensions(session)
    expect(events).toEqual(["session_start"])
    await Promise.all([shutdown(), shutdown()])
    expect(events).toEqual(["session_start", "session_shutdown", "dispose"])
  })

 })
