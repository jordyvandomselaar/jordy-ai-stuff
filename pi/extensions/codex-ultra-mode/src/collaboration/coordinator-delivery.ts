import { ROOT_AGENT_PATH } from "../ultra-contract.ts"
import type {
  CollaborationActorSession,
  CollaborationInputSink,
} from "./actor-session.ts"
import {
  CollaborationError,
  type AgentCommunication,
  type AgentSnapshot,
  type CollaborationClock,
  type CollaborationPersistence,
  type MailboxWaitResult,
  messageForError,
  nonEmptyMessage,
} from "./coordinator-contracts.ts"
import type { CoordinatorRegistry } from "./coordinator-registry.ts"
import type { CoordinatorResidency } from "./coordinator-residency.ts"
import {
  type AgentRecord,
  type AgentState,
  type MailboxWaiter,
  type RunningAgentState,
  stateStatus,
  type TerminalAgentState,
  transitionGate,
  transitionLost,
} from "./coordinator-state.ts"
import { randomUUID } from "node:crypto"
export class CoordinatorDelivery {
  private readonly mailboxWaiters = new Map<string, Set<MailboxWaiter>>()
  private nextMessageId = 1
  constructor(
    private readonly registry: CoordinatorRegistry,
    private readonly residency: CoordinatorResidency,
    private readonly clock: CollaborationClock,
    private readonly ensureRunning: () => void,
    private readonly persistence?: CollaborationPersistence,
  ) {}
  async flushRoot(): Promise<void> {
    await this.deliverPending(this.registry.require(ROOT_AGENT_PATH))
  }
  async sendMessage(
    senderPath: string,
    target: string,
    message: string,
    operationId?: string,
  ): Promise<AgentCommunication> {
    this.ensureRunning()
    const sender = this.registry.require(this.registry.canonicalPath(senderPath))
    const recipient = this.registry.require(this.registry.resolvedPath(sender.path, target))
    const communication = this.queueCommunication(
      "message",
      sender.path,
      recipient,
      nonEmptyMessage(message),
      false,
      operationId,
    )
    await this.deliverPending(recipient)
    this.registry.persist(recipient)
    return communication
  }
  async followUp(
    senderPath: string,
    target: string,
    task: string,
    operationId?: string,
  ): Promise<AgentSnapshot> {
    this.ensureRunning()
    const sender = this.registry.require(this.registry.canonicalPath(senderPath))
    const recipient = this.registry.require(this.registry.resolvedPath(sender.path, target))
    if (recipient.path === ROOT_AGENT_PATH) {
      throw new CollaborationError("invalid_operation", "follow-up tasks cannot target the root agent")
    }
    const message = nonEmptyMessage(task)
    this.queueCommunication("message", sender.path, recipient, message, true, operationId)
    await this.deliverPending(recipient)
    if (stateStatus(recipient.state).kind !== "running") {
      throw transitionLost("follow-up", recipient.path)
    }
    recipient.latestTask = message
    this.registry.persist(recipient)
    return this.registry.snapshot(recipient)
  }
  waitForMailbox(
    path: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<MailboxWaitResult> {
    const record = this.registry.require(this.registry.canonicalPath(path))
    if (record.unreadActivity > 0) {
      record.unreadActivity -= 1
      return Promise.resolve({ kind: "activity" })
    }
    try {
      this.ensureRunning()
    } catch {
      return Promise.resolve({ kind: "shutdown" })
    }
    if (signal?.aborted === true) return Promise.resolve({ kind: "aborted" })
    return new Promise((resolve) => {
      let settled = false
      let cancelTimer = () => {}
      const waiter: MailboxWaiter = {
        settle: (result) => {
          if (settled) return
          settled = true
          cancelTimer()
          signal?.removeEventListener("abort", abort)
          this.mailboxWaiters.get(record.path)?.delete(waiter)
          resolve(result)
        },
      }
      const abort = () => waiter.settle({ kind: "aborted" })
      const waiters = this.mailboxWaiters.get(record.path) ?? new Set<MailboxWaiter>()
      waiters.add(waiter)
      this.mailboxWaiters.set(record.path, waiters)
      signal?.addEventListener("abort", abort, { once: true })
      cancelTimer = this.clock.schedule(timeoutMs, () => waiter.settle({ kind: "timeout" }))
      if (signal?.aborted === true) waiter.settle({ kind: "aborted" })
    })
  }
  wakeShutdownWaiters(): void {
    for (const waiters of this.mailboxWaiters.values()) {
      for (const waiter of [...waiters]) waiter.settle({ kind: "shutdown" })
    }
  }
  acknowledgeMailboxActivity(path: string): void {
    this.registry.require(this.registry.canonicalPath(path)).unreadActivity = 0
  }
  async deliverPending(record: AgentRecord): Promise<void> {
    while (record.pending.length > 0) {
      const state = record.state
      switch (state.kind) {
        case "root":
          if (state.sink === undefined) return
          await this.deliverOne(record, state.sink, record.pending[0])
          break
        case "initializing":
        case "delivering":
        case "completing":
        case "failing":
          await state.gate.promise
          break
        case "running":
        case "terminal":
          await this.startDelivery(record, state)
          break
        case "shutdown":
          throw new CollaborationError(
            "coordinator_shutdown",
            "collaboration coordinator is shut down",
          )
      }
    }
  }
  async drainPending(
    record: AgentRecord,
    session: CollaborationActorSession,
    owner: AgentState,
  ): Promise<void> {
    while (record.pending.length > 0) {
      if (record.state !== owner) throw transitionLost("delivery", record.path)
      await this.deliverOne(record, session, record.pending[0], owner)
    }
  }
  queueCommunication(
    kind: AgentCommunication["kind"],
    sender: string,
    recipient: AgentRecord,
    payload: string,
    triggerTurn: boolean,
    operationId?: string,
  ): AgentCommunication {
    if (operationId !== undefined) {
      const existing = recipient.pending.find(
        (communication) => communication.operationId === operationId,
      )
      if (existing !== undefined) {
        if (
          existing.kind !== kind
          || existing.sender !== sender
          || existing.payload !== payload
          || existing.triggerTurn !== triggerTurn
        ) {
          throw new CollaborationError(
            "invalid_operation",
            `operation ${operationId} was already used for a different communication`,
          )
        }
        return existing
      }
    }
    const communication = {
      id: this.nextMessageId++,
      deliveryId: randomUUID(),
      operationId,
      kind,
      sender,
      recipient: recipient.path,
      payload,
      triggerTurn,
    }
    recipient.pending.push(communication)
    return communication
  }
  deliveryError(error: unknown): CollaborationError {
    return error instanceof CollaborationError
      ? error
      : new CollaborationError("delivery_failed", messageForError(error))
  }
  private async startDelivery(
    record: AgentRecord,
    previous: RunningAgentState | TerminalAgentState,
  ): Promise<void> {
    if (
      previous.kind === "terminal"
      && (previous.session === undefined || this.residency.isEvicting(record.path))
    ) {
      await this.residency.ensureLoaded(record.path)
      if (record.state !== previous) return
    }
    const session = previous.session
    if (session === undefined) {
      throw new CollaborationError("invalid_operation", `${record.path} cannot be resumed`)
    }
    this.residency.touch(record.path)
    const gate = transitionGate()
    const owner: Extract<AgentState, { kind: "delivering" }> = {
      kind: "delivering",
      session,
      previous,
      activated: previous.kind === "running",
      gate,
    }
    record.state = owner
    try {
      while (record.pending.length > 0) {
        if (record.state !== owner) throw transitionLost("delivery", record.path)
        const communication = record.pending[0]
        if (!owner.activated && communication.triggerTurn) {
          this.registry.reserveSlot()
          owner.activated = true
        }
        await this.deliverOne(record, session, communication, owner)
      }
      if (record.state !== owner) throw transitionLost("delivery", record.path)
      record.state = owner.activated ? { kind: "running", session } : previous
      gate.resolve()
    } catch (error) {
      const failure = this.deliveryError(error)
      if (record.state === owner) record.state = previous
      gate.reject(failure)
      throw failure
    }
  }
  private async deliverOne(
    recipient: AgentRecord,
    sink: CollaborationInputSink,
    communication: AgentCommunication,
    owner?: AgentState,
  ): Promise<void> {
    try {
      if (recipient.path === ROOT_AGENT_PATH) {
        this.persistence?.persistCommunication(communication)
      }
      await sink.deliver(communication)
      if (owner !== undefined && recipient.state !== owner) {
        throw transitionLost("delivery", recipient.path)
      }
      this.removeCommunication(recipient, communication.id)
      if (!communication.triggerTurn) this.publishActivity(recipient)
    } catch (error) {
      throw this.deliveryError(error)
    }
  }
  private publishActivity(recipient: AgentRecord): void {
    const waiter = this.mailboxWaiters.get(recipient.path)?.values().next().value
    if (waiter === undefined) recipient.unreadActivity += 1
    else waiter.settle({ kind: "activity" })
  }
  private removeCommunication(recipient: AgentRecord, id: number): void {
    const index = recipient.pending.findIndex((message) => message.id === id)
    if (index === -1) return
    const communication = recipient.pending[index]
    if (recipient.path === ROOT_AGENT_PATH) {
      this.persistence?.acknowledgeCommunication(communication)
    }
    recipient.pending.splice(index, 1)
  }
}
