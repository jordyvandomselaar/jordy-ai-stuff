import { describe, expect, test } from "bun:test"
import type { AgentSession } from "@earendil-works/pi-coding-agent"
import { DEFAULT_COLLABORATION_CONFIG } from "../collaboration-config.ts"
import { CollaborationCoordinator } from "./coordinator.ts"
import type { PiChildSessionRequest } from "./pi-actor-contracts.ts"
import { createProductionChildSession } from "./pi-child-session.ts"
import { rootContext } from "./pi-actor-test-support.ts"
import { persistedActorState, snapshotFromContext } from "./pi-runtime.ts"

const nativeUser = { role: "user" as const, content: "Native", timestamp: 7 }

function actorSpec(sessionState?: unknown) {
  return {
    path: "/root/child",
    parentPath: "/root",
    task: "Continue",
    context: {
      history: [
        { role: "assistant", content: "Terminal answer" },
        { role: "developer", content: "Most recent task: Continue" },
      ],
      initialInput: {
        kind: "new_task" as const,
        sender: "/root",
        recipient: "/root/child",
        payload: "Continue",
        triggerTurn: true,
      },
    },
    sessionState,
  }
}

function constructionHarness(sessionState?: unknown) {
  const appended: AgentSession["messages"] = []
  let loaderOptions: Record<string, unknown> | undefined
  let agentOptions: Record<string, unknown> | undefined
  const session = {
    messages: [],
    extensionRunner: { hasHandlers: () => false, emit: async () => {} },
    bindExtensions: async () => {},
    dispose() {},
    getActiveToolNames: () => [],
    getAllTools: () => [],
    model: rootContext().model,
    systemPrompt: "Root prompt",
    thinkingLevel: "medium",
  }
  class ResourceLoader {
    constructor(options: Record<string, unknown>) { loaderOptions = options }
    async reload() {}
  }
  class SessionManager {
    static inMemory() { return new SessionManager() }
    appendMessage(message: AgentSession["messages"][number]) {
      appended.push(message)
      return `message-${appended.length}`
    }
    appendCompaction() { return "compaction" }
    branchWithSummary() { return "branch" }
    getLeafId() { return null }
  }
  const sdk = {
    createAgentSession: async (options: Record<string, unknown>) => {
      agentOptions = options
      return { session }
    },
    DefaultResourceLoader: ResourceLoader,
    getAgentDir: () => "/agent",
    SessionManager,
    SettingsManager: {
      create: () => ({
        getGlobalSettings: () => ({}),
        getProjectSettings: () => ({}),
      }),
      inMemory: () => ({ applyOverrides() {} }),
    },
  }
  const parentSnapshot = snapshotFromContext(rootContext(), {
    thinkingLevel: "medium",
    tools: [],
    ultraEnabled: true,
  })
  const restored = persistedActorState(sessionState)
  const snapshot = restored === undefined
    ? parentSnapshot
    : Object.freeze({ ...restored.runtime, modelRegistry: parentSnapshot.modelRegistry })
  const runtime = {
    snapshot,
    update(updated: typeof snapshot) { this.snapshot = updated },
  }
  const coordinator = new CollaborationCoordinator({
    createActor() { throw new Error("not used") },
  })
  const request: PiChildSessionRequest = {
    coordinator,
    runtime,
    spec: actorSpec(sessionState),
  }

  return {
    appended,
    get agentOptions() { return agentOptions },
    get loaderOptions() { return loaderOptions },
    loadSdk: async () => sdk,
    request,
  }
}

describe("production Pi child construction", () => {
  test("replays state-less terminal history and routes developer context to the prompt", async () => {
    const harness = constructionHarness()

    await createProductionChildSession(harness.request, harness.loadSdk)

    expect(harness.appended).toMatchObject([{
      role: "assistant",
      content: [{ type: "text", text: "Terminal answer" }],
    }])
    expect(harness.loaderOptions?.systemPrompt).toContain("Most recent task: Continue")
    expect(harness.agentOptions?.sessionStartEvent).toEqual({
      type: "session_start",
      reason: "fork",
    })
  })

  test("uses authoritative native session state without converting or duplicating context", async () => {
    const harness = constructionHarness({
      version: 5,
      messages: [nativeUser],
      runtime: {
        collaborationConfig: DEFAULT_COLLABORATION_CONFIG,
        cwd: "/root-workspace",
        extensionPaths: ["/extensions/stored-child.ts"],
        model: rootContext().model,
        projectTrusted: false,
        systemPrompt: "Restored prompt",
        thinkingLevel: "medium",
        toolInfos: [],
        tools: [],
        ultraEnabled: true,
      },
    })

    await createProductionChildSession(harness.request, harness.loadSdk)

    expect(harness.appended).toEqual([nativeUser])
    expect(harness.loaderOptions).toMatchObject({
      additionalExtensionPaths: ["/extensions/stored-child.ts"],
      systemPrompt: "Restored prompt",
    })
    expect(harness.agentOptions?.sessionStartEvent).toEqual({
      type: "session_start",
      reason: "resume",
    })
  })
})
