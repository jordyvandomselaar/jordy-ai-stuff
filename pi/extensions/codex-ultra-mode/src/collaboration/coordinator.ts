import {
  DEFAULT_COLLABORATION_CONFIG,
  type CollaborationConfig,
} from "../collaboration-config.ts"
import { ROOT_AGENT_PATH } from "../ultra-contract.ts"
import type { CollaborationActorFactory } from "./actor-session.ts"
import {
  CollaborationError,
  type AgentCommunication,
  type AgentSnapshot,
  type AgentStatus,
  type CollaborationClock,
  type CollaborationPersistence,
  type MailboxWaitResult,
  type PersistedAgentRecord,
  type SpawnAgentRequest,
} from "./coordinator-contracts.ts"
import { CoordinatorDelivery } from "./coordinator-delivery.ts"
import { CoordinatorRegistry } from "./coordinator-registry.ts"
import { CoordinatorResidency } from "./coordinator-residency.ts"
import { CoordinatorShutdownLifecycle } from "./coordinator-shutdown.ts"
import { CoordinatorStartup } from "./coordinator-startup.ts"
import { CoordinatorTerminalLifecycle } from "./coordinator-terminal.ts"

export {
  CollaborationError,
  type AgentCommunication,
  type AgentSnapshot,
  type AgentStatus,
  type CollaborationClock,
  type CollaborationErrorCode,
  type CollaborationPersistence,
  type MailboxWaitResult,
  type PersistedAgentRecord,
  type SpawnAgentRequest,
} from "./coordinator-contracts.ts"

const systemClock: CollaborationClock = {
  schedule(delayMs, callback) {
    const timer = setTimeout(callback, delayMs)
    return () => clearTimeout(timer)
  },
}

export class CollaborationCoordinator {
  private readonly registry: CoordinatorRegistry
  private readonly delivery: CoordinatorDelivery
  private readonly lifecycle: CoordinatorShutdownLifecycle
  private readonly residency: CoordinatorResidency
  private readonly startup: CoordinatorStartup
  private readonly terminal: CoordinatorTerminalLifecycle
  private disposal?: Promise<void>

  constructor(
    actorFactory: CollaborationActorFactory,
    clock: CollaborationClock = systemClock,
    persistence?: CollaborationPersistence,
    readonly config: CollaborationConfig = DEFAULT_COLLABORATION_CONFIG,
    onActiveAgentCountChange?: (count: number) => void,
  ) {
    this.registry = new CoordinatorRegistry(
      actorFactory.rootActor,
      config,
      persistence,
      onActiveAgentCountChange,
    )
    this.residency = new CoordinatorResidency(
      actorFactory,
      this.registry,
      Math.max(0, config.maxConcurrentThreadsPerSession - 1),
      persistence,
      () => this.lifecycle,
    )
    this.delivery = new CoordinatorDelivery(
      this.registry,
      this.residency,
      clock,
      () => this.lifecycle.ensureRunning(),
      persistence,
    )
    this.lifecycle = new CoordinatorShutdownLifecycle(this.registry, this.delivery, clock)
    this.terminal = new CoordinatorTerminalLifecycle(
      this.registry,
      this.delivery,
      () => this.lifecycle.ensureRunning(),
    )
    this.startup = new CoordinatorStartup(
      actorFactory,
      this.registry,
      this.delivery,
      this.residency,
      this.lifecycle,
    )
  }

  async restore(
    records: readonly PersistedAgentRecord[],
    rootOutbox: readonly AgentCommunication[] = [],
  ): Promise<void> {
    await this.startup.restore(records, rootOutbox)
  }

  async flushRoot(): Promise<void> {
    await this.delivery.flushRoot()
  }

  checkpoint(path: string): void {
    const record = this.registry.find(path)
    if (record !== undefined) this.registry.persist(record)
  }

  get activeAgentCount(): number {
    return this.registry.activeAgentCount
  }

  getAgent(path: string): AgentSnapshot {
    return this.registry.getAgent(path)
  }

  listAgents(pathPrefix: string = ROOT_AGENT_PATH): AgentSnapshot[] {
    return this.registry.listAgents(pathPrefix)
  }

  resolveTarget(actorPath: string, target: string): AgentSnapshot {
    return this.registry.resolveTarget(actorPath, target)
  }

  async spawn(
    parentPath: string,
    taskName: string,
    request: SpawnAgentRequest,
  ): Promise<AgentSnapshot> {
    return this.startup.spawn(parentPath, taskName, request)
  }

  async sendMessage(
    senderPath: string,
    target: string,
    message: string,
    operationId?: string,
  ): Promise<AgentCommunication> {
    return this.delivery.sendMessage(senderPath, target, message, operationId)
  }

  async followUp(
    senderPath: string,
    target: string,
    task: string,
    operationId?: string,
  ): Promise<AgentSnapshot> {
    try {
      return await this.delivery.followUp(senderPath, target, task, operationId)
    } finally {
      this.registry.publishActiveAgentCount()
    }
  }

  async complete(
    path: string,
    message: string | null,
    operationId?: string,
  ): Promise<AgentSnapshot> {
    return this.terminal.complete(path, message, operationId)
  }

  async fail(path: string, error: string): Promise<AgentSnapshot> {
    return this.terminal.fail(path, error)
  }

  async markInterrupted(path: string): Promise<AgentSnapshot> {
    return this.terminal.markInterrupted(path)
  }

  async interrupt(senderPath: string, target: string): Promise<AgentStatus> {
    return this.terminal.interrupt(senderPath, target)
  }

  waitForMailbox(
    path: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<MailboxWaitResult> {
    return this.delivery.waitForMailbox(path, timeoutMs, signal)
  }

  acknowledgeMailboxActivity(path: string): void {
    this.delivery.acknowledgeMailboxActivity(path)
  }

  dispose(): Promise<void> {
    this.disposal ??= this.lifecycle.dispose()
      .finally(() => this.registry.publishActiveAgentCount())
    return this.disposal
  }

}
