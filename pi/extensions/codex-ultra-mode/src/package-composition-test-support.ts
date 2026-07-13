import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionEventListener,
  SessionEntry,
} from "@earendil-works/pi-coding-agent"
import type { PiSession } from "./collaboration/pi-actor-session.ts"

export const rootToolInfos = [
  {
    name: "read",
    description: "Read",
    parameters: { type: "object", properties: {} },
    sourceInfo: {
      path: "<builtin:read>",
      source: "builtin",
      scope: "temporary" as const,
      origin: "top-level" as const,
    },
  },
  {
    name: "spawn_agent",
    description: "Spawn",
    parameters: { type: "object", properties: {} },
    sourceInfo: {
      path: "/extensions/codex-ultra-mode.ts",
      source: "test",
      scope: "temporary" as const,
      origin: "top-level" as const,
    },
  },
]

interface Deferred {
  promise: Promise<void>
  resolve(): void
}

function deferred(): Deferred {
  let resolvePromise = () => {}
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

export class CompositionSession implements PiSession {
  readonly messages: AgentSession["messages"] = []
  private readonly listeners = new Set<AgentSessionEventListener>()
  readonly run = deferred()
  isStreaming = false
  pendingMessageCount = 0
  disposals = 0

  subscribe(listener: AgentSessionEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async sendCustomMessage(
    message: Parameters<AgentSession["sendCustomMessage"]>[0],
    options?: Parameters<AgentSession["sendCustomMessage"]>[1],
  ): Promise<void> {
    const custom = {
      role: "custom" as const,
      customType: message.customType,
      content: message.content,
      display: message.display,
      details: message.details,
      timestamp: Date.now(),
    }
    this.messages.push(custom)
    const event = { type: "message_end", message: custom } as AgentSessionEvent
    for (const listener of this.listeners) listener(event)
    if (options?.triggerTurn) await this.run.promise
  }

  waitForIdle(): Promise<void> { return this.run.promise }
  abort(): Promise<void> { this.run.resolve(); return Promise.resolve() }
  dispose(): void { this.disposals += 1 }

  finish(): void {
    const assistant = {
      role: "assistant",
      content: [{ type: "text", text: "Composed answer" }],
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
      stopReason: "stop",
      timestamp: Date.now(),
    } as const
    this.messages.push(assistant)
    const event = { type: "message_end", message: assistant } as AgentSessionEvent
    for (const listener of this.listeners) listener(event)
    this.run.resolve()
  }
}

export class CompositionSessionManager {
  readonly entries: SessionEntry[] = []
  private nextId = 1

  getSessionId(): string { return "composition-session" }
  getBranch(): SessionEntry[] { return [...this.entries] }
  buildContextEntries(): SessionEntry[] { return [...this.entries] }

  appendCustomMessageEntry<T>(
    customType: string,
    content: string,
    display: boolean,
    details: T,
  ): string {
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

export async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error("composition did not settle")
}
