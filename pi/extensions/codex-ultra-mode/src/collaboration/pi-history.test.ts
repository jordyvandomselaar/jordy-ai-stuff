import { describe, expect, test } from "bun:test"
import type { SessionEntry } from "@earendil-works/pi-coding-agent"
import {
  COLLABORATION_MESSAGE_TYPE,
  forkHistoryFromPiBranch,
  prepareCollaborationHistory,
} from "./pi-history.ts"

const base = { parentId: null, timestamp: "2026-07-10T00:00:00.000Z" }
const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

describe("Pi fork history", () => {
  test("converts collaboration text and routes prompt-only context", () => {
    const nativeUser = { role: "user" as const, content: "Native question", timestamp: 123 }
    const prepared = prepareCollaborationHistory([
      nativeUser,
      { role: "user", content: "Question" },
      { role: "assistant", content: "Terminal answer" },
      { role: "developer", content: "Most recent task: Continue" },
    ], {
      api: "openai-codex-responses",
      id: "gpt-5.6-sol",
      provider: "openai-codex",
    })

    expect(prepared.promptContext).toEqual(["Most recent task: Continue"])
    expect(prepared.messages[0]).toBe(nativeUser)
    expect(prepared.messages).toMatchObject([
      nativeUser,
      { role: "user", content: "Question" },
      {
        role: "assistant",
        content: [{ type: "text", text: "Terminal answer" }],
        api: "openai-codex-responses",
        provider: "openai-codex",
        model: "gpt-5.6-sol",
        stopReason: "stop",
      },
    ])

    expect(() => prepareCollaborationHistory([
      { role: "branchSummary", timestamp: 1 },
    ], {
      api: "openai-codex-responses",
      id: "gpt-5.6-sol",
      provider: "openai-codex",
    })).toThrow("Invalid collaboration history payload for role: branchSummary")
  })

  test("rejects malformed native role payloads before replay", () => {
    const model = {
      api: "openai-codex-responses",
      id: "gpt-5.6-sol",
      provider: "openai-codex",
    }
    const malformed = [
      { role: "user", content: [{ type: "text" }], timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "text", text: "answer" }],
        api: "api",
        provider: "provider",
        model: "model",
        usage: {},
        stopReason: "invented",
        timestamp: 1,
      },
      { role: "custom", customType: "event", content: "payload", timestamp: 1 },
      { role: "branchSummary", summary: "summary", fromId: null, timestamp: 1 },
      { role: "compactionSummary", summary: "summary", tokensBefore: Infinity, timestamp: 1 },
    ]

    for (const message of malformed) {
      expect(() => prepareCollaborationHistory([message], model)).toThrow(
        `Invalid collaboration history payload for role: ${message.role}`,
      )
    }
  })

  test("preserves native context while removing execution and collaboration artifacts", () => {
    const userMessage = {
      role: "user" as const,
      content: [
        { type: "text" as const, text: "Investigate" },
        { type: "image" as const, data: "aW1hZ2U=", mimeType: "image/png" },
      ],
      timestamp: 1,
    }
    const finalMessage = {
      role: "assistant" as const,
      content: [{
        type: "text" as const,
        text: "Found context",
        textSignature: JSON.stringify({ v: 1, id: "final", phase: "final_answer" }),
      }],
      api: "openai-codex-responses" as const,
      provider: "openai-codex",
      model: "gpt-5.6-sol",
      usage,
      stopReason: "stop" as const,
      timestamp: 2,
    }
    const entries: SessionEntry[] = [
      { ...base, type: "message", id: "user", message: userMessage },
      {
        ...base,
        type: "message",
        id: "answer",
        message: {
          ...finalMessage,
          content: [
            { type: "thinking", thinking: "secret reasoning" },
            {
              type: "text",
              text: "commentary",
              textSignature: JSON.stringify({ v: 1, id: "comment", phase: "commentary" }),
            },
            ...finalMessage.content,
          ],
        },
      },
      {
        ...base,
        type: "custom_message",
        id: "followup",
        customType: COLLABORATION_MESSAGE_TYPE,
        content: "Message Type: MESSAGE\nPayload:\nCheck this",
        details: { triggerTurn: true },
        display: true,
      },
      {
        ...base,
        type: "message",
        id: "spawn",
        message: {
          ...finalMessage,
          content: [
            { type: "text", text: "scratch" },
            { type: "toolCall", id: "spawn-call", name: "spawn_agent", arguments: {} },
          ],
          stopReason: "toolUse",
          timestamp: 3,
        },
      },
      {
        ...base,
        type: "message",
        id: "result",
        message: {
          role: "toolResult",
          toolCallId: "other-call",
          toolName: "read",
          content: [{ type: "text", text: "ignored" }],
          isError: false,
          timestamp: 4,
        },
      },
      {
        ...base,
        type: "compaction",
        id: "compaction",
        summary: "Compacted context",
        firstKeptEntryId: "user",
        tokensBefore: 123,
      },
    ]

    expect(forkHistoryFromPiBranch(entries)).toEqual([
      { kind: "message", message: userMessage },
      { kind: "message", message: finalMessage },
      { kind: "inter_agent", triggerTurn: true },
      {
        kind: "message",
        message: {
          role: "compactionSummary",
          summary: "Compacted context",
          tokensBefore: 123,
          timestamp: Date.parse(base.timestamp),
        },
      },
    ])
  })
})
