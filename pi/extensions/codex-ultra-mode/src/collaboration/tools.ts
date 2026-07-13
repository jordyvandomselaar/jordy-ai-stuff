import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import type { CollaborationConfig } from "../collaboration-config.ts"
import { ROOT_AGENT_PATH } from "../ultra-contract.ts"
import type { AgentStatus } from "./coordinator-contracts.ts"
import type { CollaborationCoordinator } from "./coordinator.ts"
import { forkHistoryFromPiBranch } from "./pi-history.ts"
import { collaborationToolContracts } from "./tool-contract.ts"
import { renderCollaborationCall, renderCollaborationResult } from "./tool-rendering.ts"

type CoordinatorSource = CollaborationCoordinator | (() => CollaborationCoordinator)

function currentCoordinator(source: CoordinatorSource): CollaborationCoordinator {
  return typeof source === "function" ? source() : source
}

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: value,
  }
}

function emptyResult() {
  return { content: [{ type: "text" as const, text: "" }], details: {} }
}

function publicStatus(status: AgentStatus): unknown {
  switch (status.kind) {
    case "completed":
      return { completed: status.message }
    case "errored":
      return { errored: status.message }
    default:
      return status.kind
  }
}

function timeoutMs(value: number | undefined, config: CollaborationConfig): number {
  const timeout = value ?? config.defaultWaitTimeoutMs
  if (timeout < config.minWaitTimeoutMs) {
    throw new Error(`timeout_ms must be at least ${config.minWaitTimeoutMs}`)
  }
  if (timeout > config.maxWaitTimeoutMs) {
    throw new Error(`timeout_ms must be at most ${config.maxWaitTimeoutMs}`)
  }
  return timeout
}

export function registerCollaborationTools(
  pi: ExtensionAPI,
  coordinator: CoordinatorSource,
  actorPath: string,
  refreshRuntime?: (ctx: ExtensionContext) => void,
): void {
  const contracts = collaborationToolContracts(currentCoordinator(coordinator).config)
  const presentation = (name: keyof typeof contracts) => ({
    renderCall(args: Record<string, unknown>, theme: Parameters<typeof renderCollaborationCall>[2]) {
      return renderCollaborationCall(contracts[name].label, args, theme)
    },
    renderResult(
      toolResult: { content: readonly { type: string; text?: string }[]; details?: unknown },
      options: { expanded: boolean; isError: boolean; isPartial: boolean },
      theme: Parameters<typeof renderCollaborationResult>[4],
    ) {
      return renderCollaborationResult(name, toolResult.content, toolResult.details, options, theme)
    },
  })

  pi.registerTool({
    name: "spawn_agent",
    ...contracts.spawn_agent,
    ...presentation("spawn_agent"),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      refreshRuntime?.(ctx)
      const snapshot = await currentCoordinator(coordinator).spawn(actorPath, params.task_name, {
        task: params.message,
        parentHistory: forkHistoryFromPiBranch(ctx.sessionManager.buildContextEntries()),
        forkTurns: params.fork_turns,
        model: params.model,
        reasoningEffort: params.reasoning_effort,
      })
      return result({ task_name: snapshot.path })
    },
  })

  pi.registerTool({
    name: "send_message",
    ...contracts.send_message,
    ...presentation("send_message"),
    async execute(toolCallId, params) {
      await currentCoordinator(coordinator).sendMessage(
        actorPath,
        params.target,
        params.message,
        toolCallId,
      )
      return emptyResult()
    },
  })

  pi.registerTool({
    name: "followup_task",
    ...contracts.followup_task,
    ...presentation("followup_task"),
    async execute(toolCallId, params) {
      await currentCoordinator(coordinator).followUp(
        actorPath,
        params.target,
        params.message,
        toolCallId,
      )
      return emptyResult()
    },
  })

  pi.registerTool({
    name: "wait_agent",
    ...contracts.wait_agent,
    ...presentation("wait_agent"),
    async execute(_toolCallId, params, signal) {
      const activeCoordinator = currentCoordinator(coordinator)
      const outcome = await activeCoordinator.waitForMailbox(
        actorPath,
        timeoutMs(params.timeout_ms, activeCoordinator.config),
        signal,
      )
      if (outcome.kind === "timeout") return result({ message: "Wait timed out.", timed_out: true })
      if (outcome.kind === "activity") return result({ message: "Wait completed.", timed_out: false })
      if (outcome.kind === "shutdown") {
        return result({ message: "Wait stopped because collaboration shut down.", timed_out: false })
      }
      return result({ message: "Wait interrupted by new input.", timed_out: false })
    },
  })

  pi.registerTool({
    name: "interrupt_agent",
    ...contracts.interrupt_agent,
    ...presentation("interrupt_agent"),
    async execute(_toolCallId, params) {
      const previousStatus = await currentCoordinator(coordinator).interrupt(
        actorPath,
        params.target,
      )
      return result({ previous_status: publicStatus(previousStatus) })
    },
  })

  pi.registerTool({
    name: "list_agents",
    ...contracts.list_agents,
    ...presentation("list_agents"),
    async execute(_toolCallId, params) {
      const activeCoordinator = currentCoordinator(coordinator)
      const prefix = params.path_prefix === undefined
        ? ROOT_AGENT_PATH
        : activeCoordinator.resolveTarget(actorPath, params.path_prefix).path
      return result({
        agents: activeCoordinator.listAgents(prefix).map((agent) => ({
          agent_name: agent.path,
          agent_status: publicStatus(agent.status),
          last_task_message: agent.latestTask,
        })),
      })
    },
  })
}
