import { describe, expect, test } from "bun:test"
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent"
import { DEFAULT_COLLABORATION_CONFIG } from "../collaboration-config.ts"
import type {
  CollaborationActorInput,
  CollaborationActorSession,
  CollaborationActorSpec,
} from "./actor-session.ts"
import { CollaborationCoordinator } from "./coordinator.ts"
import { collaborationToolContracts } from "./tool-contract.ts"
import type { CollaborationText } from "./tool-rendering.ts"
import { registerCollaborationTools } from "./tools.ts"

interface CapturedTool {
  name: string
  label: string
  description: string
  parameters: unknown
  renderCall?: (
    args: Record<string, unknown>,
    theme: FakeTheme,
  ) => CollaborationText
  renderResult?: (
    result: { content: Array<{ type: string; text: string }>; details: unknown },
    options: { expanded: boolean; isError: boolean; isPartial: boolean },
    theme: FakeTheme,
  ) => CollaborationText
  execute(
    toolCallId: string,
    params: Record<string, string | number | undefined>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: ExtensionContext,
  ): Promise<{ content: Array<{ text: string }>; details: unknown }>
}

class FakeSession implements CollaborationActorSession {
  deliveries: CollaborationActorInput[] = []
  deliver(input: CollaborationActorInput): void { this.deliveries.push(input) }
  dispose(): void {}
  interrupt(): void {}
  unload(): void {}
}

interface FakeTheme {
  bold(text: string): string
  fg(color: string, text: string): string
}

const theme: FakeTheme = {
  bold: (text) => text,
  fg: (_color, text) => text,
}

describe("collaboration tools", () => {
  test("registers and executes the complete pinned V2 surface", async () => {
    const specs: CollaborationActorSpec[] = []
    const root = new FakeSession()
    const child = new FakeSession()
    const coordinator = new CollaborationCoordinator(
      {
        rootActor: root,
        createActor(spec) {
          specs.push(spec)
          return child
        },
      },
      undefined,
      undefined,
      {
        ...DEFAULT_COLLABORATION_CONFIG,
        defaultWaitTimeoutMs: 50,
        minWaitTimeoutMs: 50,
      },
    )
    const tools = new Map<string, CapturedTool>()
    const pi = {
      registerTool(tool: CapturedTool) {
        tools.set(tool.name, tool)
      },
    } as ExtensionAPI
    registerCollaborationTools(pi, coordinator, "/root")

    expect([...tools.keys()].sort()).toEqual([
      "followup_task",
      "interrupt_agent",
      "list_agents",
      "send_message",
      "spawn_agent",
      "wait_agent",
    ])
    const configuredContracts = collaborationToolContracts(coordinator.config)
    for (const [name, contract] of Object.entries(configuredContracts)) {
      expect(tools.get(name)).toMatchObject(contract)
      expect(tools.get(name)?.renderCall).toBeFunction()
      expect(tools.get(name)?.renderResult).toBeFunction()
    }

    const branch: SessionEntry[] = [
      {
        type: "message",
        id: "user",
        parentId: null,
        timestamp: "2026-07-10T00:00:00.000Z",
        message: { role: "user", content: "Parent context", timestamp: 1 },
      },
    ]
    const ctx = {
      sessionManager: { buildContextEntries: () => branch },
    } as ExtensionContext
    const output = await tools.get("spawn_agent")?.execute(
      "spawn-call",
      { task_name: "research", message: "Investigate", fork_turns: "all" },
      undefined,
      undefined,
      ctx,
    )

    expect(output?.details).toEqual({ task_name: "/root/research" })
    expect(specs[0].context.history).toEqual([
      { role: "user", content: "Parent context", timestamp: 1 },
    ])

    const send = await tools.get("send_message")?.execute(
      "send-call",
      { target: "research", message: "Context" },
      undefined,
      undefined,
      ctx,
    )
    expect(send?.content).toEqual([{ type: "text", text: "" }])
    const followUp = await tools.get("followup_task")?.execute(
      "follow-call",
      { target: "research", message: "Continue" },
      undefined,
      undefined,
      ctx,
    )
    expect(followUp?.content).toEqual([{ type: "text", text: "" }])

    const listed = await tools.get("list_agents")?.execute(
      "list-call",
      {},
      undefined,
      undefined,
      ctx,
    )
    expect(listed?.details).toMatchObject({
      agents: [
        { agent_name: "/root", agent_status: "running" },
        { agent_name: "/root/research", agent_status: "running" },
      ],
    })

    const interrupted = await tools.get("interrupt_agent")?.execute(
      "interrupt-call",
      { target: "research" },
      undefined,
      undefined,
      ctx,
    )
    expect(interrupted?.details).toEqual({ previous_status: "running" })
    await coordinator.followUp("/root", "research", "Final task")
    await coordinator.complete("/root/research", "Answer")
    const waited = await tools.get("wait_agent")?.execute(
      "wait-call",
      {},
      undefined,
      undefined,
      ctx,
    )
    expect(waited?.details).toEqual({ message: "Wait completed.", timed_out: false })

    await expect(tools.get("wait_agent")?.execute(
      "invalid-wait",
      { timeout_ms: 1 },
      undefined,
      undefined,
      ctx,
    )).rejects.toThrow("timeout_ms must be at least 50")

    const sendTool = tools.get("send_message")
    expect(sendTool?.renderCall?.({ target: "research", message: "Hello" }, theme).text)
      .toContain("research")
    expect(sendTool?.renderResult?.(
      { content: [{ type: "text", text: "" }], details: {} },
      { expanded: false, isError: false, isPartial: false },
      theme,
    ).text).toBe("✓ Message delivered")
  })
})
