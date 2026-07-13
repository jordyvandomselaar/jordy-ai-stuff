import type { CollaborationHistoryMessage } from "./actor-session.ts"
import {
  isNativePiHistoryMessage,
  type PiHistoryMessage,
} from "./pi-history-validation.ts"

export type { PiHistoryMessage } from "./pi-history-validation.ts"

interface PiHistoryModel {
  api: string
  id: string
  provider: string
}

export interface PreparedCollaborationHistory {
  messages: PiHistoryMessage[]
  promptContext: string[]
}

const emptyUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

export function prepareCollaborationHistory(
  history: readonly CollaborationHistoryMessage[],
  model: PiHistoryModel,
): PreparedCollaborationHistory {
  const messages: PiHistoryMessage[] = []
  const promptContext: string[] = []
  for (const message of history) {
    if (isNativePiHistoryMessage(message)) {
      messages.push(message)
    } else if (message.role === "system" || message.role === "developer") {
      if (typeof message.content !== "string") throw invalidHistory(message.role)
      promptContext.push(message.content)
    } else if (message.timestamp === undefined && typeof message.content === "string") {
      if (message.role === "user") {
        messages.push({ role: "user", content: message.content, timestamp: Date.now() })
      } else if (message.role === "assistant") {
        messages.push({
          role: "assistant",
          content: [{ type: "text", text: message.content }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: emptyUsage,
          stopReason: "stop",
          timestamp: Date.now(),
        })
      } else {
        throw invalidHistory(message.role)
      }
    } else {
      throw invalidHistory(message.role)
    }
  }
  return { messages, promptContext }
}

function invalidHistory(role: string): Error {
  return new Error(`Invalid collaboration history payload for role: ${role}`)
}
