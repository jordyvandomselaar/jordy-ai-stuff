import { describe, expect, test } from "bun:test"
import { DEFAULT_COLLABORATION_CONFIG } from "../collaboration-config.ts"
import { CollaborationCoordinator } from "./coordinator.ts"
import { FakeSession, spawn } from "./coordinator-test-support.ts"

describe("CollaborationCoordinator residency", () => {
  test("evicts a terminal session without discarding unread activity", async () => {
    const first = new FakeSession()
    const second = new FakeSession()
    const sessions = [first, second]
    const coordinator = new CollaborationCoordinator(
      { createActor: () => sessions.shift() ?? new FakeSession() },
      undefined,
      undefined,
      { ...DEFAULT_COLLABORATION_CONFIG, maxConcurrentThreadsPerSession: 1 },
    )

    await spawn(coordinator, "/root", "first", "First task")
    await coordinator.sendMessage("/root", "first", "Queue-only context")
    await coordinator.complete("/root/first", "Done")
    expect(first.disposals).toBe(0)

    await spawn(coordinator, "/root", "second", "Second task")

    expect(first.disposals).toBe(1)
    expect(coordinator.getAgent("/root/second").status).toEqual({ kind: "running" })
    expect(await coordinator.waitForMailbox("/root/first", 30_000)).toEqual({
      kind: "activity",
    })
  })
})
