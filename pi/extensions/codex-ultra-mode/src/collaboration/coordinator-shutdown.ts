import { COLLABORATION_SHUTDOWN_TIMEOUT_MS } from "../ultra-contract.ts"
import type { CollaborationActorSession } from "./actor-session.ts"
import {
  CollaborationError,
  type CollaborationClock,
} from "./coordinator-contracts.ts"
import type { CoordinatorDelivery } from "./coordinator-delivery.ts"
import type { CoordinatorRegistry } from "./coordinator-registry.ts"
import { isActiveState, stateSession } from "./coordinator-state.ts"

export interface CoordinatorSessionLifecycle {
  ensureRunning(): void
  isDisposed(): boolean
  disposeSessionOnce(session: CollaborationActorSession): Promise<void>
}

export class CoordinatorShutdownLifecycle implements CoordinatorSessionLifecycle {
  private readonly disposedSessions = new WeakSet<CollaborationActorSession>()
  private disposed = false
  private shutdown?: Promise<void>

  constructor(
    private readonly registry: CoordinatorRegistry,
    private readonly delivery: CoordinatorDelivery,
    private readonly clock: CollaborationClock,
  ) {}

  ensureRunning(): void {
    if (this.disposed) {
      throw new CollaborationError(
        "coordinator_shutdown",
        "collaboration coordinator is shut down",
      )
    }
  }

  isDisposed(): boolean {
    return this.disposed
  }

  async disposeSessionOnce(session: CollaborationActorSession): Promise<void> {
    if (this.disposedSessions.has(session)) return
    this.disposedSessions.add(session)
    await session.dispose()
  }

  dispose(): Promise<void> {
    if (this.shutdown !== undefined) return this.shutdown
    this.disposed = true
    this.delivery.wakeShutdownWaiters()

    const rootFlush = this.delivery.flushRoot().catch(() => {})
    const disposals = [...this.registry.records()].map(async (record) => {
      const previousState = record.state
      this.registry.persist(record)
      const wasActive = isActiveState(previousState)
      const session = stateSession(previousState)
      record.state = { kind: "shutdown", session }
      const shutdown = new CollaborationError(
        "coordinator_shutdown",
        "collaboration coordinator is shut down",
      )
      if (
        previousState.kind === "initializing"
        || previousState.kind === "delivering"
        || previousState.kind === "completing"
        || previousState.kind === "failing"
      ) {
        previousState.gate.reject(shutdown)
      }

      if (previousState.kind === "initializing") {
        void previousState.creation
          .then((lateSession) => this.disposeSessionOnce(lateSession))
          .catch(() => {})
        return
      }
      if (session === undefined) return
      const cleanup = (async () => {
        try {
          if (wasActive) await session.interrupt()
          if (previousState.kind === "failing") await previousState.unload
        } finally {
          await this.disposeSessionOnce(session)
        }
      })()
      await this.awaitCleanupDeadline(cleanup, session)
    })
    this.shutdown = Promise.all([rootFlush, ...disposals]).then(() => {})
    return this.shutdown
  }

  private async awaitCleanupDeadline(
    cleanup: Promise<void>,
    session: CollaborationActorSession,
  ): Promise<void> {
    const deadline = Symbol("shutdown deadline")
    let cancelDeadline = () => {}
    const timeout = new Promise<typeof deadline>((resolve) => {
      cancelDeadline = this.clock.schedule(
        COLLABORATION_SHUTDOWN_TIMEOUT_MS,
        () => resolve(deadline),
      )
    })
    const result = await Promise.race([cleanup.then(() => undefined), timeout])
    cancelDeadline()
    if (result === deadline) await this.disposeSessionOnce(session)
  }
}
