import type {
  CollaborationActorFactory,
  CollaborationActorSession,
} from "./actor-session.ts"
import {
  CollaborationError,
  type CollaborationPersistence,
  type PersistedAgentRecord,
} from "./coordinator-contracts.ts"
import type { CoordinatorRegistry } from "./coordinator-registry.ts"
import { stateSession } from "./coordinator-state.ts"

interface ResidencyLifecycle {
  disposeSessionOnce(session: CollaborationActorSession): Promise<void>
  ensureRunning(): void
}

export class CoordinatorResidency {
  private readonly residents: string[] = []
  private readonly loading = new Map<string, Promise<CollaborationActorSession>>()
  private readonly evicting = new Map<string, Promise<void>>()
  private admission = Promise.resolve()

  constructor(
    private readonly actorFactory: CollaborationActorFactory,
    private readonly registry: CoordinatorRegistry,
    private readonly capacity: number,
    private readonly persistence: CollaborationPersistence | undefined,
    private readonly lifecycle: () => ResidencyLifecycle,
  ) {}

  createResident(
    path: string,
    create: () => Promise<CollaborationActorSession> | CollaborationActorSession,
  ): Promise<CollaborationActorSession> {
    return this.withAdmission(async () => {
      await this.makeRoom(path)
      const session = await create()
      try {
        this.lifecycle().ensureRunning()
      } catch (error) {
        await this.lifecycle().disposeSessionOnce(session)
        throw error
      }
      this.touch(path)
      return session
    })
  }

  async ensureLoaded(path: string): Promise<CollaborationActorSession> {
    await this.evicting.get(path)
    const record = this.registry.require(path)
    const resident = stateSession(record.state)
    if (resident !== undefined) {
      this.touch(path)
      return resident
    }

    const existing = this.loading.get(path)
    if (existing !== undefined) return existing
    const loading = this.createResident(path, async () => {
      const persisted = this.persistence?.loadAgent?.(path)
      const source = persisted ?? this.fallbackRecord(path)
      const parent = this.registry.require(source.parentPath)
      const session = await this.actorFactory.createActor({
        path: source.path,
        parentPath: source.parentPath,
        task: source.latestTask ?? source.context.initialInput.payload,
        context: source.context,
        sessionState: source.sessionState,
      }, stateSession(parent.state))
      const current = this.registry.require(path)
      if (current.state.kind !== "terminal") {
        await this.lifecycle().disposeSessionOnce(session)
        throw new CollaborationError(
          "initialization_interrupted",
          `residency load for ${path} was interrupted`,
        )
      }
      current.state.session = session
      return session
    })
    this.loading.set(path, loading)
    try {
      return await loading
    } finally {
      if (this.loading.get(path) === loading) this.loading.delete(path)
    }
  }

  touch(path: string): void {
    const index = this.residents.indexOf(path)
    if (index !== -1) this.residents.splice(index, 1)
    this.residents.push(path)
  }

  isEvicting(path: string): boolean {
    return this.evicting.has(path)
  }

  forget(path: string): void {
    const index = this.residents.indexOf(path)
    if (index !== -1) this.residents.splice(index, 1)
  }

  private async makeRoom(protectedPath: string): Promise<void> {
    while (this.residents.length >= this.capacity) {
      const candidatePath = this.residents.find((path) => {
        if (path === protectedPath) return false
        const record = this.registry.find(path)
        return record?.state.kind === "terminal"
          && record.state.session !== undefined
          && record.pending.length === 0
          && record.unreadActivity === 0
      })
      if (candidatePath === undefined) {
        throw new CollaborationError(
          "capacity_exhausted",
          `maximum of ${this.capacity} resident child agents reached`,
        )
      }
      await this.evict(candidatePath)
    }
  }

  private async evict(path: string): Promise<void> {
    const record = this.registry.require(path)
    if (record.state.kind !== "terminal" || record.state.session === undefined) return
    const session = record.state.session
    const eviction = (async () => {
      this.registry.persistOrThrow(record)
      await this.lifecycle().disposeSessionOnce(session)
      if (record.state.kind === "terminal" && record.state.session === session) {
        record.state.session = undefined
      }
      this.forget(path)
    })()
    this.evicting.set(path, eviction)
    try {
      await eviction
    } finally {
      if (this.evicting.get(path) === eviction) this.evicting.delete(path)
    }
  }

  private fallbackRecord(path: string): PersistedAgentRecord {
    const record = this.registry.require(path)
    if (record.context === null || record.parentPath === null) {
      throw new CollaborationError("invalid_operation", `${path} cannot be resumed`)
    }
    return {
      context: record.context,
      latestTask: record.latestTask,
      parentPath: record.parentPath,
      path: record.path,
      status: record.state.kind === "terminal" ? record.state.status : { kind: "interrupted" },
    }
  }

  private withAdmission<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.admission.then(operation, operation)
    this.admission = run.then(() => {}, () => {})
    return run
  }
}
