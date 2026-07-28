import { describe, expect, test } from "bun:test"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import { disableChildCachedWebSocketPrewarm } from "./pi-child-transport.ts"

type Handler = (...args: unknown[]) => Promise<unknown>

function extension(path: string, handlers: Map<string, Handler[]>) {
  return { path, resolvedPath: path, handlers }
}

describe("Pi child transport compatibility", () => {
  test("blocks cached WebSocket prewarming without hiding auth from other events", async () => {
    const auth = { ok: true as const, apiKey: "test-key" }
    const modelRegistry = { getApiKeyAndHeaders: async () => auth }
    const ctx = { modelRegistry } as ExtensionContext
    const observed: unknown[] = []
    const observeAuth: Handler = async (...args) => {
      const eventContext = args[1] as ExtensionContext
      observed.push(await eventContext.modelRegistry.getApiKeyAndHeaders({} as never))
    }
    const handlers = new Map<string, Handler[]>([
      ["session_start", [observeAuth]],
      ["model_select", [observeAuth]],
      ["before_agent_start", [observeAuth]],
      ["agent_start", [observeAuth]],
    ])

    expect(await modelRegistry.getApiKeyAndHeaders()).toEqual(auth)
    disableChildCachedWebSocketPrewarm({
      extensions: [extension("/agent/npm/pi-codex-conversion/dist/index.js", handlers)],
    })

    for (const eventType of [
      "session_start",
      "model_select",
      "before_agent_start",
      "agent_start",
    ]) {
      await handlers.get(eventType)?.[0]?.({ type: eventType }, ctx)
    }
    expect(observed).toEqual([
      {
        ok: false,
        error: "Cached WebSocket prewarm is disabled for Ultra child sessions",
      },
      {
        ok: false,
        error: "Cached WebSocket prewarm is disabled for Ultra child sessions",
      },
      {
        ok: false,
        error: "Cached WebSocket prewarm is disabled for Ultra child sessions",
      },
      auth,
    ])
  })

  test("does not alter unrelated extensions", async () => {
    const auth = { ok: true as const, apiKey: "test-key" }
    const ctx = {
      modelRegistry: { getApiKeyAndHeaders: async () => auth },
    } as ExtensionContext
    const observed: unknown[] = []
    const handler: Handler = async (...args) => {
      const eventContext = args[1] as ExtensionContext
      observed.push(await eventContext.modelRegistry.getApiKeyAndHeaders({} as never))
    }
    const handlers = new Map<string, Handler[]>([["session_start", [handler]]])

    disableChildCachedWebSocketPrewarm({
      extensions: [extension("/agent/npm/another-extension/index.js", handlers)],
    })
    await handlers.get("session_start")?.[0]?.({ type: "session_start" }, ctx)

    expect(observed).toEqual([auth])
  })
})
