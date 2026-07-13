import type {
  AgentSession,
  ExtensionContext,
  ToolInfo,
} from "@earendil-works/pi-coding-agent"
import { DEFAULT_COLLABORATION_CONFIG } from "../collaboration-config.ts"
import { CODEX_COLLABORATION_TOOLS } from "../ultra-contract.ts"
import { resolveUltraContext } from "../ultra-context.ts"
import { buildUltraSystemPrompt } from "../ultra-hooks.ts"
import type {
  PersistedPiActorState,
  PiActorRuntimeSnapshot,
  PiChildSessionRequest,
  PiRootRuntimeSelection,
} from "./pi-actor-contracts.ts"

const COLLABORATION_TOOL_NAMES = new Set<string>(CODEX_COLLABORATION_TOOLS)

export function childSystemPrompt(request: PiChildSessionRequest): string {
  const { snapshot } = request.runtime
  return buildUltraSystemPrompt(
    snapshot.systemPrompt,
    resolveUltraContext(snapshot.model, snapshot.ultraEnabled),
    "subagent",
    snapshot.collaborationConfig,
  )
}

export function activeToolInfos(
  tools: readonly string[],
  toolInfos: readonly ToolInfo[],
): ToolInfo[] {
  const active = new Set(tools)
  return toolInfos.filter((tool) => active.has(tool.name))
}

function isRecreatableTool(tool: ToolInfo): boolean {
  const path = tool.sourceInfo.path
  return COLLABORATION_TOOL_NAMES.has(tool.name)
    || path.startsWith("<builtin:")
    || !path.startsWith("<")
}

export function extensionPaths(toolInfos: readonly ToolInfo[]): string[] {
  return [...new Set(toolInfos.flatMap((tool) => {
    const path = tool.sourceInfo.path
    if (COLLABORATION_TOOL_NAMES.has(tool.name) || path.startsWith("<")) return []
    return [path]
  }))]
}

function toolMetadata(tool: ToolInfo): string {
  return JSON.stringify({
    description: tool.description,
    parameters: tool.parameters,
    promptGuidelines: tool.promptGuidelines,
    sourcePath: COLLABORATION_TOOL_NAMES.has(tool.name)
      ? "<codex-ultra-collaboration>"
      : tool.sourceInfo.path,
  })
}

export function assertInheritedToolParity(
  snapshot: PiActorRuntimeSnapshot,
  session: Pick<AgentSession, "getActiveToolNames" | "getAllTools">,
  actorPath = "child",
): void {
  const expectedNames = new Set(snapshot.tools)
  const actualNames = new Set(session.getActiveToolNames())
  const expectedInfos = new Map(snapshot.toolInfos.map((tool) => [tool.name, tool]))
  const actualInfos = new Map(session.getAllTools().map((tool) => [tool.name, tool]))
  const unavailable = snapshot.tools.filter((name) => !actualInfos.has(name))
  const unexpected = [...actualNames].filter((name) => !expectedNames.has(name))
  const changed = snapshot.tools.filter((name) => {
    const expected = expectedInfos.get(name)
    const actual = actualInfos.get(name)
    return expected !== undefined
      && actual !== undefined
      && toolMetadata(expected) !== toolMetadata(actual)
  })
  if (unavailable.length === 0 && unexpected.length === 0 && changed.length === 0) return

  const differences = [
    unavailable.length === 0 ? undefined : `unavailable: ${unavailable.join(", ")}`,
    unexpected.length === 0 ? undefined : `unexpected: ${unexpected.join(", ")}`,
    changed.length === 0 ? undefined : `different definitions: ${changed.join(", ")}`,
  ].filter((difference) => difference !== undefined).join("; ")
  throw new Error(
    `Child ${actorPath} could not recreate the parent's inherited tools (${differences}). `
    + "Pi failed to recreate an inherited built-in or discovered extension tool.",
  )
}

export function persistedActorState(value: unknown): PersistedPiActorState | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const candidate = value as Partial<PersistedPiActorState>
  if (
    candidate.version !== 5
    || !Array.isArray(candidate.messages)
  ) return undefined
  if (typeof candidate.runtime !== "object" || candidate.runtime === null) return undefined
  const runtime = candidate.runtime as Partial<PersistedPiActorState["runtime"]>
  if (
    typeof runtime.cwd !== "string"
    || !Array.isArray(runtime.extensionPaths)
    || typeof runtime.projectTrusted !== "boolean"
    || typeof runtime.systemPrompt !== "string"
    || typeof runtime.thinkingLevel !== "string"
    || typeof runtime.ultraEnabled !== "boolean"
    || typeof runtime.model !== "object"
    || runtime.model === null
    || !Array.isArray(runtime.toolInfos)
    || !Array.isArray(runtime.tools)
    || typeof runtime.collaborationConfig !== "object"
    || runtime.collaborationConfig === null
  ) {
    return undefined
  }
  return candidate as PersistedPiActorState
}

export function persistedActorRuntime(
  snapshot: PiActorRuntimeSnapshot,
): PersistedPiActorState["runtime"] {
  const {
    collaborationConfig,
    cwd,
    extensionPaths,
    model,
    projectTrusted,
    systemPrompt,
    thinkingLevel,
    toolInfos,
    tools,
    ultraEnabled,
  } = snapshot
  return {
    collaborationConfig,
    cwd,
    extensionPaths,
    model,
    projectTrusted,
    systemPrompt,
    thinkingLevel,
    toolInfos,
    tools,
    ultraEnabled,
  }
}

export function snapshotFromContext(
  ctx: ExtensionContext,
  selection: PiRootRuntimeSelection,
): PiActorRuntimeSnapshot {
  if (ctx.model === undefined) throw new Error("Ultra collaboration requires an active model")
  const activeInfos = activeToolInfos(selection.tools, selection.toolInfos ?? [])
  const toolInfos = selection.toolInfos === undefined
    ? activeInfos
    : activeInfos.filter(isRecreatableTool)
  const inheritableNames = new Set(toolInfos.map((tool) => tool.name))
  const inheritedToolNames = selection.toolInfos === undefined
    ? [...selection.tools]
    : selection.tools.filter((name) => inheritableNames.has(name))
  return Object.freeze({
    collaborationConfig: selection.collaborationConfig ?? DEFAULT_COLLABORATION_CONFIG,
    cwd: ctx.cwd,
    extensionPaths: Object.freeze(extensionPaths(toolInfos)),
    model: ctx.model,
    modelRegistry: ctx.modelRegistry,
    projectTrusted: ctx.isProjectTrusted?.() ?? true,
    systemPrompt: ctx.getSystemPrompt(),
    thinkingLevel: selection.thinkingLevel,
    toolInfos: Object.freeze(toolInfos),
    tools: Object.freeze(inheritedToolNames),
    ultraEnabled: selection.ultraEnabled,
  })
}
