import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import {
  DEFAULT_COLLABORATION_CONFIG,
  type CollaborationConfig,
} from "./collaboration-config.ts"
import {
  codexRootAgentUsageHint,
  codexSubagentUsageHint,
  EXPLICIT_REQUEST_ONLY_MULTI_AGENT_MODE_TEXT,
  MULTI_AGENT_MODE_MARKERS,
  PROACTIVE_MULTI_AGENT_MODE_TEXT,
} from "./ultra-contract.ts"
import {
  resolveUltraContext,
  type UltraContext,
} from "./ultra-context.ts"
import { removeUltraPromptBlock } from "./ultra-prompt.ts"

export type UltraActorKind = "root" | "subagent"
const USAGE_MARKERS = {
  open: "<multi_agent_usage_hint>",
  close: "</multi_agent_usage_hint>",
} as const

export interface UltraHookOptions {
  actorKind?: UltraActorKind
  collaborationConfig?(): CollaborationConfig
  isEnabled(): boolean
}

function usageHintFor(
  actorKind: UltraActorKind,
  collaborationConfig: CollaborationConfig,
): string {
  if (actorKind === "root") {
    return collaborationConfig.rootAgentUsageHintText
      ?? codexRootAgentUsageHint(collaborationConfig)
  }
  return collaborationConfig.subagentUsageHintText
    ?? codexSubagentUsageHint(collaborationConfig)
}

function packagePromptBlock(
  context: UltraContext,
  actorKind: UltraActorKind | undefined,
  collaborationConfig: CollaborationConfig,
): string {
  const text = collaborationConfig.multiAgentModeHintText ?? (context.active
    ? PROACTIVE_MULTI_AGENT_MODE_TEXT
    : EXPLICIT_REQUEST_ONLY_MULTI_AGENT_MODE_TEXT)
  const mode = `${MULTI_AGENT_MODE_MARKERS.open}\n${text}\n${MULTI_AGENT_MODE_MARKERS.close}`
  if (actorKind === undefined) return mode
  const usage = usageHintFor(actorKind, collaborationConfig)
  return `${USAGE_MARKERS.open}\n${usage}\n${USAGE_MARKERS.close}\n\n${mode}`
}

export function buildUltraSystemPrompt(
  systemPrompt: string,
  context: UltraContext,
  collaborationActorKind?: UltraActorKind,
  collaborationConfig: CollaborationConfig = DEFAULT_COLLABORATION_CONFIG,
): string {
  const hadPackagePrompt = systemPrompt.includes(MULTI_AGENT_MODE_MARKERS.open)
  let basePrompt = hadPackagePrompt
    ? removeUltraPromptBlock(systemPrompt).trimEnd()
    : systemPrompt
  const usageStart = basePrompt.indexOf(USAGE_MARKERS.open)
  const usageEnd = basePrompt.indexOf(USAGE_MARKERS.close)
  if (usageStart !== -1 && usageEnd !== -1) {
    basePrompt = `${basePrompt.slice(0, usageStart)}${basePrompt.slice(
      usageEnd + USAGE_MARKERS.close.length,
    )}`.trimEnd()
  }
  if (!context.supported) return basePrompt

  const prefix = basePrompt ? `${basePrompt}\n\n` : ""

  return `${prefix}${packagePromptBlock(
    context,
    collaborationActorKind,
    collaborationConfig,
  )}`
}

export function registerUltraHooks(
  pi: ExtensionAPI,
  options: UltraHookOptions,
): void {
  pi.on("before_agent_start", (event, ctx) => {
    const context = resolveUltraContext(ctx.model, options.isEnabled())
    return {
      systemPrompt: buildUltraSystemPrompt(
        event.systemPrompt,
        context,
        options.actorKind,
        options.collaborationConfig?.() ?? DEFAULT_COLLABORATION_CONFIG,
      ),
    }
  })
}
