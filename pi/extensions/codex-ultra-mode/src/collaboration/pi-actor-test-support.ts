import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionEventListener,
  ExtensionContext,
  ToolInfo,
} from "@earendil-works/pi-coding-agent"
import type { PiSession } from "./pi-actor-session.ts"

export interface Deferred<Value> {
  promise: Promise<Value>
  resolve(value: Value): void
}

export function deferred<Value>(): Deferred<Value> {
  let resolvePromise: (value: Value) => void = () => {}
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

export class FakePiSession implements PiSession {
  readonly messages: AgentSession["messages"] = []
  readonly sent: Array<{
    message: Parameters<AgentSession["sendCustomMessage"]>[0]
    options: Parameters<AgentSession["sendCustomMessage"]>[1]
  }> = []
  readonly runs: Array<Deferred<void>> = []
  private readonly listeners = new Set<AgentSessionEventListener>()
  isStreaming = false
  pendingMessageCount = 0
  rejectNextTrigger = false
  aborts = 0
  disposals = 0

  subscribe(listener: AgentSessionEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async sendCustomMessage(
    message: Parameters<AgentSession["sendCustomMessage"]>[0],
    options?: Parameters<AgentSession["sendCustomMessage"]>[1],
  ): Promise<void> {
    if (options?.triggerTurn && this.rejectNextTrigger) {
      this.rejectNextTrigger = false
      throw new Error("typed input rejected")
    }
    this.sent.push({ message, options })
    const customMessage = {
      role: "custom" as const,
      customType: message.customType,
      content: message.content,
      display: message.display,
      details: message.details,
      timestamp: Date.now(),
    }
    this.messages.push(customMessage)
    this.emit({ type: "message_end", message: customMessage } as AgentSessionEvent)
    if (options?.triggerTurn) {
      const run = deferred<void>()
      this.runs.push(run)
      await run.promise
    }
  }

  waitForIdle(): Promise<void> {
    return this.runs.at(-1)?.promise ?? Promise.resolve()
  }

  async abort(): Promise<void> {
    this.aborts += 1
    for (const run of this.runs) run.resolve()
  }

  dispose(): void {
    this.disposals += 1
  }

  finish(
    stopReason: "stop" | "error" | "aborted",
    text = "Done",
    runIndex = this.runs.length - 1,
  ): void {
    const assistant = {
      role: "assistant",
      content: [{ type: "text", text }],
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
      errorMessage: stopReason === "error" ? text : undefined,
      timestamp: Date.now(),
    } as const
    this.messages.push(assistant)
    this.emit({ type: "message_end", message: assistant } as AgentSessionEvent)
    this.runs[runIndex]?.resolve()
  }

  private emit(event: AgentSessionEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

export function rootContext(cwd = "/root-workspace"): ExtensionContext {
  return {
    cwd,
    model: {
      id: "gpt-5.6-sol",
      name: "Sol",
      api: "openai-codex-responses",
      provider: "openai-codex",
      baseUrl: "https://example.invalid",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_000_000,
      maxTokens: 100_000,
    },
    modelRegistry: {},
    getSystemPrompt: () => "Root prompt",
  } as ExtensionContext
}

export function taskRequest(task: string) {
  return { task, parentHistory: [], forkTurns: "none" }
}

export function toolInfo(name: string, path: string): ToolInfo {
  return {
    name,
    description: `${name} description`,
    parameters: { type: "object", properties: {} },
    sourceInfo: {
      path,
      source: path.startsWith("<") ? "builtin" : "test",
      scope: "temporary",
      origin: "top-level",
    },
  }
}

export async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error("condition did not settle")
}
