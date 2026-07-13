import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import {
  DEFAULT_COLLABORATION_CONFIG,
  type CollaborationConfig,
  type CollaborationConfigResolution,
  resolveCollaborationConfig,
} from "./collaboration-config.ts"
import { CollaborationCoordinator } from "./collaboration/coordinator.ts"
import {
  PiActorFactory,
  type PiChildSessionCreator,
} from "./collaboration/pi-actor-session.ts"
import { PiRootMailbox } from "./collaboration/pi-root-mailbox.ts"
import { registerCollaborationTools } from "./collaboration/tools.ts"
import { resolveUltraContext } from "./ultra-context.ts"
import { registerUltraHooks } from "./ultra-hooks.ts"

const ULTRA_MODE_STATE_ENTRY = "codex-ultra-mode-state"

function restoredUltraModeEnabled(ctx: ExtensionContext): boolean {
  for (const entry of ctx.sessionManager.getBranch().toReversed()) {
    if (entry.type !== "custom" || entry.customType !== ULTRA_MODE_STATE_ENTRY) continue
    if (typeof entry.data !== "object" || entry.data === null) continue
    const enabled = (entry.data as { enabled?: unknown }).enabled
    if (typeof enabled === "boolean") return enabled
  }
  return false
}

export interface CodexUltraModeDependencies {
  createChildSession?: PiChildSessionCreator
  resolveCollaborationConfig?(ctx: ExtensionContext): CollaborationConfigResolution
}

function sameCollaborationConfig(
  left: CollaborationConfig,
  right: CollaborationConfig,
): boolean {
  return left.defaultWaitTimeoutMs === right.defaultWaitTimeoutMs
    && left.hideSpawnAgentMetadata === right.hideSpawnAgentMetadata
    && left.maxConcurrentThreadsPerSession === right.maxConcurrentThreadsPerSession
    && left.maxWaitTimeoutMs === right.maxWaitTimeoutMs
    && left.minWaitTimeoutMs === right.minWaitTimeoutMs
    && left.multiAgentModeHintText === right.multiAgentModeHintText
    && left.rootAgentUsageHintText === right.rootAgentUsageHintText
    && left.spawnAgentUsageHintText === right.spawnAgentUsageHintText
    && left.subagentUsageHintText === right.subagentUsageHintText
}

export function createCodexUltraModeExtension(
  dependencies: CodexUltraModeDependencies = {},
): (pi: ExtensionAPI) => void {
  return (pi) => {
    const rootMailbox = new PiRootMailbox()
    let coordinator: CollaborationCoordinator
    const actorFactory = new PiActorFactory(
      rootMailbox,
      () => coordinator,
      dependencies.createChildSession,
      rootMailbox,
    )
    let collaborationConfig = DEFAULT_COLLABORATION_CONFIG
    let activeContext: ExtensionContext | undefined
    const newCoordinator = () => new CollaborationCoordinator(
      actorFactory,
      undefined,
      rootMailbox,
      collaborationConfig,
      () => {
        if (activeContext !== undefined) syncStatus(activeContext)
      },
    )
    coordinator = newCoordinator()
    let activeSessionId: string | undefined
    let coordinatorNeedsReset = false
    let ultraEnabled = false

    registerUltraHooks(pi, {
      actorKind: "root",
      collaborationConfig: () => collaborationConfig,
      isEnabled: () => ultraEnabled,
    })
    registerCollaborationTools(pi, () => coordinator, "/root", (ctx) => {
      actorFactory.bindRoot(ctx, {
        collaborationConfig,
        thinkingLevel: pi.getThinkingLevel(),
        toolInfos: pi.getAllTools(),
        tools: pi.getActiveTools(),
        ultraEnabled,
      })
    })

    function syncStatus(ctx: ExtensionContext): void {
      const context = resolveUltraContext(ctx.model, ultraEnabled)
      const status = !ultraEnabled
        ? undefined
        : context.supported
          ? `Ultra (${pi.getThinkingLevel()}) · ${coordinator.activeAgentCount}`
          : `Ultra (paused) · ${coordinator.activeAgentCount}`
      ctx.ui.setStatus("codex-ultra-mode", status)
    }
    const refreshRoot = (ctx: ExtensionContext) => {
      activeContext = ctx
      rootMailbox.bind(ctx)
      actorFactory.bindRoot(ctx, {
        collaborationConfig,
        thinkingLevel: pi.getThinkingLevel(),
        toolInfos: pi.getAllTools(),
        tools: pi.getActiveTools(),
        ultraEnabled,
      })
      syncStatus(ctx)
    }
    pi.registerCommand("ultra", {
      description: "Toggle proactive Ultra delegation at the current thinking level",
      handler: async (_args, ctx) => {
        const supported = resolveUltraContext(ctx.model, true).supported
        if (!ultraEnabled && !supported) {
          ctx.ui.notify("Ultra mode requires an active model.", "warning")
          return
        }

        ultraEnabled = !ultraEnabled
        pi.appendEntry(ULTRA_MODE_STATE_ENTRY, { enabled: ultraEnabled })
        refreshRoot(ctx)
        const message = ultraEnabled
          ? `Ultra mode enabled with ${pi.getThinkingLevel()} thinking.`
          : "Ultra mode disabled."
        ctx.ui.notify(message, "info")
      },
    })
    pi.on("session_start", async (_event, ctx) => {
      ultraEnabled = restoredUltraModeEnabled(ctx)
      const sessionId = rootMailbox.sessionIdFor(ctx)
      const resolution = dependencies.resolveCollaborationConfig?.(ctx)
        ?? resolveCollaborationConfig({
          agentDir: (await import("@earendil-works/pi-coding-agent")).getAgentDir(),
          cwd: ctx.cwd,
          projectTrusted: ctx.isProjectTrusted(),
        })
      for (const diagnostic of resolution.diagnostics) {
        ctx.ui.notify(
          `Ignoring Ultra configuration at ${diagnostic.path}: ${diagnostic.message}`,
          "warning",
        )
      }
      const configChanged = !sameCollaborationConfig(
        collaborationConfig,
        resolution.config,
      )
      collaborationConfig = resolution.config
      if (
        coordinatorNeedsReset
        || configChanged
        || (activeSessionId !== undefined && activeSessionId !== sessionId)
      ) {
        await coordinator.dispose()
        coordinator = newCoordinator()
      }
      coordinatorNeedsReset = false
      refreshRoot(ctx)
      activeSessionId = sessionId
      await coordinator.restore(
        rootMailbox.restoredActors(ctx),
        rootMailbox.restoredOutbox(ctx),
      )
      await coordinator.flushRoot()
    })
    pi.on("context", (event, ctx) => ({ messages: rootMailbox.inject(event, ctx) }))
    pi.on("turn_end", (event, ctx) => {
      if (rootMailbox.acknowledge(event, ctx)) coordinator.acknowledgeMailboxActivity("/root")
    })
    pi.on("model_select", (_event, ctx) => refreshRoot(ctx))
    pi.on("thinking_level_select", (_event, ctx) => refreshRoot(ctx))
    pi.on("session_shutdown", async (_event, ctx) => {
      activeContext = undefined
      ctx.ui.setStatus("codex-ultra-mode", undefined)
      await coordinator.dispose()
      coordinatorNeedsReset = true
    })
  }
}

const codexUltraModeExtension = createCodexUltraModeExtension()

export default codexUltraModeExtension
