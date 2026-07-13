import type { AgentSession } from "@earendil-works/pi-coding-agent"
import type { CollaborationHistoryMessage } from "./actor-session.ts"

export type PiHistoryMessage = AgentSession["messages"][number]

const assistantStopReasons = new Set([
  "stop",
  "length",
  "toolUse",
  "error",
  "aborted",
])

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isTextContent(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false
  return "type" in value
    && value.type === "text"
    && "text" in value
    && typeof value.text === "string"
}

function isImageContent(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false
  return "type" in value
    && value.type === "image"
    && "data" in value
    && typeof value.data === "string"
    && "mimeType" in value
    && typeof value.mimeType === "string"
}

function isThinkingContent(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false
  return "type" in value
    && value.type === "thinking"
    && "thinking" in value
    && typeof value.thinking === "string"
}

function isToolCallContent(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false
  return "type" in value
    && value.type === "toolCall"
    && "id" in value
    && typeof value.id === "string"
    && "name" in value
    && typeof value.name === "string"
    && "arguments" in value
    && typeof value.arguments === "object"
    && value.arguments !== null
    && !Array.isArray(value.arguments)
}

function isUsage(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false
  if (!("cost" in value) || typeof value.cost !== "object" || value.cost === null) {
    return false
  }
  return ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]
    .every((key) => key in value && isFiniteNumber(value[key as keyof typeof value]))
    && ["input", "output", "cacheRead", "cacheWrite", "total"]
      .every((key) => key in value.cost && isFiniteNumber(value.cost[key as keyof typeof value.cost]))
}

function isNativeUser(message: CollaborationHistoryMessage): boolean {
  if (typeof message.content === "string") return true
  return Array.isArray(message.content)
    && message.content.every((block) => isTextContent(block) || isImageContent(block))
}

function isNativeAssistant(message: CollaborationHistoryMessage): boolean {
  return Array.isArray(message.content)
    && message.content.every((block) => (
      isTextContent(block) || isThinkingContent(block) || isToolCallContent(block)
    ))
    && typeof message.api === "string"
    && typeof message.provider === "string"
    && typeof message.model === "string"
    && isUsage(message.usage)
    && typeof message.stopReason === "string"
    && assistantStopReasons.has(message.stopReason)
    && (message.errorMessage === undefined || typeof message.errorMessage === "string")
}

export function isNativePiHistoryMessage(
  message: CollaborationHistoryMessage,
): message is PiHistoryMessage {
  if (!isFiniteNumber(message.timestamp)) return false
  switch (message.role) {
    case "user":
      return isNativeUser(message)
    case "assistant":
      return isNativeAssistant(message)
    case "custom":
      return typeof message.customType === "string"
        && typeof message.content === "string"
        && typeof message.display === "boolean"
    case "branchSummary":
      return typeof message.summary === "string" && typeof message.fromId === "string"
    case "compactionSummary":
      return typeof message.summary === "string" && isFiniteNumber(message.tokensBefore)
    default:
      return false
  }
}
