import type { AgentSession, SessionEntry } from "@earendil-works/pi-coding-agent"
import type { ForkHistoryItem } from "./context-fork.ts"

import type { PiHistoryMessage } from "./pi-history-conversion.ts"
export { prepareCollaborationHistory } from "./pi-history-conversion.ts"

export const COLLABORATION_MESSAGE_TYPE = "codex-ultra-collaboration" as const

interface CollaborationMessageDetails {
  triggerTurn: boolean
}

type AppendableHistoryMessage = Exclude<
  PiHistoryMessage,
  { role: "branchSummary" | "compactionSummary" }
>

interface ForkHistorySessionManager {
  appendCompaction(summary: string, firstKeptEntryId: string, tokensBefore: number): string
  appendMessage(message: AppendableHistoryMessage): string
  branchWithSummary(branchFromId: string | null, summary: string): string
  getLeafId(): string | null
}

type AssistantHistoryMessage = Extract<
  PiHistoryMessage,
  { role: "assistant" }
>
type CustomHistoryMessage = Extract<
  PiHistoryMessage,
  { role: "custom" }
>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function collaborationDetails(value: unknown): CollaborationMessageDetails | undefined {
  if (!isRecord(value) || typeof value.triggerTurn !== "boolean") return undefined
  return { triggerTurn: value.triggerTurn }
}

function timestamp(entry: SessionEntry): number {
  const parsed = Date.parse(entry.timestamp)
  return Number.isNaN(parsed) ? 0 : parsed
}

function textPhase(signature: string | undefined): "commentary" | "final_answer" | undefined {
  if (signature === undefined || !signature.startsWith("{")) return undefined
  try {
    const parsed: unknown = JSON.parse(signature)
    if (!isRecord(parsed) || parsed.v !== 1 || typeof parsed.id !== "string") return undefined
    return parsed.phase === "commentary" || parsed.phase === "final_answer"
      ? parsed.phase
      : undefined
  } catch {
    return undefined
  }
}

function finalAssistantMessage(
  message: AssistantHistoryMessage,
): AssistantHistoryMessage | undefined {
  if (message.stopReason !== "stop" && message.stopReason !== "length") return undefined
  const content = message.content.filter(
    (block) => block.type === "text" && textPhase(block.textSignature) !== "commentary",
  )
  if (content.length === 0) return undefined
  return { ...message, content }
}

function customHistoryItem(
  customType: string,
  content: CustomHistoryMessage["content"],
  display: boolean,
  details: unknown,
  messageTimestamp: number,
): ForkHistoryItem<PiHistoryMessage>[] {
  if (customType === COLLABORATION_MESSAGE_TYPE) {
    const collaboration = collaborationDetails(details)
    return collaboration === undefined
      ? []
      : [{ kind: "inter_agent", triggerTurn: collaboration.triggerTurn }]
  }

  return [{
    kind: "message",
    message: {
      role: "custom",
      customType,
      content,
      display,
      details,
      timestamp: messageTimestamp,
    },
  }]
}

function messageItems(entry: SessionEntry): ForkHistoryItem<PiHistoryMessage>[] {
  if (entry.type !== "message") return []
  const message = entry.message
  switch (message.role) {
    case "user":
    case "compactionSummary":
    case "branchSummary":
      return [{ kind: "message", message }]
    case "assistant": {
      const finalMessage = finalAssistantMessage(message)
      return finalMessage === undefined ? [] : [{ kind: "message", message: finalMessage }]
    }
    case "custom":
      return []
    case "toolResult":
    case "bashExecution":
      return []
  }
}

function customMessageItems(entry: SessionEntry): ForkHistoryItem<PiHistoryMessage>[] {
  if (entry.type !== "custom_message") return []
  if (entry.customType !== COLLABORATION_MESSAGE_TYPE) return []
  const collaboration = collaborationDetails(entry.details)
  return collaboration === undefined
    ? []
    : [{ kind: "inter_agent", triggerTurn: collaboration.triggerTurn }]
}

function summaryItems(entry: SessionEntry): ForkHistoryItem<PiHistoryMessage>[] {
  if (entry.type === "compaction") {
    return [{
      kind: "message",
      message: {
        role: "compactionSummary",
        summary: entry.summary,
        tokensBefore: entry.tokensBefore,
        timestamp: timestamp(entry),
      },
    }]
  }
  if (entry.type === "branch_summary") {
    return [{
      kind: "message",
      message: {
        role: "branchSummary",
        summary: entry.summary,
        fromId: entry.fromId,
        timestamp: timestamp(entry),
      },
    }]
  }
  return []
}

export function forkHistoryFromPiBranch(
  entries: readonly SessionEntry[],
): ForkHistoryItem<PiHistoryMessage>[] {
  return entries.flatMap((entry) => [
    ...messageItems(entry),
    ...customMessageItems(entry),
    ...summaryItems(entry),
  ])
}

export function appendForkHistory(
  sessionManager: ForkHistorySessionManager,
  history: readonly PiHistoryMessage[],
): void {
  const compactionIndexes = history.flatMap((message, index) =>
    message.role === "compactionSummary" ? [index] : [],
  )
  if (compactionIndexes.length > 1 || compactionIndexes[0] > 0) {
    throw new Error("Forked Pi context must contain at most one leading compaction summary")
  }

  const compaction = history[0]?.role === "compactionSummary" ? history[0] : undefined
  const replay = compaction === undefined ? history : history.slice(1)
  let firstKeptEntryId: string | undefined
  for (const message of replay) {
    let entryId: string
    if (message.role === "branchSummary") {
      entryId = sessionManager.branchWithSummary(sessionManager.getLeafId(), message.summary)
    } else if (message.role === "compactionSummary") {
      throw new Error("Forked Pi context contains a non-leading compaction summary")
    } else {
      entryId = sessionManager.appendMessage(message)
    }
    firstKeptEntryId ??= entryId
  }
  if (compaction !== undefined) {
    sessionManager.appendCompaction(
      compaction.summary,
      firstKeptEntryId ?? "no-kept-fork-context",
      compaction.tokensBefore,
    )
  }
}
