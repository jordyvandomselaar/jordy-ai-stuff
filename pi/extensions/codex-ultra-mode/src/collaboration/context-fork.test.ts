import { describe, expect, test } from "bun:test"
import type { AgentSession } from "@earendil-works/pi-coding-agent"
import {
  type ForkHistoryItem,
  parseForkTurns,
  projectForkContext,
} from "./context-fork.ts"

type HistoryMessage = AgentSession["messages"][number]

function user(content: string, timestamp: number): HistoryMessage {
  return { role: "user", content, timestamp }
}

function assistant(text: string, timestamp: number): HistoryMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  }
}

const history: ForkHistoryItem[] = [
  {
    kind: "message",
    message: { role: "compactionSummary", summary: "startup", tokensBefore: 10, timestamp: 0 },
  },
  { kind: "message", message: user("u1", 1) },
  { kind: "message", message: assistant("a1", 2) },
  { kind: "message", message: user("u2", 3) },
  { kind: "message", message: assistant("a2", 4) },
  {
    kind: "message",
    message: { role: "compactionSummary", summary: "Base", tokensBefore: 20, timestamp: 5 },
  },
  { kind: "inter_agent", triggerTurn: true },
  { kind: "message", message: assistant("a3", 6) },
]

function content(message: HistoryMessage): string {
  switch (message.role) {
    case "user":
      return typeof message.content === "string"
        ? message.content
        : message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n")
    case "assistant":
      return message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n")
    case "compactionSummary":
    case "branchSummary":
      return message.summary
    case "custom":
      return typeof message.content === "string" ? message.content : "custom"
    case "bashExecution":
      return message.output
    case "toolResult":
      return "tool result"
  }
}

function contents(forkTurns: unknown): string[] {
  return projectForkContext({
    childPath: "/root/child",
    parentPath: "/root",
    task: "Child task",
    parentHistory: history,
    forkTurns,
  }).history.map(content)
}

describe("fork context", () => {
  test.each([
    ["omitted defaults to all", undefined, ["startup", "u1", "a1", "u2", "a2", "Base", "a3"]],
    ["all", "all", ["startup", "u1", "a1", "u2", "a2", "Base", "a3"]],
    ["none", "none", []],
    ["last one", "1", ["a3"]],
    ["last two", "2", ["u2", "a2", "Base", "a3"]],
    ["beyond available", "99", ["u1", "a1", "u2", "a2", "Base", "a3"]],
  ] satisfies Array<[string, unknown, string[]]>)
  ("projects %s", (_name, forkTurns, expected) => {
    expect(contents(forkTurns)).toEqual(expected)
  })

  test("creates one structured new-task input", () => {
    const context = projectForkContext({
      childPath: "/root/child",
      parentPath: "/root",
      task: "Child task",
      parentHistory: [],
      forkTurns: "none",
    })

    expect(context.initialInput).toEqual({
      kind: "new_task",
      sender: "/root",
      recipient: "/root/child",
      payload: "Child task",
      triggerTurn: true,
    })
  })

  test.each(["0", "-1", "banana", 1, null])("rejects invalid fork_turns %p", (value) => {
    expect(() => parseForkTurns(value)).toThrow(
      "fork_turns must be `none`, `all`, or a positive integer string",
    )
  })
})
