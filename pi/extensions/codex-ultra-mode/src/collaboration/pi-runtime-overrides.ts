import {
  type ExtensionAPI,
  type ModelRegistry,
} from "@earendil-works/pi-coding-agent"
import type { CollaborationRuntimeOverrides } from "./actor-session.ts"
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
  const thinkingLevel = reasoningEffort(overrides.reasoningEffort)
  if (overrides.model === undefined) {
    return Object.freeze({ ...snapshot, thinkingLevel: thinkingLevel ?? snapshot.thinkingLevel })
  }
  const { resolveCliModel } = await import("@earendil-works/pi-coding-agent")
  const resolution = resolveCliModel({
    cliModel: overrides.model,
    cliThinking: thinkingLevel,
    modelRegistry,
  })
  if (resolution.error !== undefined || resolution.model === undefined) {
    throw new Error(resolution.error ?? `Unknown model: ${overrides.model}`)
  }
  return Object.freeze({
    ...snapshot,
    model: resolution.model,
    thinkingLevel: resolution.thinkingLevel ?? thinkingLevel ?? snapshot.thinkingLevel,
  })
}
