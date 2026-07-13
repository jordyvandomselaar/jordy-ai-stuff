import { describe, expect, test } from "bun:test"
import type {
  ContextEvent,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent"
import { DEFAULT_COLLABORATION_CONFIG } from "./collaboration-config.ts"
import { createCodexUltraModeExtension } from "./index.ts"
import type { PiChildSessionRequest } from "./collaboration/pi-actor-session.ts"
import { COLLABORATION_MESSAGE_TYPE } from "./collaboration/pi-history.ts"
import {
  CompositionSession,
  CompositionSessionManager,
  rootToolInfos,
  waitUntil,
} from "./package-composition-test-support.ts"

describe("codex-ultra-mode package composition", () => {
  test("composes startup, child execution, durable root delivery, context, and shutdown", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const commands = new Map<string, {
      handler(args: string, ctx: ExtensionContext): Promise<void> | void
    }>()
    const tools = new Map<string, {
      execute(
        id: string,
        params: Record<string, string>,
        signal: AbortSignal | undefined,
        update: undefined,
        ctx: ExtensionContext,
      ): Promise<{ details: unknown }>
    }>()
    const statuses = new Map<string, string | undefined>()
    const notifications: Array<{ level?: string; message: string }> = []
    const sessionManager = new CompositionSessionManager()
    const child = new CompositionSession()
    let childRequest: PiChildSessionRequest | undefined
    const fakePi = {
      appendEntry(customType: string, data?: unknown) {
        return sessionManager.appendCustomEntry(customType, data)
      },
      getThinkingLevel: () => "medium",
      getActiveTools: () => ["read", "spawn_agent"],
      getAllTools: () => rootToolInfos,
      registerCommand(name: string, command: {
        handler(args: string, ctx: ExtensionContext): Promise<void> | void
      }) {
        commands.set(name, command)
      },
      registerTool(tool: { name: string }) {
        tools.set(tool.name, tool as typeof tools extends Map<string, infer Tool> ? Tool : never)
      },
      on(name: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(name, handler)
      },
    } as ExtensionAPI
    createCodexUltraModeExtension({
      createChildSession: async (request) => {
        childRequest = request
        return child
      },
      resolveCollaborationConfig: () => ({
        config: DEFAULT_COLLABORATION_CONFIG,
        diagnostics: [],
      }),
    })(fakePi)

    const ctx = {
      cwd: "/workspace",
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
      sessionManager,
      getSystemPrompt: () => "Root prompt",
      ui: {
        notify: (message: string, level?: string) => notifications.push({ message, level }),
        setStatus: (key: string, value: string | undefined) => statuses.set(key, value),
      },
    } as ExtensionContext
    const sessionStart = handlers.get("session_start")
    await sessionStart?.({ type: "session_start", reason: "startup" }, ctx)
    expect(statuses.get("codex-ultra-mode")).toBeUndefined()
    expect(sessionManager.entries.some(
      (entry) => entry.type === "custom" && entry.customType === "codex-ultra-mode-state",
    )).toBe(false)

    const alternateModelCtx = {
      ...ctx,
      model: { ...ctx.model, id: "unsupported" },
    } as ExtensionContext
    await handlers.get("model_select")?.({}, alternateModelCtx)
    expect(statuses.get("codex-ultra-mode")).toBeUndefined()
    await commands.get("ultra")?.handler("", alternateModelCtx)
    expect(statuses.get("codex-ultra-mode")).toBe("Ultra (medium) · 1")
    expect(notifications.at(-1)).toMatchObject({
      level: "info",
      message: "Ultra mode enabled with medium thinking.",
    })
    expect(sessionManager.entries.at(-1)).toMatchObject({
      type: "custom",
      customType: "codex-ultra-mode-state",
      data: { enabled: true },
    })
    const ultraStateEntryCount = sessionManager.entries.filter(
      (entry) => entry.type === "custom" && entry.customType === "codex-ultra-mode-state",
    ).length
    await handlers.get("model_select")?.({}, alternateModelCtx)
    expect(statuses.get("codex-ultra-mode")).toBe("Ultra (medium) · 1")
    await handlers.get("model_select")?.({}, ctx)
    expect(statuses.get("codex-ultra-mode")).toBe("Ultra (medium) · 1")
    expect(sessionManager.entries.filter(
      (entry) => entry.type === "custom" && entry.customType === "codex-ultra-mode-state",
    )).toHaveLength(ultraStateEntryCount)
    await handlers.get("thinking_level_select")?.({}, ctx)
    expect(statuses.get("codex-ultra-mode")).toBe("Ultra (medium) · 1")

    const spawn = await tools.get("spawn_agent")?.execute(
      "spawn-call",
      { task_name: "child", message: "Work", fork_turns: "none" },
      undefined,
      undefined,
      ctx,
    )
    expect(spawn?.details).toEqual({ task_name: "/root/child" })
    expect(statuses.get("codex-ultra-mode")).toBe("Ultra (medium) · 2")
    expect(childRequest?.runtime.snapshot).toMatchObject({
      thinkingLevel: "medium",
      ultraEnabled: true,
    })
    child.finish()
    await waitUntil(() => sessionManager.entries.some((entry) => entry.type === "custom_message"))
    await waitUntil(() => statuses.get("codex-ultra-mode") === "Ultra (medium) · 1")
    expect(statuses.get("codex-ultra-mode")).toBe("Ultra (medium) · 1")

    const context = handlers.get("context")
    const injected = await context?.({ type: "context", messages: [] }, ctx) as
      | { messages?: ContextEvent["messages"] }
      | undefined
    expect(injected?.messages).toMatchObject([{
      role: "custom",
      customType: COLLABORATION_MESSAGE_TYPE,
      details: { payload: "Composed answer" },
    }])
    await handlers.get("turn_end")?.({
      message: { role: "assistant", stopReason: "stop" },
    }, ctx)
    const reinjected = await context?.({ type: "context", messages: [] }, ctx) as
      | { messages?: ContextEvent["messages"] }
      | undefined
    expect(reinjected?.messages).toEqual([])

    const shutdown = handlers.get("session_shutdown")
    await shutdown?.({ type: "session_shutdown", reason: "quit" }, ctx)
    await shutdown?.({ type: "session_shutdown", reason: "quit" }, ctx)
    expect(statuses.get("codex-ultra-mode")).toBeUndefined()
    expect(child.disposals).toBe(1)

    const resumedHandlers = new Map<string, (...args: unknown[]) => unknown>()
    const resumedTools = new Map<string, {
      execute(
        id: string,
        params: Record<string, string>,
        signal: AbortSignal | undefined,
        update: undefined,
        context: ExtensionContext,
      ): Promise<{ details: unknown }>
    }>()
    const resumedCommands = new Map<string, {
      handler(args: string, context: ExtensionContext): Promise<void> | void
    }>()
    const resumedChild = new CompositionSession()
    let resumedRequest: PiChildSessionRequest | undefined
    const resumedPi = {
      appendEntry(customType: string, data?: unknown) {
        return sessionManager.appendCustomEntry(customType, data)
      },
      getThinkingLevel: () => "medium",
      getActiveTools: () => ["read", "spawn_agent"],
      getAllTools: () => rootToolInfos,
      registerCommand(name: string, command: {
        handler(args: string, context: ExtensionContext): Promise<void> | void
      }) {
        resumedCommands.set(name, command)
      },
      registerTool(tool: { name: string }) {
        resumedTools.set(
          tool.name,
          tool as typeof resumedTools extends Map<string, infer Tool> ? Tool : never,
        )
      },
      on(name: string, handler: (...args: unknown[]) => unknown) {
        resumedHandlers.set(name, handler)
      },
    } as ExtensionAPI
    createCodexUltraModeExtension({
      createChildSession: async (request) => {
        resumedRequest = request
        return resumedChild
      },
      resolveCollaborationConfig: () => ({
        config: DEFAULT_COLLABORATION_CONFIG,
        diagnostics: [],
      }),
    })(resumedPi)
    await resumedHandlers.get("session_start")?.(
      { type: "session_start", reason: "resume" },
      ctx,
    )
    expect(statuses.get("codex-ultra-mode")).toBe("Ultra (medium) · 1")
    const resumedList = await resumedTools.get("list_agents")?.execute(
      "resumed-list",
      {},
      undefined,
      undefined,
      ctx,
    )
    expect(resumedList?.details).toMatchObject({
      agents: [{ agent_name: "/root" }, { agent_name: "/root/child" }],
    })
    expect(resumedRequest?.spec.sessionState).toMatchObject({
      version: 5,
      messages: [
        { role: "custom", details: { payload: "Work" } },
        { role: "assistant", content: [{ type: "text", text: "Composed answer" }] },
      ],
    })
    expect(resumedRequest?.runtime.snapshot.systemPrompt).toContain("You are an agent in a team")
    expect(resumedRequest?.runtime.snapshot).toMatchObject({
      thinkingLevel: "medium",
      ultraEnabled: true,
    })
    await resumedTools.get("followup_task")?.execute(
      "resumed-followup",
      { target: "child", message: "Continue after resume" },
      undefined,
      undefined,
      ctx,
    )
    expect(resumedChild.messages.at(-1)).toMatchObject({
      role: "custom",
      details: { payload: "Continue after resume", triggerTurn: true },
    })
    resumedChild.finish()
    await waitUntil(() => sessionManager.entries.filter(
      (entry) => entry.type === "custom_message",
    ).length === 2)
    const resumedContext = resumedHandlers.get("context")
    const resumedInjection = await resumedContext?.(
      { type: "context", messages: [] },
      ctx,
    ) as { messages?: ContextEvent["messages"] } | undefined
    expect(resumedInjection?.messages).toMatchObject([{
      role: "custom",
      details: { payload: "Composed answer" },
    }])
    await resumedCommands.get("ultra")?.handler("", ctx)
    expect(statuses.get("codex-ultra-mode")).toBeUndefined()
    expect(sessionManager.entries.at(-1)).toMatchObject({
      type: "custom",
      customType: "codex-ultra-mode-state",
      data: { enabled: false },
    })
    await resumedHandlers.get("session_shutdown")?.(
      { type: "session_shutdown", reason: "quit" },
      ctx,
    )
    expect(resumedChild.disposals).toBe(1)
  })
})
