import {
  type ExtensionAPI,
  type ModelRegistry,
} from "@earendil-works/pi-coding-agent"
import { CODEX_COLLABORATION_TOOLS } from "../ultra-contract.ts"
import type { CollaborationRuntimeOverrides } from "./actor-session.ts"
import {
  agentRole,
  applyAgentRolePrompt,
} from "./agent-roles.ts"
import type { PiActorRuntimeSnapshot } from "./pi-actor-contracts.ts"

type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>

const THINKING_LEVELS = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
])

function reasoningEffort(value: string | undefined): ThinkingLevel | undefined {
  if (value === undefined) return undefined
  if (THINKING_LEVELS.has(value as ThinkingLevel)) return value as ThinkingLevel
  throw new Error(`Unsupported reasoning effort: ${value}`)
}

export async function applyRuntimeOverrides(
  snapshot: PiActorRuntimeSnapshot,
  overrides: CollaborationRuntimeOverrides,
  modelRegistry: ModelRegistry,
): Promise<PiActorRuntimeSnapshot> {
  const role = overrides.agentType === undefined
    ? undefined
    : agentRole(snapshot.collaborationConfig.agentRoles, overrides.agentType)
  if (overrides.agentType !== undefined && role === undefined) {
    throw new Error(`Unknown agent type: ${overrides.agentType}`)
  }
  const thinkingLevel = role?.thinkingLevel ?? reasoningEffort(overrides.reasoningEffort)
  const modelReference = role?.model ?? overrides.model
  let model = snapshot.model
  if (modelReference !== undefined) {
    const normalized = modelReference.trim().toLowerCase()
    const matches = modelRegistry.getAll().filter((candidate) =>
      `${candidate.provider}/${candidate.id}`.toLowerCase() === normalized
      || candidate.id.toLowerCase() === normalized,
    )
    if (matches.length !== 1) throw new Error(`Unknown or ambiguous model: ${modelReference}`)
    model = matches[0]
  }

  let tools = snapshot.tools
  if (role?.tools !== undefined) {
    const available = new Set(snapshot.tools)
    const unavailable = role.tools.filter((tool) => !available.has(tool))
    if (unavailable.length > 0) {
      throw new Error(
        `Agent type '${role.name}' requires unavailable tools: ${unavailable.join(", ")}`,
      )
    }
    const selected = new Set(role.tools)
    for (const collaborationTool of CODEX_COLLABORATION_TOOLS) {
      selected.add(collaborationTool)
    }
    tools = Object.freeze(snapshot.tools.filter((tool) => selected.has(tool)))
  }

  return Object.freeze({
    ...snapshot,
    model,
    systemPrompt: role === undefined
      ? snapshot.systemPrompt
      : applyAgentRolePrompt(snapshot.systemPrompt, role),
    thinkingLevel: thinkingLevel ?? snapshot.thinkingLevel,
    tools,
  })
}
