import { describe, expect, test } from "bun:test"
import {
  EXPLICIT_REQUEST_ONLY_MULTI_AGENT_MODE_TEXT,
  MULTI_AGENT_MODE_MARKERS,
  PROACTIVE_MULTI_AGENT_MODE_TEXT,
} from "./ultra-contract.ts"
import { resolveUltraContext } from "./ultra-context.ts"
import { buildUltraSystemPrompt } from "./ultra-hooks.ts"

const sol = {
  api: "openai-codex-responses",
  id: "gpt-5.6-sol",
  provider: "openai-codex",
}

describe("Ultra hooks", () => {
  test("replaces and removes policy when activation context changes", () => {
    const proactive = buildUltraSystemPrompt(
      "Base prompt",
      resolveUltraContext(sol, true),
      "root",
    )
    const explicit = buildUltraSystemPrompt(
      proactive,
      resolveUltraContext(sol, false),
      "root",
    )
    const unsupported = buildUltraSystemPrompt(
      explicit,
      resolveUltraContext(undefined, true),
      "root",
    )

    expect(proactive).toContain(PROACTIVE_MULTI_AGENT_MODE_TEXT)
    expect(proactive.match(/You are `\/root`/g)).toHaveLength(1)
    expect(explicit).toContain(EXPLICIT_REQUEST_ONLY_MULTI_AGENT_MODE_TEXT)
    expect(explicit).not.toContain(PROACTIVE_MULTI_AGENT_MODE_TEXT)
    expect(explicit.match(new RegExp(MULTI_AGENT_MODE_MARKERS.open, "g"))).toHaveLength(1)
    expect(explicit).toContain("You are `/root`")
    expect(unsupported).toBe("Base prompt")
    expect(
      buildUltraSystemPrompt(
        "Untouched\n",
        resolveUltraContext(undefined, true),
        "root",
      ),
    ).toBe("Untouched\n")
  })

  test("derives guidance independently from collaboration-tool ownership", () => {
    const active = resolveUltraContext(sol, true)
    const root = buildUltraSystemPrompt("Base prompt", active, "root")
    const subagent = buildUltraSystemPrompt(root, active, "subagent")
    const withoutTools = buildUltraSystemPrompt(subagent, active)

    expect(subagent).toContain(PROACTIVE_MULTI_AGENT_MODE_TEXT)
    expect(subagent).toContain("You are an agent in a team of agents")
    expect(subagent).not.toContain("You are `/root`")
    expect(subagent.match(/You are an agent in a team of agents/g)).toHaveLength(1)
    expect(withoutTools).not.toContain("You are an agent in a team of agents")
    expect(withoutTools).not.toContain("spawn_agent")
    expect(withoutTools.match(new RegExp(MULTI_AGENT_MODE_MARKERS.open, "g"))).toHaveLength(1)
  })

  test("renders the configured concurrency capacity", () => {
    const prompt = buildUltraSystemPrompt(
      "Base prompt",
      resolveUltraContext(sol, true),
      "root",
      {
        defaultWaitTimeoutMs: 30_000,
        maxConcurrentThreadsPerSession: 7,
        maxWaitTimeoutMs: 3_600_000,
        minWaitTimeoutMs: 10_000,
      },
    )

    expect(prompt).toContain("There are 7 available concurrency slots")
  })
})
