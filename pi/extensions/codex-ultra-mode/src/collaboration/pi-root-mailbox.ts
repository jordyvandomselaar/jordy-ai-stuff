import type {
  ContextEvent,
  ExtensionContext,
  SessionEntry,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent"
import type {
  CollaborationActorInput,
  CollaborationInputSink,
} from "./actor-session.ts"
import { COLLABORATION_MESSAGE_TYPE } from "./pi-history.ts"
import type {
  AgentCommunication,
  CollaborationPersistence,
  PersistedAgentRecord,
} from "./coordinator-contracts.ts"
import { PiActorJournal } from "./pi-actor-journal.ts"
import type { PiActorPersistence } from "./pi-actor-contracts.ts"

const CONSUMED_ENTRY_TYPE = "codex-ultra-collaboration-consumed"
const OUTBOX_ENTRY_TYPE = "codex-ultra-root-outbox"
const OUTBOX_ACK_ENTRY_TYPE = "codex-ultra-root-outbox-ack"

interface WritableSessionManager {
  appendCustomEntry(customType: string, data?: unknown): string
  appendCustomMessageEntry<T>(
    customType: string,
    content: string,
    display: boolean,
    details: T,
  ): string
  getBranch(): SessionEntry[]
  getSessionId(): string
}

interface RootMessageDetails extends CollaborationActorInput {
  deliveryId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function writableSessionManager(ctx: ExtensionContext): WritableSessionManager {
  const manager: unknown = ctx.sessionManager
  if (
    !isRecord(manager)
    || typeof manager.appendCustomEntry !== "function"
    || typeof manager.appendCustomMessageEntry !== "function"
    || typeof manager.getBranch !== "function"
    || typeof manager.getSessionId !== "function"
  ) {
    throw new Error("Pi session manager does not expose durable collaboration persistence")
  }
  return manager as WritableSessionManager
}

function consumedDeliveryId(entry: SessionEntry): string | undefined {
  if (entry.type !== "custom" || entry.customType !== CONSUMED_ENTRY_TYPE) return undefined
  return isRecord(entry.data) && typeof entry.data.deliveryId === "string"
    ? entry.data.deliveryId
    : undefined
}

function rootMessage(entry: SessionEntry): RootMessageDetails | undefined {
  if (entry.type !== "custom_message" || entry.customType !== COLLABORATION_MESSAGE_TYPE) {
    return undefined
  }
  const details = entry.details
  if (
    !isRecord(details)
    || typeof details.deliveryId !== "string"
    || typeof details.kind !== "string"
    || typeof details.sender !== "string"
    || typeof details.recipient !== "string"
    || typeof details.payload !== "string"
    || typeof details.triggerTurn !== "boolean"
  ) {
    return undefined
  }
  return details as RootMessageDetails
}

function persistedCommunication(entry: SessionEntry): AgentCommunication | undefined {
  if (entry.type !== "custom" || entry.customType !== OUTBOX_ENTRY_TYPE) return undefined
  const data = entry.data
  if (
    !isRecord(data)
    || typeof data.id !== "number"
    || typeof data.deliveryId !== "string"
    || typeof data.kind !== "string"
    || typeof data.sender !== "string"
    || typeof data.recipient !== "string"
    || typeof data.payload !== "string"
    || typeof data.triggerTurn !== "boolean"
  ) {
    return undefined
  }
  return data as AgentCommunication
}

function acknowledgedOutboxId(entry: SessionEntry): string | undefined {
  if (entry.type !== "custom" || entry.customType !== OUTBOX_ACK_ENTRY_TYPE) return undefined
  return isRecord(entry.data) && typeof entry.data.deliveryId === "string"
    ? entry.data.deliveryId
    : undefined
}

function envelope(input: CollaborationActorInput): string {
  return `Message Type: ${input.kind.toUpperCase()}\nTask name: ${input.recipient}\nSender: ${input.sender}\nPayload:\n${input.payload}`
}

export class PiRootMailbox implements CollaborationInputSink, CollaborationPersistence, PiActorPersistence {
  private manager?: WritableSessionManager
  private boundSessionId?: string
  private nextDeliveryId = 1
  private readonly inFlight = new Set<string>()
  private readonly actorJournal = new PiActorJournal(() => this.manager)
  private readonly persistedOutbox = new Set<string>()
  private readonly persistedRootMessages = new Set<string>()

  bind(ctx: ExtensionContext): void {
    const manager = writableSessionManager(ctx)
    const sessionId = manager.getSessionId()
    if (this.boundSessionId !== sessionId) {
      this.inFlight.clear()
      this.persistedOutbox.clear()
      this.persistedRootMessages.clear()
      this.boundSessionId = sessionId
    }
    this.manager = manager
    this.actorJournal.bind(manager.getBranch())
    for (const entry of manager.getBranch()) {
      const details = rootMessage(entry)
      if (details !== undefined) this.persistedRootMessages.add(details.deliveryId)
    }
  }

  sessionIdFor(ctx: ExtensionContext): string {
    return writableSessionManager(ctx).getSessionId()
  }

  deliver(input: CollaborationActorInput): void {
    const manager = this.manager
    if (manager === undefined) throw new Error("Ultra root mailbox is not bound to a Pi session")
    const communicationId = isRecord(input) && typeof input.deliveryId === "string"
      ? input.deliveryId
      : `delivery:${this.nextDeliveryId++}`
    const details: RootMessageDetails = {
      ...input,
      deliveryId: `${manager.getSessionId()}:${communicationId}`,
    }
    if (this.persistedRootMessages.has(details.deliveryId)) return
    manager.appendCustomMessageEntry(
      COLLABORATION_MESSAGE_TYPE,
      envelope(input),
      true,
      details,
    )
    this.persistedRootMessages.add(details.deliveryId)
  }

  persistAgent(record: PersistedAgentRecord): void {
    this.actorJournal.persistAgent(record)
  }

  initializeActorSession = this.actorJournal.initializeActorSession.bind(this.actorJournal)
  persistActorMessage = this.actorJournal.persistActorMessage.bind(this.actorJournal)
  persistActorRuntime = this.actorJournal.persistActorRuntime.bind(this.actorJournal)

  persistCommunication(communication: AgentCommunication): void {
    const manager = this.manager
    if (manager === undefined) return
    if (this.persistedOutbox.has(communication.deliveryId)) return
    manager.appendCustomEntry(OUTBOX_ENTRY_TYPE, communication)
    this.persistedOutbox.add(communication.deliveryId)
  }

  acknowledgeCommunication(communication: AgentCommunication): void {
    const manager = this.manager
    if (manager === undefined) return
    manager.appendCustomEntry(OUTBOX_ACK_ENTRY_TYPE, {
      deliveryId: communication.deliveryId,
    })
  }

  restoredActors(ctx: ExtensionContext): PersistedAgentRecord[] {
    return this.actorJournal.restore(writableSessionManager(ctx).getBranch())
  }

  loadAgent(path: string): PersistedAgentRecord | undefined {
    return this.manager === undefined
      ? undefined
      : this.actorJournal.restoreActor(this.manager.getBranch(), path)
  }

  restoredOutbox(ctx: ExtensionContext): AgentCommunication[] {
    const pending = new Map<string, AgentCommunication>()
    const acknowledged = new Set<string>()
    for (const entry of writableSessionManager(ctx).getBranch()) {
      const communication = persistedCommunication(entry)
      if (communication !== undefined) {
        pending.set(communication.deliveryId, communication)
        this.persistedOutbox.add(communication.deliveryId)
      }
      const deliveryId = acknowledgedOutboxId(entry)
      if (deliveryId !== undefined) acknowledged.add(deliveryId)
    }
    return [...pending.values()].filter(
      (communication) => !acknowledged.has(communication.deliveryId),
    )
  }

  inject(event: ContextEvent, ctx: ExtensionContext): ContextEvent["messages"] {
    const manager = writableSessionManager(ctx)
    const branch = manager.getBranch()
    const consumed = new Set(branch.flatMap((entry) => {
      const deliveryId = consumedDeliveryId(entry)
      return deliveryId === undefined ? [] : [deliveryId]
    }))
    const pendingById = new Map<string, RootMessageDetails>()
    for (const entry of branch) {
      const details = rootMessage(entry)
      if (details !== undefined && !consumed.has(details.deliveryId)) {
        pendingById.set(details.deliveryId, details)
      }
    }
    const pending = [...pendingById.values()]
    if (pending.length === 0) return event.messages

    const alreadyPresent = new Set(event.messages.flatMap((message) => {
      if (message.role !== "custom" || !isRecord(message.details)) return []
      return typeof message.details.deliveryId === "string"
        ? [message.details.deliveryId]
        : []
    }))

    const injected = pending
      .filter((details) => !alreadyPresent.has(details.deliveryId))
      .map((details) => ({
      role: "custom" as const,
      customType: COLLABORATION_MESSAGE_TYPE,
      content: envelope(details),
      display: true,
      details,
      timestamp: Date.now(),
      }))
    for (const details of pending) this.inFlight.add(details.deliveryId)
    return [...event.messages, ...injected]
  }

  acknowledge(event: TurnEndEvent, ctx: ExtensionContext): boolean {
    if (
      event.message.role !== "assistant"
      || (event.message.stopReason !== "stop" && event.message.stopReason !== "length")
    ) {
      this.inFlight.clear()
      return false
    }
    if (this.inFlight.size === 0) return false
    const manager = writableSessionManager(ctx)
    for (const deliveryId of this.inFlight) {
      manager.appendCustomEntry(CONSUMED_ENTRY_TYPE, { deliveryId })
    }
    this.inFlight.clear()
    return true
  }
}
