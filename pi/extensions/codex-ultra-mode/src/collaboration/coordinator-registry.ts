import type { CollaborationConfig } from "../collaboration-config.ts"
import { ROOT_AGENT_PATH } from "../ultra-contract.ts"
import {
  joinAgentPath,
  resolveAgentPath,
  validateAgentPath,
} from "./agent-path.ts"
import type { CollaborationInputSink } from "./actor-session.ts"
import {
  CollaborationError,
  type AgentSnapshot,
  type CollaborationPersistence,
} from "./coordinator-contracts.ts"
import {
  type AgentRecord,
  isActiveState,
  stateSession,
  stateStatus,
} from "./coordinator-state.ts"

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class CoordinatorRegistry {
  private readonly agents = new Map<string, AgentRecord>()
  private lastPublishedActiveAgentCount = 1

  constructor(
    rootActor: CollaborationInputSink | undefined,
    private readonly config: CollaborationConfig,
    private readonly persistence?: CollaborationPersistence,
    private readonly onActiveAgentCountChange?: (count: number) => void,
  ) {
    this.agents.set(ROOT_AGENT_PATH, {
      path: ROOT_AGENT_PATH,
      context: null,
      parentPath: null,
      latestTask: null,
      pending: [],
      unreadActivity: 0,
      state: { kind: "root", sink: rootActor },
    })
  }

  records(): IterableIterator<AgentRecord> {
    return this.agents.values()
  }

  has(path: string): boolean {
    return this.agents.has(path)
  }

  set(record: AgentRecord): void {
    this.agents.set(record.path, record)
    this.publishActiveAgentCount()
  }

  delete(path: string): void {
    this.agents.delete(path)
    this.publishActiveAgentCount()
  }

  find(path: string): AgentRecord | undefined {
    return this.agents.get(path)
  }

  require(path: string): AgentRecord {
    const record = this.agents.get(path)
    if (record === undefined) {
      throw new CollaborationError("unknown_agent", `unknown agent ${path}`)
    }
    return record
  }

  nonRoot(path: string, operation: string): AgentRecord {
    const record = this.require(this.canonicalPath(path))
    if (record.path === ROOT_AGENT_PATH) {
      throw new CollaborationError("invalid_operation", `cannot ${operation} the root agent`)
    }
    return record
  }

  canonicalPath(path: string): string {
    try {
      validateAgentPath(path)
      return path
    } catch (error) {
      throw new CollaborationError("invalid_path", messageFor(error))
    }
  }

  joinedPath(parentPath: string, taskName: string): string {
    try {
      return joinAgentPath(parentPath, taskName)
    } catch (error) {
      throw new CollaborationError("invalid_path", messageFor(error))
    }
  }

  resolvedPath(actorPath: string, target: string): string {
    try {
      return resolveAgentPath(actorPath, target)
    } catch (error) {
      throw new CollaborationError("invalid_path", messageFor(error))
    }
  }

  get activeAgentCount(): number {
    return [...this.agents.values()].filter((agent) => isActiveState(agent.state)).length
  }

  publishActiveAgentCount(): void {
    const count = this.activeAgentCount
    if (count === this.lastPublishedActiveAgentCount) return
    this.lastPublishedActiveAgentCount = count
    this.onActiveAgentCountChange?.(count)
  }

  reserveSlot(): void {
    const limit = this.config.maxConcurrentThreadsPerSession
    if (this.activeAgentCount >= limit) {
      throw new CollaborationError(
        "capacity_exhausted",
        `maximum of ${limit} active agents reached`,
      )
    }
  }

  getAgent(path: string): AgentSnapshot {
    return this.snapshot(this.require(this.canonicalPath(path)))
  }

  listAgents(pathPrefix: string = ROOT_AGENT_PATH): AgentSnapshot[] {
    const prefix = this.canonicalPath(pathPrefix)
    return [...this.agents.values()]
      .filter((agent) => agent.path === prefix || agent.path.startsWith(`${prefix}/`))
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((agent) => this.snapshot(agent))
  }

  resolveTarget(actorPath: string, target: string): AgentSnapshot {
    const actor = this.require(this.canonicalPath(actorPath))
    return this.snapshot(this.require(this.resolvedPath(actor.path, target)))
  }

  snapshot(record: AgentRecord): AgentSnapshot {
    return {
      path: record.path,
      parentPath: record.parentPath,
      status: stateStatus(record.state),
      latestTask: record.latestTask,
      mailboxSize: record.pending.length,
    }
  }

  persist(record: AgentRecord): void {
    this.publishActiveAgentCount()
    if (record.context === null || record.parentPath === null) return
    try {
      stateSession(record.state)?.checkpointPersistence?.()
      this.persistence?.persistAgent({
        path: record.path,
        parentPath: record.parentPath,
        latestTask: record.latestTask,
        status: stateStatus(record.state),
        context: record.context,
      })
    } catch {
      // A later transcript or lifecycle transition retries the latest full snapshot.
    }
  }

  persistOrThrow(record: AgentRecord): void {
    this.publishActiveAgentCount()
    if (record.context === null || record.parentPath === null) return
    stateSession(record.state)?.checkpointPersistence?.()
    this.persistence?.persistAgent({
      path: record.path,
      parentPath: record.parentPath,
      latestTask: record.latestTask,
      status: stateStatus(record.state),
      context: record.context,
    })
  }
}
