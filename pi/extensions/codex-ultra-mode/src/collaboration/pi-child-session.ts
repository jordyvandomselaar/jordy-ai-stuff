import type { AgentSession } from "@earendil-works/pi-coding-agent"
import { registerUltraHooks } from "../ultra-hooks.ts"
import type {
  PiChildSessionRequest,
  PiSession,
} from "./pi-actor-contracts.ts"
import {
  appendForkHistory,
  prepareCollaborationHistory,
} from "./pi-history.ts"
import {
  activeToolInfos,
  assertInheritedToolParity,
  extensionPaths,
  persistedActorState,
  snapshotFromContext,
} from "./pi-runtime.ts"
import { registerCollaborationTools } from "./tools.ts"

export const PI_CHILD_SESSION_POLICY = Object.freeze({
  inheritActiveExtensionSources: true,
  noExtensions: true,
})

export async function bindChildSessionExtensions(
  session: Pick<AgentSession, "bindExtensions" | "dispose" | "extensionRunner">,
): Promise<() => Promise<void>> {
  let shutdownPromise: Promise<void> | undefined
  const shutdown = () => {
    shutdownPromise ??= (async () => {
      try {
        if (session.extensionRunner.hasHandlers("session_shutdown")) {
          await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" })
        }
      } finally {
        session.dispose()
      }
    })()
    return shutdownPromise
  }
  try {
    await session.bindExtensions({ mode: "print" })
  } catch (error) {
    await shutdown().catch(() => {})
    throw error
  }
  return shutdown
}

type PiChildSessionSdk = Pick<
  typeof import("@earendil-works/pi-coding-agent"),
  | "createAgentSession"
  | "DefaultResourceLoader"
  | "getAgentDir"
  | "SessionManager"
  | "SettingsManager"
>

async function loadPiChildSessionSdk(): Promise<PiChildSessionSdk> {
  return import("@earendil-works/pi-coding-agent")
}

export async function createProductionChildSession(
  request: PiChildSessionRequest,
  loadSdk: () => Promise<PiChildSessionSdk> = loadPiChildSessionSdk,
): Promise<PiSession> {
  const {
    createAgentSession,
    DefaultResourceLoader,
    getAgentDir,
    SessionManager,
    SettingsManager,
  } = await loadSdk()
  const { spec, coordinator } = request
  const restored = persistedActorState(spec.sessionState)
  const { snapshot } = request.runtime
  const prepared = restored === undefined
    ? prepareCollaborationHistory(spec.context.history, snapshot.model)
    : undefined
  const systemPrompt = prepared?.promptContext.length
    ? `${snapshot.systemPrompt}\n\n${prepared.promptContext.join("\n\n")}`
    : snapshot.systemPrompt
  const loadedSettings = SettingsManager.create(snapshot.cwd, getAgentDir(), {
    projectTrusted: snapshot.projectTrusted,
  })
  const settingsManager = SettingsManager.inMemory(loadedSettings.getGlobalSettings(), {
    projectTrusted: snapshot.projectTrusted,
  })
  settingsManager.applyOverrides(loadedSettings.getProjectSettings())
  const loader = new DefaultResourceLoader({
    cwd: snapshot.cwd,
    agentDir: getAgentDir(),
    additionalExtensionPaths: [...snapshot.extensionPaths],
    settingsManager,
    noExtensions: PI_CHILD_SESSION_POLICY.noExtensions,
    systemPrompt,
    extensionFactories: [{
      name: `codex-ultra-${spec.path}`,
      factory: (childPi) => {
        registerUltraHooks(childPi, {
          actorKind: "subagent",
          collaborationConfig: () => request.runtime.snapshot.collaborationConfig,
          isEnabled: () => snapshot.ultraEnabled,
        })
        registerCollaborationTools(childPi, coordinator, spec.path, (ctx) => {
          request.runtime.update(snapshotFromContext(ctx, {
            collaborationConfig: request.runtime.snapshot.collaborationConfig,
            thinkingLevel: childPi.getThinkingLevel(),
            toolInfos: childPi.getAllTools(),
            tools: childPi.getActiveTools(),
            ultraEnabled: snapshot.ultraEnabled,
          }))
        })
      },
    }],
  })
  await loader.reload()

  const sessionManager = SessionManager.inMemory(snapshot.cwd)
  appendForkHistory(
    sessionManager,
    restored?.messages ?? prepared?.messages ?? [],
  )
  const { session } = await createAgentSession({
    cwd: snapshot.cwd,
    model: snapshot.model,
    thinkingLevel: snapshot.thinkingLevel,
    modelRegistry: snapshot.modelRegistry,
    tools: [...snapshot.tools],
    resourceLoader: loader,
    sessionManager,
    sessionStartEvent: {
      type: "session_start",
      reason: restored === undefined ? "fork" : "resume",
    },
    settingsManager,
  })
  const shutdownExtensions = await bindChildSessionExtensions(session)
  try {
    assertInheritedToolParity(snapshot, session, spec.path)
  } catch (error) {
    await shutdownExtensions().catch(() => {})
    throw error
  }
  const activeTools = session.getActiveToolNames()
  const toolInfos = activeToolInfos(activeTools, session.getAllTools())
  request.runtime.update(Object.freeze({
    ...request.runtime.snapshot,
    extensionPaths: Object.freeze(extensionPaths(toolInfos)),
    model: session.model ?? request.runtime.snapshot.model,
    systemPrompt: session.systemPrompt,
    thinkingLevel: session.thinkingLevel,
    toolInfos: Object.freeze(toolInfos),
    tools: Object.freeze(activeTools),
  }))
  Object.defineProperty(session, "shutdownExtensions", { value: shutdownExtensions })
  return session
}
