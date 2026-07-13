import { describe, expect, test } from "bun:test"
import { DEFAULT_COLLABORATION_CONFIG } from "../collaboration-config.ts"
import type {
  ContextEvent,
  ExtensionContext,
  SessionEntry,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent"
import { CollaborationCoordinator, type PersistedAgentRecord } from "./coordinator.ts"
import { PiRootMailbox } from "./pi-root-mailbox.ts"

class RootSessionManager {
  readonly entries: SessionEntry[] = []
  failNextAppend = true
  failNextCustomEntry = false
  failCustomType?: string
  nextId = 1

  getSessionId(): string { return "root-session" }
  getBranch(): SessionEntry[] { return [...this.entries] }
  appendCustomMessageEntry<T>(customType: string, content: string, display: boolean, details: T): string {
    if (this.failNextAppend) {
      this.failNextAppend = false
      throw new Error("session replaced")
    }
    const id = `entry-${this.nextId++}`
    this.entries.push({
      type: "custom_message",
      id,
      parentId: this.entries.at(-1)?.id ?? null,
      timestamp: new Date().toISOString(),
      customType,
      content,
      display,
      details,
    })
    return id
  }
  appendCustomEntry(customType: string, data?: unknown): string {
    if (this.failCustomType === customType) {
      this.failCustomType = undefined
      throw new Error("target custom entry unavailable")
    }
    if (this.failNextCustomEntry) {
      this.failNextCustomEntry = false
      throw new Error("custom entry unavailable")
    }
    const id = `entry-${this.nextId++}`
    this.entries.push({
      type: "custom",
      id,
      parentId: this.entries.at(-1)?.id ?? null,
      timestamp: new Date().toISOString(),
      customType,
      data,
    })
    return id
  }
}

function turnEnd(stopReason: "aborted" | "error" | "stop"): TurnEndEvent {
  return {
    type: "turn_end",
    turnIndex: 0,
    toolResults: [],
    message: {
      role: "assistant",
      content: [],
      api: "openai-codex-responses",
      provider: "openai-codex",
      model: "gpt-5.6-sol",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason,
      timestamp: Date.now(),
    },
  } as TurnEndEvent
}

describe("Pi root mailbox", () => {
  test("retains rejected coordinator delivery and durably injects an accepted retry once", async () => {
    const manager = new RootSessionManager()
    const mailbox = new PiRootMailbox()
    const ctx = { sessionManager: manager } as ExtensionContext
    mailbox.bind(ctx)
    const coordinator = new CollaborationCoordinator({
      rootActor: mailbox,
      createActor: () => { throw new Error("not used") },
    }, undefined, mailbox)

    await expect(coordinator.sendMessage("/root", "/root", "Update", "root-update"))
      .rejects.toMatchObject({ code: "delivery_failed" })
    expect(coordinator.getAgent("/root").mailboxSize).toBe(1)
    expect(manager.entries).toHaveLength(1)

    await coordinator.sendMessage("/root", "/root", "Update", "root-update")
    expect(coordinator.getAgent("/root").mailboxSize).toBe(0)
    expect(manager.entries).toHaveLength(3)
    const event = { type: "context", messages: [] } as ContextEvent
    const injected = mailbox.inject(event, ctx)
    expect(injected).toMatchObject([{
      role: "custom",
      details: {
        payload: "Update",
      },
    }])
    expect((injected[0].details as { deliveryId: string }).deliveryId)
      .toMatch(/^root-session:[0-9a-f-]+$/)
    mailbox.acknowledge(turnEnd("error"), ctx)
    expect(mailbox.inject(event, ctx)).toHaveLength(1)
    mailbox.acknowledge(turnEnd("aborted"), ctx)
    expect(mailbox.inject(event, ctx)).toHaveLength(1)
    mailbox.acknowledge(turnEnd("stop"), ctx)
    expect(mailbox.inject(event, ctx)).toEqual([])
  })

  test("replays a rejected terminal outbox after coordinator replacement", async () => {
    const manager = new RootSessionManager()
    const ctx = { sessionManager: manager } as ExtensionContext
    const firstMailbox = new PiRootMailbox()
    firstMailbox.bind(ctx)
    const first = new CollaborationCoordinator({
      rootActor: firstMailbox,
      createActor: () => { throw new Error("not used") },
    }, undefined, firstMailbox)

    await expect(first.sendMessage(
      "/root",
      "/root",
      "Recovered final answer",
      "terminal-answer",
    )).rejects.toMatchObject({ code: "delivery_failed" })
    expect(firstMailbox.restoredOutbox(ctx)).toHaveLength(1)
    await first.dispose()

    const resumedMailbox = new PiRootMailbox()
    resumedMailbox.bind(ctx)
    const resumed = new CollaborationCoordinator({
      rootActor: resumedMailbox,
      createActor: () => { throw new Error("not used") },
    }, undefined, resumedMailbox)
    await resumed.restore([], resumedMailbox.restoredOutbox(ctx))
    await resumed.flushRoot()
    expect(resumed.getAgent("/root").mailboxSize).toBe(0)
    const injected = resumedMailbox.inject({ type: "context", messages: [] } as ContextEvent, ctx)
    expect(injected).toMatchObject([{
      details: { payload: "Recovered final answer" },
    }])
    await resumed.dispose()
  })

  test("retries an identical actor definition after persistence rejection", () => {
    const manager = new RootSessionManager()
    const mailbox = new PiRootMailbox()
    mailbox.bind({ sessionManager: manager } as ExtensionContext)
    const record: PersistedAgentRecord = {
      path: "/root/child",
      parentPath: "/root",
      latestTask: "Work",
      status: { kind: "interrupted" },
      context: {
        history: [],
        initialInput: {
          kind: "new_task",
          sender: "/root",
          recipient: "/root/child",
          payload: "Work",
          triggerTurn: true,
        },
      },
    }
    manager.failNextCustomEntry = true
    expect(() => mailbox.persistAgent(record)).toThrow("custom entry unavailable")
    mailbox.persistAgent(record)
    expect(manager.entries).toHaveLength(2)
  })

  test("persists actor history as ordered incremental entries", () => {
    const manager = new RootSessionManager()
    const mailbox = new PiRootMailbox()
    const ctx = { sessionManager: manager } as ExtensionContext
    mailbox.bind(ctx)
    const record: PersistedAgentRecord = {
      path: "/root/child",
      parentPath: "/root",
      latestTask: "Work",
      status: { kind: "running" },
      context: {
        history: [],
        initialInput: {
          kind: "new_task",
          sender: "/root",
          recipient: "/root/child",
          payload: "Work",
          triggerTurn: true,
        },
      },
    }
    const runtime = {
      collaborationConfig: DEFAULT_COLLABORATION_CONFIG,
      cwd: "/workspace",
      extensionPaths: ["/extensions/child.ts"],
      model: { provider: "openai-codex", id: "gpt-5.6-sol" },
      projectTrusted: true,
      systemPrompt: "Child prompt",
      thinkingLevel: "medium" as const,
      toolInfos: [],
      tools: ["read"],
      ultraEnabled: true,
    }
    const firstMessage = turnEnd("stop").message

    mailbox.persistAgent(record)
    mailbox.persistAgent({ ...record, status: { kind: "completed", message: "Done" } })
    mailbox.initializeActorSession(record.path, {
      version: 5,
      runtime,
      messages: [firstMessage],
    })
    for (let sequence = 1; sequence <= 100; sequence++) {
      mailbox.persistActorMessage(record.path, sequence, {
        ...firstMessage,
        content: [{ type: "text", text: "x".repeat(sequence) }],
      })
    }
    mailbox.persistActorMessage(record.path, 100, firstMessage)

    const definitions = manager.entries.filter(
      (entry) => entry.type === "custom" && entry.customType === "codex-ultra-actor-definition",
    )
    const lifecycles = manager.entries.filter(
      (entry) => entry.type === "custom" && entry.customType === "codex-ultra-actor-lifecycle",
    )
    const messages = manager.entries.filter(
      (entry) => entry.type === "custom" && entry.customType === "codex-ultra-actor-message",
    )
    expect({ definitions: definitions.length, lifecycles: lifecycles.length, messages: messages.length })
      .toEqual({ definitions: 1, lifecycles: 2, messages: 101 })
    expect(messages.every((entry) => entry.type === "custom"
      && !Object.hasOwn(entry.data as object, "messages"))).toBe(true)
    expect(mailbox.restoredActors(ctx)).toMatchObject([{
      path: record.path,
      status: { kind: "completed", message: "Done" },
      sessionState: { version: 5, runtime, messages: { length: 101 } },
    }])
  })

  test("does not duplicate a durable root message when outbox acknowledgement retries", async () => {
    const manager = new RootSessionManager()
    manager.failNextAppend = false
    manager.failCustomType = "codex-ultra-root-outbox-ack"
    const ctx = { sessionManager: manager } as ExtensionContext
    const mailbox = new PiRootMailbox()
    mailbox.bind(ctx)
    const coordinator = new CollaborationCoordinator({
      rootActor: mailbox,
      createActor: () => { throw new Error("not used") },
    }, undefined, mailbox)

    await expect(coordinator.sendMessage("/root", "/root", "Only once", "once"))
      .rejects.toMatchObject({ code: "delivery_failed" })
    expect(coordinator.getAgent("/root").mailboxSize).toBe(1)
    await coordinator.sendMessage("/root", "/root", "Only once", "once")

    const injected = mailbox.inject({ type: "context", messages: [] } as ContextEvent, ctx)
    expect(injected).toHaveLength(1)
    expect(injected[0]).toMatchObject({ details: { payload: "Only once" } })
    expect(manager.entries.filter((entry) => entry.type === "custom_message")).toHaveLength(1)
    await coordinator.dispose()
  })
})
