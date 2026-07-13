import type {
  CollaborationActorContext,
  CollaborationActorInput,
} from "./actor-session.ts"
import type { ForkHistoryItem } from "./context-fork.ts"

export type CollaborationErrorCode =
  | "capacity_exhausted"
  | "coordinator_shutdown"
  | "delivery_failed"
  | "duplicate_agent"
  | "initialization_interrupted"
  | "initialization_failed"
  | "invalid_operation"
  | "invalid_fork_turns"
  | "invalid_path"
  | "unknown_agent"

export class CollaborationError extends Error {
  constructor(
    readonly code: CollaborationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "CollaborationError"
  }
}

export type AgentStatus =
  | { kind: "pending_init" }
  | { kind: "running" }
  | { kind: "interrupted" }
  | { kind: "completed"; message: string | null }
  | { kind: "errored"; message: string }
  | { kind: "shutdown" }

export type TerminalAgentStatus = Extract<
  AgentStatus,
  { kind: "completed" | "errored" | "interrupted" }
>

export interface AgentSnapshot {
  path: string
  parentPath: string | null
  status: AgentStatus
  latestTask: string | null
  mailboxSize: number
}

export interface PersistedAgentRecord {
  context: CollaborationActorContext
  latestTask: string | null
  parentPath: string
  path: string
  status: AgentStatus
  sessionState?: unknown
}

export interface AgentCommunication extends CollaborationActorInput {
  deliveryId: string
  id: number
  operationId?: string
}

export interface CollaborationPersistence {
  acknowledgeCommunication(communication: AgentCommunication): void
  loadAgent?(path: string): PersistedAgentRecord | undefined
  persistAgent(record: PersistedAgentRecord): void
  persistCommunication(communication: AgentCommunication): void
}

export interface CollaborationClock {
  schedule(delayMs: number, callback: () => void): () => void
}

export interface SpawnAgentRequest {
  task: string
  parentHistory: readonly ForkHistoryItem[]
  forkTurns?: unknown
  model?: string
  reasoningEffort?: string
}

export type MailboxWaitResult =
  | { kind: "activity" }
  | { kind: "aborted" }
  | { kind: "shutdown" }
  | { kind: "timeout" }

export function nonEmptyMessage(message: string): string {
  if (message.trim().length === 0) {
    throw new CollaborationError("invalid_operation", "empty messages cannot be sent")
  }
  return message
}

export function messageForError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
