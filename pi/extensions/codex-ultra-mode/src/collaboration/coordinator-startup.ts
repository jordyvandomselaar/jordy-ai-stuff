import { ROOT_AGENT_PATH } from "../ultra-contract.ts"
import type {
  CollaborationActorContext,
  CollaborationActorFactory,
  CollaborationActorSession,
} from "./actor-session.ts"
import { parseForkTurns, projectForkContext } from "./context-fork.ts"
import {
  CollaborationError,
  type AgentCommunication,
  type AgentSnapshot,
  messageForError,
  nonEmptyMessage,
  type PersistedAgentRecord,
  type SpawnAgentRequest,
  type TerminalAgentStatus,
} from "./coordinator-contracts.ts"
import type { CoordinatorDelivery } from "./coordinator-delivery.ts"
import type { CoordinatorRegistry } from "./coordinator-registry.ts"
import type { CoordinatorResidency } from "./coordinator-residency.ts"
import type { CoordinatorSessionLifecycle } from "./coordinator-shutdown.ts"
import {
  type AgentRecord,
  type AgentState,
  stateSession,
  stateStatus,
  transitionGate,
  transitionLost,
} from "./coordinator-state.ts"

export class CoordinatorStartup {
  constructor(
    private readonly actorFactory: CollaborationActorFactory,
    private readonly registry: CoordinatorRegistry,
    private readonly delivery: CoordinatorDelivery,
    private readonly residency: CoordinatorResidency,
    private readonly lifecycle: CoordinatorSessionLifecycle,
  ) {}

  async restore(
    records: readonly PersistedAgentRecord[],
    rootOutbox: readonly AgentCommunication[] = [],
  ): Promise<void> {
    this.registry.require(ROOT_AGENT_PATH).pending.push(...rootOutbox)
    const ordered = [...records].sort(
      (left, right) => left.path.split("/").length - right.path.split("/").length,
    )
    for (const persisted of ordered) {
      if (persisted.path === ROOT_AGENT_PATH || this.registry.has(persisted.path)) continue
      const terminalHistory = persisted.status.kind === "completed" && persisted.status.message
        ? [{ role: "assistant" as const, content: persisted.status.message }]
        : []
      const latestTaskHistory = persisted.latestTask === null
        ? []
        : [{ role: "developer" as const, content: `Most recent task: ${persisted.latestTask}` }]
      const context: CollaborationActorContext = persisted.sessionState === undefined
        ? {
          ...persisted.context,
          history: [
            ...persisted.context.history,
            ...terminalHistory,
            ...latestTaskHistory,
          ],
        }
        : persisted.context
      const parent = this.registry.require(persisted.parentPath)
      const session = await this.residency.createResident(
        persisted.path,
        () => this.actorFactory.createActor({
          path: persisted.path,
          parentPath: persisted.parentPath,
          task: persisted.latestTask ?? persisted.context.initialInput.payload,
          context,
          sessionState: persisted.sessionState,
        }, stateSession(parent.state)),
      )
      const status: TerminalAgentStatus = persisted.status.kind === "completed"
        || persisted.status.kind === "errored"
        || persisted.status.kind === "interrupted"
        ? persisted.status
        : { kind: "interrupted" }
      this.registry.set({
        path: persisted.path,
        parentPath: persisted.parentPath,
        latestTask: persisted.latestTask,
        context,
        pending: [],
        unreadActivity: 0,
        state: { kind: "terminal", session, status },
      })
    }
  }

  async spawn(
    parentPath: string,
    taskName: string,
    request: SpawnAgentRequest,
  ): Promise<AgentSnapshot> {
    this.lifecycle.ensureRunning()
    const parent = this.registry.require(this.registry.canonicalPath(parentPath))
    if (stateStatus(parent.state).kind !== "running") {
      throw new CollaborationError("invalid_operation", `${parent.path} is not running`)
    }
    const path = this.registry.joinedPath(parent.path, taskName)
    if (this.registry.has(path)) {
      throw new CollaborationError("duplicate_agent", `agent ${path} already exists`)
    }
    const task = nonEmptyMessage(request.task)
    const context = this.forkContext(parent.path, path, task, request)
    this.registry.reserveSlot()

    let creation: Promise<CollaborationActorSession>
    try {
      creation = this.residency.createResident(path, () => this.actorFactory.createActor(
        {
          path,
          parentPath: parent.path,
          task,
          context,
          runtimeOverrides: {
            model: request.model,
            reasoningEffort: request.reasoningEffort,
          },
        },
        stateSession(parent.state),
      ))
    } catch (error) {
      throw new CollaborationError("initialization_failed", messageForError(error))
    }

    const gate = transitionGate()
    const owner: Extract<AgentState, { kind: "initializing" }> = {
      kind: "initializing",
      creation,
      gate,
    }
    const record: AgentRecord = {
      path,
      parentPath: parent.path,
      latestTask: task,
      context,
      pending: [],
      unreadActivity: 0,
      state: owner,
    }
    this.registry.set(record)
    this.registry.persist(record)
    this.delivery.queueCommunication(
      context.initialInput.kind,
      context.initialInput.sender,
      record,
      context.initialInput.payload,
      context.initialInput.triggerTurn,
      `spawn:${path}`,
    )

    let session: CollaborationActorSession
    try {
      session = await creation
    } catch (error) {
      this.residency.forget(path)
      if (record.state !== owner) {
        if (this.lifecycle.isDisposed()) {
          const shutdown = new CollaborationError(
            "coordinator_shutdown",
            "collaboration coordinator is shut down",
          )
          gate.reject(shutdown)
          throw shutdown
        }
        const interrupted = transitionLost("initialization", record.path)
        gate.reject(interrupted)
        throw interrupted
      }
      this.registry.delete(path)
      const failure = new CollaborationError("initialization_failed", messageForError(error))
      gate.reject(failure)
      throw failure
    }

    if (record.state !== owner) {
      await this.lifecycle.disposeSessionOnce(session)
      this.residency.forget(path)
      const interrupted = this.lifecycle.isDisposed()
        ? new CollaborationError("coordinator_shutdown", "collaboration coordinator is shut down")
        : transitionLost("initialization", record.path)
      gate.reject(interrupted)
      throw interrupted
    }

    try {
      await this.delivery.drainPending(record, session, owner)
    } catch (error) {
      if (record.state !== owner) {
        await this.lifecycle.disposeSessionOnce(session)
        this.residency.forget(path)
        const interrupted = transitionLost("initialization", record.path)
        gate.reject(interrupted)
        throw interrupted
      }
      await session.unload()
      record.state = {
        kind: "terminal",
        session,
        status: { kind: "errored", message: messageForError(error) },
      }
      const failure = new CollaborationError("delivery_failed", messageForError(error))
      gate.reject(failure)
      throw failure
    }

    if (record.state !== owner) {
      await this.lifecycle.disposeSessionOnce(session)
      this.residency.forget(path)
      const interrupted = transitionLost("initialization", record.path)
      gate.reject(interrupted)
      throw interrupted
    }
    record.state = { kind: "running", session }
    gate.resolve()
    this.registry.persist(record)
    return this.registry.snapshot(record)
  }

  private forkContext(
    parentPath: string,
    childPath: string,
    task: string,
    request: SpawnAgentRequest,
  ) {
    try {
      if (
        parseForkTurns(request.forkTurns).kind === "all"
        && (request.model !== undefined || request.reasoningEffort !== undefined)
      ) {
        throw new Error("model and reasoning_effort overrides require a truncated fork")
      }
      return projectForkContext({
        childPath,
        parentPath,
        task,
        parentHistory: request.parentHistory,
        forkTurns: request.forkTurns,
      })
    } catch (error) {
      throw new CollaborationError("invalid_fork_turns", messageForError(error))
    }
  }
}
