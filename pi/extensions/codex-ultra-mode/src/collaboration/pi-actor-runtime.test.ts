import { describe, expect, test } from "bun:test"
import {
  type CollaborationConfig,
  DEFAULT_COLLABORATION_CONFIG,
} from "../collaboration-config.ts"
import type { CollaborationActorInput, CollaborationInputSink } from "./actor-session.ts"
import { CollaborationCoordinator } from "./coordinator.ts"
import {
  PiActorFactory,
  PI_CHILD_SESSION_POLICY,
  assertInheritedToolParity,
  childSystemPrompt,
  type PiActorPersistence,
  type PiChildSessionRequest,
} from "./pi-actor-session.ts"
import { COLLABORATION_MESSAGE_TYPE } from "./pi-history.ts"
import {
  FakePiSession,
  rootContext,
  taskRequest,
  toolInfo,
  waitUntil,
} from "./pi-actor-test-support.ts"

describe("Pi actor runtime", () => {
  test("persists typed triggering input before settlement and inherits its parent snapshot", async () => {
    const rootDeliveries: CollaborationActorInput[] = []
    const rootActor: CollaborationInputSink = {
      deliver(input) {
        rootDeliveries.push(input)
      },
    }
    const sessions: FakePiSession[] = []
    const requests: PiChildSessionRequest[] = []
    const persistedMessages: Array<{ path: string; sequence: number }> = []
    let rejectFirstMessage = true
    const persistence: PiActorPersistence = {
      initializeActorSession() {},
      persistActorRuntime() {},
      persistActorMessage(path, sequence) {
        if (rejectFirstMessage) {
          rejectFirstMessage = false
          throw new Error("root session replaced")
        }
        persistedMessages.push({ path, sequence })
      },
    }
    const collaborationConfig = {
      ...DEFAULT_COLLABORATION_CONFIG,
      agentRoles: [{
        description: "Use for implementation.",
        filePath: "/agents/worker.md",
        name: "worker",
        source: "user",
        systemPrompt: "Own a disjoint write set.",
        thinkingLevel: "high",
        tools: ["read"],
      }],
    } satisfies CollaborationConfig
    let coordinator: CollaborationCoordinator
    const factory = new PiActorFactory(rootActor, () => coordinator, async (request) => {
      requests.push(request)
      const session = new FakePiSession()
      sessions.push(session)
      return session
    }, persistence)
    coordinator = new CollaborationCoordinator(
      factory,
      undefined,
      undefined,
      collaborationConfig,
    )
    const rootTools = [
      toolInfo("read", "<builtin:read>"),
      toolInfo("spawn_agent", "/extensions/codex-ultra-mode.ts"),
      toolInfo("extension_tool", "/extensions/parent-tools.ts"),
    ]
    factory.bindRoot(rootContext(), {
      collaborationConfig,
      thinkingLevel: "medium",
      toolInfos: rootTools,
      tools: rootTools.map((tool) => tool.name),
      ultraEnabled: true,
    })

    expect(rootTools.map((tool) => tool.name)).toContain("extension_tool")
    const childSpawn = coordinator.spawn("/root", "child", {
      ...taskRequest("Investigate"),
      agentType: "worker",
    })
    await childSpawn
    expect(sessions[0].sent[0]).toMatchObject({
      message: {
        customType: COLLABORATION_MESSAGE_TYPE,
        details: {
          kind: "new_task",
          sender: "/root",
          recipient: "/root/child",
          triggerTurn: true,
        },
      },
      options: { triggerTurn: true },
    })
    expect(rootDeliveries).toEqual([])

    expect(requests[0].runtime.snapshot).toMatchObject({
      extensionPaths: ["/extensions/parent-tools.ts"],
      thinkingLevel: "high",
      tools: ["read", "spawn_agent"],
    })
    expect(requests[0].runtime.snapshot.systemPrompt).toContain("Own a disjoint write set.")
    const childTools = [
      toolInfo("bash", "<builtin:bash>"),
      toolInfo("spawn_agent", "/extensions/codex-ultra-mode.ts"),
    ]
    requests[0].runtime.update(Object.freeze({
      ...requests[0].runtime.snapshot,
      cwd: "/child-workspace",
      thinkingLevel: "high",
      toolInfos: childTools,
      tools: childTools.map((tool) => tool.name),
      ultraEnabled: true,
    }))
    await coordinator.spawn("/root/child", "nested", taskRequest("Verify"))
    expect(requests[1].runtime.snapshot).not.toBe(requests[0].runtime.snapshot)
    expect(requests[1].runtime.snapshot).toMatchObject({
      cwd: "/child-workspace",
      thinkingLevel: "high",
      tools: ["bash", "spawn_agent"],
      ultraEnabled: true,
    })
    expect(requests[1].runtime.snapshot.systemPrompt).toContain("You are an agent in a team")
    expect(requests[1].runtime.snapshot.systemPrompt).toContain("Own a disjoint write set.")
    expect(childSystemPrompt(requests[0])).toContain("Proactive multi-agent delegation is active")
    expect(PI_CHILD_SESSION_POLICY).toEqual({
      inheritActiveExtensionSources: true,
      noExtensions: true,
      transport: "sse",
    })
    factory.bindRoot(rootContext("/new-root-workspace"), {
      thinkingLevel: "high",
      tools: ["bash"],
      ultraEnabled: false,
    })
    await coordinator.spawn("/root", "new_child", taskRequest("New root config"))
    expect(requests[2].runtime.snapshot).toMatchObject({
      cwd: "/new-root-workspace",
      thinkingLevel: "high",
      tools: ["bash"],
      ultraEnabled: false,
    })
    expect(childSystemPrompt(requests[2])).toContain(
      "Do not spawn sub-agents unless the user",
    )
    expect(requests[0].runtime.snapshot.cwd).toBe("/child-workspace")

    sessions[0].finish("stop", "Child answer")
    await waitUntil(() => rootDeliveries.length > 0)
    expect(rootDeliveries.at(-1)).toMatchObject({
      kind: "final_answer",
      payload: "Child answer",
    })

    await waitUntil(() => coordinator.getAgent("/root/child").status.kind === "completed")
    expect(persistedMessages.filter(({ path }) => path === "/root/child")).toEqual([
      { path: "/root/child", sequence: 0 },
      { path: "/root/child", sequence: 1 },
    ])
    const terminalStatus = coordinator.getAgent("/root/child").status
    await coordinator.sendMessage("/root", "/root/child", "Queued context")
    expect(coordinator.getAgent("/root/child").status).toEqual(terminalStatus)
    expect(sessions[0].sent.at(-1)).toMatchObject({
      message: { customType: COLLABORATION_MESSAGE_TYPE },
      options: { deliverAs: undefined },
    })
    sessions[0].isStreaming = true
    await coordinator.sendMessage("/root", "/root/child", "Steered context")
    expect(sessions[0].sent.at(-1)).toMatchObject({ options: { deliverAs: "steer" } })
    sessions[0].isStreaming = false

    await coordinator.dispose()
    expect(sessions.every((session) => session.disposals === 1)).toBe(true)
  })

  test("omits parent-only tools and allows inherited extension runtime changes", async () => {
    const requests: PiChildSessionRequest[] = []
    let coordinator: CollaborationCoordinator
    const factory = new PiActorFactory(
      { deliver() {} },
      () => coordinator,
      async (request) => {
        requests.push(request)
        return new FakePiSession()
      },
    )
    coordinator = new CollaborationCoordinator(factory)
    const readTool = toolInfo("read", "<builtin:read>")
    const mcpTool = toolInfo("mcp", "/extensions/pi-mcp-adapter.ts")
    const tools = [
      readTool,
      mcpTool,
      toolInfo("sdk_tool", "<sdk:sdk_tool>"),
      toolInfo("inline_tool", "<inline:custom-tools>"),
    ]
    factory.bindRoot(rootContext(), {
      thinkingLevel: "medium",
      toolInfos: tools,
      tools: tools.map((tool) => tool.name),
      ultraEnabled: true,
    })

    await coordinator.spawn("/root", "child", taskRequest("Use inherited tools"))
    expect(requests).toHaveLength(1)
    expect(requests[0].runtime.snapshot).toMatchObject({
      extensionPaths: ["/extensions/pi-mcp-adapter.ts"],
      toolInfos: [readTool, mcpTool],
      tools: ["read", "mcp"],
    })
    expect(() => assertInheritedToolParity(requests[0].runtime.snapshot, {
      getActiveToolNames: () => [],
      getAllTools: () => [readTool, mcpTool],
    }, "/root/child")).not.toThrow()

    expect(() => assertInheritedToolParity(requests[0].runtime.snapshot, {
      getActiveToolNames: () => [],
      getAllTools: () => [mcpTool],
    }, "/root/child")).toThrow(
      "Child /root/child could not recreate the parent's inherited tools (unavailable: read)",
    )

    expect(() => assertInheritedToolParity(requests[0].runtime.snapshot, {
      getActiveToolNames: () => [],
      getAllTools: () => [toolInfo("read", "/extensions/replacement.ts"), mcpTool],
    }, "/root/child")).toThrow("different sources: read")

    expect(() => assertInheritedToolParity(requests[0].runtime.snapshot, {
      getActiveToolNames: () => [],
      getAllTools: () => [readTool, {
        ...mcpTool,
        description: "Description refreshed from live extension metadata",
        parameters: { type: "object", properties: { refreshed: { type: "boolean" } } },
      }],
    }, "/root/child")).not.toThrow()

    expect(() => assertInheritedToolParity(requests[0].runtime.snapshot, {
      getActiveToolNames: () => ["read", "mcp"],
      getAllTools: () => [readTool, mcpTool],
    }, "/root/child")).not.toThrow()
  })

 })
