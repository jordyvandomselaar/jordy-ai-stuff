import type {
  CollaborationActorContext,
  CollaborationActorSession,
  CollaborationInputSink,
} from "./actor-session.ts"
import {
  CollaborationError,
  type AgentCommunication,
  type AgentStatus,
  type MailboxWaitResult,
  type TerminalAgentStatus,
} from "./coordinator-contracts.ts"

export interface TransitionGate {
  promise: Promise<void>
  resolve(): void
  reject(error: CollaborationError): void
}

export interface RunningAgentState {
  kind: "running"
  session: CollaborationActorSession
}

export type AgentState =
  | { kind: "root"; sink?: CollaborationInputSink }
  | {
      kind: "initializing"
      creation: Promise<CollaborationActorSession>
      gate: TransitionGate
    }
  | RunningAgentState
  | {
      kind: "delivering"
      session: CollaborationActorSession
      previous: RunningAgentState | TerminalAgentState
      activated: boolean
      gate: TransitionGate
    }
  | {
      kind: "completing"
      session: CollaborationActorSession
      message: string | null
      gate: TransitionGate
    }
  | {
      kind: "failing"
      session: CollaborationActorSession
      unload: Promise<void>
      gate: TransitionGate
    }
  | TerminalAgentState
  | { kind: "shutdown"; session?: CollaborationActorSession }

export interface TerminalAgentState {
  kind: "terminal"
  session?: CollaborationActorSession
  status: TerminalAgentStatus
}

export interface AgentRecord {
  context: CollaborationActorContext | null
  path: string
  parentPath: string | null
  latestTask: string | null
  pending: AgentCommunication[]
  unreadActivity: number
  state: AgentState
}

export interface MailboxWaiter {
  settle(result: MailboxWaitResult): void
}

export function transitionGate(): TransitionGate {
  let resolvePromise = () => {}
  let rejectPromise = (_error: CollaborationError) => {}
  let settled = false
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  void promise.catch(() => {})

  return {
    promise,
    resolve() {
      if (settled) return
      settled = true
      resolvePromise()
    },
    reject(error) {
      if (settled) return
      settled = true
      rejectPromise(error)
    },
  }
}

export function stateStatus(state: AgentState): AgentStatus {
  switch (state.kind) {
    case "root":
    case "running":
    case "completing":
    case "failing":
      return { kind: "running" }
    case "delivering":
      return state.previous.kind === "terminal"
        ? state.activated
          ? { kind: "pending_init" }
          : { ...state.previous.status }
        : { kind: "running" }
    case "initializing":
      return { kind: "pending_init" }
    case "terminal":
      return { ...state.status }
    case "shutdown":
      return { kind: "shutdown" }
  }
}

export function stateSession(state: AgentState): CollaborationActorSession | undefined {
  switch (state.kind) {
    case "running":
    case "delivering":
    case "completing":
    case "failing":
      return state.session
    case "terminal":
    case "shutdown":
      return state.session
    case "root":
    case "initializing":
      return undefined
  }
}

export function isActiveState(state: AgentState): boolean {
  if (
    state.kind === "delivering" &&
    state.previous.kind === "terminal" &&
    !state.activated
  ) {
    return false
  }
  return state.kind !== "terminal" && state.kind !== "shutdown"
}

export function transitionLost(operation: string, path: string): CollaborationError {
  return new CollaborationError(
    "initialization_interrupted",
    `${operation} for ${path} was interrupted`,
  )
}
