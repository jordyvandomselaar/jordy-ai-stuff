import type { AgentSessionEvent, ExtensionContext } from "@earendil-works/pi-coding-agent"
import type {
  CollaborationActorFactory,
  CollaborationActorInput,
  CollaborationActorSession,
  CollaborationActorSpec,
  CollaborationInputSink,
} from "./actor-session.ts"
import type { CollaborationCoordinator } from "./coordinator.ts"
import {
  type PersistedPiActorState,
  type PiActorPersistence,
  type PiActorRuntimeSnapshot,
  type PiActorRuntimeStore,
  type PiChildSessionCreator,
  type PiChildSessionRequest,
  type PiRootRuntimeSelection,
  type PiSession,
} from "./pi-actor-contracts.ts"
import { createProductionChildSession } from "./pi-child-session.ts"
import { applyRuntimeOverrides } from "./pi-runtime-overrides.ts"
import { COLLABORATION_MESSAGE_TYPE } from "./pi-history.ts"
import {
  childSystemPrompt,
  persistedActorState,
  persistedActorRuntime,
  snapshotFromContext,
} from "./pi-runtime.ts"

export type {
  PiActorPersistence,
  PiActorRuntimeSnapshot,
  PiActorRuntimeStore,
  PiChildSessionCreator,
  PiChildSessionRequest,
  PiSession,
} from "./pi-actor-contracts.ts"
export {
  bindChildSessionExtensions,
  PI_CHILD_SESSION_POLICY,
} from "./pi-child-session.ts"
export { appendForkHistory } from "./pi-history.ts"
export {
  assertInheritedToolParity,
  childSystemPrompt,
} from "./pi-runtime.ts"

function envelope(input: CollaborationActorInput): string {
  return `Message Type: ${input.kind.toUpperCase()}\nTask name: ${input.recipient}\nSender: ${input.sender}\nPayload:\n${input.payload}`
}

function terminalAssistant(session: PiSession, fromIndex: number) {
  for (const message of session.messages.slice(fromIndex).toReversed()) {
    if (message.role !== "assistant") continue
    return message
  }
  return undefined
}

function assistantText(message: ReturnType<typeof terminalAssistant>): string | null {
  if (message === undefined) return null
  const text = message.content
    .flatMap((block) => block.type === "text" ? [block.text] : [])
    .join("\n")
    .trim()
  return text.length > 0 ? text : null
}

function acceptedInput(event: AgentSessionEvent, input: CollaborationActorInput): boolean {
  if (event.type !== "message_end" || event.message.role !== "custom") return false
  if (event.message.customType !== COLLABORATION_MESSAGE_TYPE) return false
  const details = event.message.details
  if (details === input) return true
  if (typeof details !== "object" || details === null) return false
  const candidate = details as Partial<CollaborationActorInput>
  return candidate.kind === input.kind
    && candidate.sender === input.sender
    && candidate.recipient === input.recipient
    && candidate.payload === input.payload
    && candidate.triggerTurn === input.triggerTurn
}

export class PiActorSession implements CollaborationActorSession {
  private settlementGeneration = 0
  private nextMessageSequence: number
  private readonly pendingMessages = new Map<number, PiSession["messages"][number]>()
  private readonly unsubscribePersistence: () => void

  constructor(
    private readonly session: PiSession,
    private readonly path: string,
    private readonly coordinator: CollaborationCoordinator,
    private readonly currentRuntimeSnapshot: () => PiActorRuntimeSnapshot,
    private readonly persistence?: PiActorPersistence,
  ) {
    this.nextMessageSequence = session.messages.length
    this.unsubscribePersistence = session.subscribe((event) => {
      if (event.type !== "message_end") return
      this.pendingMessages.set(this.nextMessageSequence++, event.message)
      try {
        this.checkpointPersistence()
        this.coordinator.checkpoint(this.path)
      } catch {
        // A later message or lifecycle transition retries the pending entries.
      }
    })
  }

  get runtimeSnapshot(): PiActorRuntimeSnapshot {
    return this.currentRuntimeSnapshot()
  }

  async deliver(input: CollaborationActorInput): Promise<void> {
    const fromIndex = this.session.messages.length
    const message = {
      customType: COLLABORATION_MESSAGE_TYPE,
      content: envelope(input),
      display: false,
      details: input,
    }
    if (!input.triggerTurn) {
      await this.session.sendCustomMessage(message, {
        deliverAs: this.session.isStreaming ? "steer" : undefined,
      })
      return
    }

    if (this.session.isStreaming) {
      const queued = this.session.sendCustomMessage(message, {
        deliverAs: "steer",
        triggerTurn: true,
      })
      await queued
      this.trackSettlement(queued, fromIndex)
      return
    }

    let resolveAcceptance = () => {}
    let rejectAcceptance = (_error: Error) => {}
    const acceptance = new Promise<void>((resolve, reject) => {
      resolveAcceptance = resolve
      rejectAcceptance = reject
    })
    const unsubscribe = this.session.subscribe((event) => {
      if (!acceptedInput(event, input)) return
      unsubscribe()
      resolveAcceptance()
    })
    const run = this.session.sendCustomMessage(message, { triggerTurn: true })
    void run.catch((error: unknown) => {
      unsubscribe()
      rejectAcceptance(error instanceof Error ? error : new Error(String(error)))
    })
    await acceptance
    this.trackSettlement(run, fromIndex)
  }

  async interrupt(): Promise<void> {
    await this.session.abort()
  }

  async unload(): Promise<void> {
    if (this.session.isStreaming) await this.session.abort()
  }

  checkpointPersistence(): void {
    this.persistence?.persistActorRuntime(
      this.path,
      persistedActorRuntime(this.runtimeSnapshot),
    )
    for (const [sequence, message] of this.pendingMessages) {
      this.persistence?.persistActorMessage(this.path, sequence, message)
      this.pendingMessages.delete(sequence)
    }
  }

  async dispose(): Promise<void> {
    try {
      this.checkpointPersistence()
    } catch {
      // Session shutdown must continue even when the root session was replaced.
    }
    this.unsubscribePersistence()
    if (this.session.shutdownExtensions === undefined) {
      this.session.dispose()
    } else {
      await this.session.shutdownExtensions()
    }
  }

  private trackSettlement(accepted: Promise<void>, fromIndex: number): void {
    const generation = ++this.settlementGeneration
    void this.settle(accepted, fromIndex, generation).catch(() => {})
  }

  private async settle(
    accepted: Promise<void>,
    fromIndex: number,
    generation: number,
  ): Promise<void> {
    let terminal: ReturnType<typeof terminalAssistant>
    try {
      await accepted
      await this.session.waitForIdle()
      if (this.session.pendingMessageCount > 0) await this.session.waitForIdle()
      if (generation !== this.settlementGeneration) return
      terminal = terminalAssistant(this.session, fromIndex)
    } catch (error) {
      if (generation !== this.settlementGeneration) return
      const message = error instanceof Error ? error.message : String(error)
      await this.coordinator.fail(this.path, message)
      return
    }

    if (terminal?.stopReason === "aborted") {
      await this.coordinator.markInterrupted(this.path)
    } else if (terminal?.stopReason === "error") {
      await this.coordinator.fail(
        this.path,
        terminal.errorMessage ?? `Child turn ${terminal.stopReason}`,
      )
    } else {
      await this.coordinator.complete(this.path, assistantText(terminal))
    }
  }
}

export class PiActorFactory implements CollaborationActorFactory {
  readonly rootActor: CollaborationInputSink
  private rootSnapshot?: PiActorRuntimeSnapshot

  constructor(
    rootActor: CollaborationInputSink,
    private readonly coordinator: () => CollaborationCoordinator,
    private readonly createChildSession: PiChildSessionCreator = createProductionChildSession,
    private readonly persistence?: PiActorPersistence,
  ) {
    this.rootActor = rootActor
  }

  bindRoot(ctx: ExtensionContext, selection: PiRootRuntimeSelection): void {
    this.rootSnapshot = snapshotFromContext(ctx, selection)
  }

  async createActor(
    spec: CollaborationActorSpec,
    parentSession?: CollaborationActorSession,
  ): Promise<CollaborationActorSession> {
    const inheritedSnapshot = parentSession instanceof PiActorSession
      ? parentSession.runtimeSnapshot
      : this.rootSnapshot
    if (inheritedSnapshot === undefined) {
      throw new Error("Ultra collaboration runtime is not initialized for this session")
    }
    const restored = persistedActorState(spec.sessionState)
    let snapshot: PiActorRuntimeSnapshot = restored === undefined
      ? inheritedSnapshot
      : Object.freeze({ ...restored.runtime, modelRegistry: inheritedSnapshot.modelRegistry })
    if (restored === undefined && spec.runtimeOverrides !== undefined) {
      snapshot = await applyRuntimeOverrides(snapshot, spec.runtimeOverrides, snapshot.modelRegistry)
    }
    let persistenceReady = false
    const runtime: PiActorRuntimeStore = {
      get snapshot() { return snapshot },
      update: (updated) => {
        snapshot = updated
        if (persistenceReady) {
          try {
            this.persistence?.persistActorRuntime(spec.path, persistedActorRuntime(updated))
          } catch {
            // The actor session retries its current runtime at the next checkpoint.
          }
        }
      },
    }
    const coordinator = this.coordinator()
    const request: PiChildSessionRequest = { coordinator, runtime, spec }
    if (restored === undefined) {
      runtime.update(Object.freeze({
        ...runtime.snapshot,
        systemPrompt: childSystemPrompt(request),
      }))
    }
    const session = await this.createChildSession(request)
    if (restored === undefined) {
      this.persistence?.initializeActorSession(spec.path, {
        version: 5,
        messages: [...session.messages],
        runtime: persistedActorRuntime(runtime.snapshot),
      })
    }
    persistenceReady = true
    return new PiActorSession(session, spec.path, coordinator, () => runtime.snapshot, this.persistence)
  }
}
