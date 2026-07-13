import type {
  CollaborationActorContext,
  CollaborationHistoryMessage,
} from "./actor-session.ts"

export type ForkTurns =
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "last"; count: number }

export type ForkHistoryItem<Message extends CollaborationHistoryMessage = CollaborationHistoryMessage> =
  | {
      kind: "message"
      message: Message
    }
  | { kind: "inter_agent"; triggerTurn: boolean }

export interface ForkContextRequest {
  childPath: string
  parentPath: string
  task: string
  parentHistory: readonly ForkHistoryItem[]
  forkTurns?: unknown
}

const invalidForkTurnsMessage =
  "fork_turns must be `none`, `all`, or a positive integer string"

export function parseForkTurns(value: unknown): ForkTurns {
  if (value === undefined) return { kind: "all" }
  if (typeof value !== "string") throw new Error(invalidForkTurnsMessage)

  const normalized = value.trim()
  if (normalized.length === 0 || normalized.toLowerCase() === "all") return { kind: "all" }
  if (normalized.toLowerCase() === "none") return { kind: "none" }
  if (!/^\d+$/.test(normalized)) throw new Error(invalidForkTurnsMessage)

  const parsed = BigInt(normalized)
  if (parsed === 0n) throw new Error(invalidForkTurnsMessage)
  const count = parsed > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(parsed)
  return { kind: "last", count }
}

export function projectForkContext(request: ForkContextRequest): CollaborationActorContext {
  const forkTurns = parseForkTurns(request.forkTurns)
  const selected = selectHistory(request.parentHistory, forkTurns)

  return {
    history: selected.flatMap(projectHistoryItem),
    initialInput: {
      kind: "new_task",
      sender: request.parentPath,
      recipient: request.childPath,
      payload: request.task,
      triggerTurn: true,
    },
  }
}

function selectHistory(
  history: readonly ForkHistoryItem[],
  forkTurns: ForkTurns,
): readonly ForkHistoryItem[] {
  if (forkTurns.kind === "none") return []
  if (forkTurns.kind === "all") return history

  const boundaries = history.flatMap((item, index) =>
    isForkTurnBoundary(item) ? [index] : [],
  )
  if (boundaries.length === 0) return []
  const boundaryIndex = boundaries[Math.max(0, boundaries.length - forkTurns.count)]
  return history.slice(boundaryIndex)
}

function isForkTurnBoundary(item: ForkHistoryItem): boolean {
  return (
    (item.kind === "message" && item.message.role === "user") ||
    (item.kind === "inter_agent" && item.triggerTurn)
  )
}

function projectHistoryItem(item: ForkHistoryItem): CollaborationHistoryMessage[] {
  return item.kind === "message" ? [item.message] : []
}
