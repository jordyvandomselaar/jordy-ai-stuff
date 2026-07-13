import { describe, expect, test } from "bun:test"
import { visibleWidth } from "@earendil-works/pi-tui"
import {
  renderCollaborationCall,
  renderCollaborationResult,
} from "./tool-rendering.ts"

const theme = {
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
}

describe("collaboration tool rendering", () => {
  test("bounds call previews and renders compact, expanded, and error results", () => {
    const call = renderCollaborationCall(
      "Send Message",
      { target: "/root/child", message: "x".repeat(100) },
      theme,
    )
    expect(call.render(120).join("\n")).toContain("/root/child")
    expect(call.render(120).join("\n")).toContain("…")

    const compact = renderCollaborationResult(
      "send_message",
      [{ type: "text", text: "" }],
      { delivered: true },
      { expanded: false, isError: false, isPartial: false },
      theme,
    )
    expect(compact.render(80).map((line) => line.trimEnd())).toEqual(["✓ Message delivered"])
    const expanded = renderCollaborationResult(
      "list_agents",
      [{ type: "text", text: "Listed" }],
      { agents: ["/root/child"] },
      { expanded: true, isError: false, isPartial: false },
      theme,
    )
    expect(expanded.render(80).join("\n")).toContain("/root/child")
    const truncated = renderCollaborationResult(
      "list_agents",
      [{ type: "text", text: "Listed" }],
      { payload: "x".repeat(3_000) },
      { expanded: true, isError: false, isPartial: false },
      theme,
    )
    expect(truncated.render(80).join("\n")).toContain("[truncated]")
    const error = renderCollaborationResult(
      "followup_task",
      [{ type: "text", text: "unknown agent" }],
      {},
      { expanded: false, isError: true, isPartial: false },
      theme,
    )
    expect(error.render(80).map((line) => line.trimEnd())).toEqual(["unknown agent"])
    const boundedError = renderCollaborationResult(
      "followup_task",
      [{ type: "text", text: "x".repeat(2_000) }],
      {},
      { expanded: false, isError: true, isPartial: false },
      theme,
    )
    expect(boundedError.render(80).join("\n")).toContain("[truncated]")
  })

  test("keeps long collaboration results within the requested render width", () => {
    const result = renderCollaborationResult(
      "list_agents",
      [{ type: "text", text: JSON.stringify({ agents: [{ output: "x".repeat(3_000) }] }) }],
      undefined,
      { expanded: false, isError: false, isPartial: false },
      theme,
    )

    const lines = result.render(80)

    expect(lines.length).toBeGreaterThan(1)
    expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true)
    expect(lines.join("\n")).toContain("[truncated]")
  })
})
