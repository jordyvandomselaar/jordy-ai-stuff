import { ROOT_AGENT_PATH } from "../ultra-contract.ts"
import type { AgentSnapshot, AgentStatus } from "./coordinator-contracts.ts"
import { CollaborationError, messageForError } from "./coordinator-contracts.ts"
import type { CoordinatorDelivery } from "./coordinator-delivery.ts"
import type { CoordinatorRegistry } from "./coordinator-registry.ts"
import {
  type AgentState,
  isActiveState,
  stateSession,
  transitionGate,
  transitionLost,
} from "./coordinator-state.ts"
import { failureEnvelope } from "./failure-envelope.ts"

export class CoordinatorTerminalLifecycle {
  constructor(
    private readonly registry: CoordinatorRegistry,
    private readonly delivery: CoordinatorDelivery,
    private readonly ensureRunning: () => void,
  ) {}

  async complete(
    path: string,
    message: string | null,
    operationId?: string,
  ): Promise<AgentSnapshot> {
    const record = this.registry.nonRoot(path, "complete")
    if (record.state.kind === "initializing" || record.state.kind === "delivering") {
      await record.state.gate.promise
      return this.complete(path, message, operationId)
    }
    if (record.state.kind === "completing") {
      await record.state.gate.promise
      return this.registry.snapshot(record)
    }
    if (record.state.kind !== "running") return this.registry.snapshot(record)

    const session = record.state.session
    const parent = this.registry.require(record.parentPath ?? ROOT_AGENT_PATH)
    this.delivery.queueCommunication(
      "final_answer",
      record.path,
      parent,
      message ?? "",
      false,
      operationId,
    )
    const gate = transitionGate()
    const owner: Extract<AgentState, { kind: "completing" }> = {
      kind: "completing",
      session,
      message,
      gate,
    }
    record.state = owner

    let deliveryFailure: CollaborationError | undefined
    try {
      await this.delivery.deliverPending(parent)
    } catch (error) {
      deliveryFailure = this.delivery.deliveryError(error)
    }
    try {
      if (record.state !== owner) throw transitionLost("completion", record.path)
      await session.unload()
      if (record.state !== owner) throw transitionLost("completion", record.path)
      record.state = {
        kind: "terminal",
        session,
        status: { kind: "completed", message },
      }
      this.registry.persist(record)
      gate.resolve()
      const snapshot = this.registry.snapshot(record)
      if (deliveryFailure !== undefined) throw deliveryFailure
      return snapshot
    } catch (error) {
      const failure = this.delivery.deliveryError(error)
      if (record.state === owner) {
        record.state = {
          kind: "terminal",
          session,
          status: { kind: "completed", message },
        }
        this.registry.persist(record)
      }
      gate.reject(failure)
      throw failure
    }
  }

  async fail(path: string, error: string): Promise<AgentSnapshot> {
    const record = this.registry.nonRoot(path, "fail")
    if (
      record.state.kind === "initializing"
      || record.state.kind === "delivering"
      || record.state.kind === "completing"
    ) {
      await record.state.gate.promise
      return this.fail(path, error)
    }
    if (record.state.kind === "failing") {
      await record.state.gate.promise
      return this.registry.snapshot(record)
    }
    if (record.state.kind !== "running") return this.registry.snapshot(record)
    const session = record.state.session
    const parent = this.registry.require(record.parentPath ?? ROOT_AGENT_PATH)
    const gate = transitionGate()
    let owner!: Extract<AgentState, { kind: "failing" }>
    const unload = Promise.resolve().then(async () => {
      this.delivery.queueCommunication(
        "final_answer",
        record.path,
        parent,
        failureEnvelope(error),
        false,
        `failure:${record.path}:${error}`,
      )
      let deliveryFailure: CollaborationError | undefined
      try {
        await this.delivery.deliverPending(parent)
      } catch (notificationError) {
        deliveryFailure = this.delivery.deliveryError(notificationError)
      }
      await session.unload()
      if (deliveryFailure !== undefined) throw deliveryFailure
    })
    owner = { kind: "failing", session, unload, gate }
    record.state = owner

    try {
      await unload
      if (record.state !== owner) return this.registry.snapshot(record)
      record.state = {
        kind: "terminal",
        session,
        status: { kind: "errored", message: error },
      }
      this.registry.persist(record)
      gate.resolve()
      return this.registry.snapshot(record)
    } catch (unloadError) {
      if (record.state !== owner) return this.registry.snapshot(record)
      const failure = unloadError instanceof CollaborationError
        ? unloadError
        : new CollaborationError("initialization_failed", messageForError(unloadError))
      record.state = {
        kind: "terminal",
        session,
        status: { kind: "errored", message: error },
      }
      this.registry.persist(record)
      gate.resolve()
      throw failure
    }
  }

  async markInterrupted(path: string): Promise<AgentSnapshot> {
    const record = this.registry.nonRoot(path, "mark interrupted")
    if (
      record.state.kind === "initializing"
      || record.state.kind === "delivering"
      || record.state.kind === "completing"
      || record.state.kind === "failing"
    ) {
      await record.state.gate.promise
      return this.markInterrupted(path)
    }
    if (record.state.kind !== "running") return this.registry.snapshot(record)
    const session = record.state.session
    record.state = { kind: "terminal", session, status: { kind: "interrupted" } }
    await session.unload()
    this.registry.persist(record)
    return this.registry.snapshot(record)
  }

  async interrupt(senderPath: string, target: string): Promise<AgentStatus> {
    this.ensureRunning()
    const sender = this.registry.require(this.registry.canonicalPath(senderPath))
    const recipient = this.registry.require(this.registry.resolvedPath(sender.path, target))
    if (recipient.path === ROOT_AGENT_PATH) {
      throw new CollaborationError("invalid_operation", "root is not a spawned agent")
    }
    if (recipient.path === sender.path) {
      throw new CollaborationError("invalid_operation", "an agent cannot interrupt itself")
    }

    const previousStatus = this.registry.snapshot(recipient).status
    if (!isActiveState(recipient.state)) return previousStatus
    const previousState = recipient.state
    const session = stateSession(previousState)
    recipient.state = { kind: "terminal", session, status: { kind: "interrupted" } }
    const interrupted = transitionLost("operation", recipient.path)
    if (
      previousState.kind === "initializing"
      || previousState.kind === "delivering"
      || previousState.kind === "completing"
      || previousState.kind === "failing"
    ) {
      previousState.gate.reject(interrupted)
    }
    if (session !== undefined) {
      try {
        await session.interrupt()
      } finally {
        if (previousState.kind === "failing") await previousState.unload
        else await session.unload()
      }
    }
    this.registry.persist(recipient)
    return previousStatus
  }
}
