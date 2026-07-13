import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export const COLLABORATION_CONFIG_FILENAME = "codex-ultra-mode.json" as const
const PROJECT_CONFIG_DIR = ".pi"

export interface CollaborationConfig {
  defaultWaitTimeoutMs: number
  hideSpawnAgentMetadata: boolean
  maxConcurrentThreadsPerSession: number
  maxWaitTimeoutMs: number
  multiAgentModeHintText?: string
  minWaitTimeoutMs: number
  rootAgentUsageHintText?: string
  spawnAgentUsageHintText?: string
  subagentUsageHintText?: string
}

export const DEFAULT_COLLABORATION_CONFIG: Readonly<CollaborationConfig> = Object.freeze({
  defaultWaitTimeoutMs: 30_000,
  hideSpawnAgentMetadata: true,
  maxConcurrentThreadsPerSession: 4,
  maxWaitTimeoutMs: 3_600_000,
  minWaitTimeoutMs: 10_000,
})

export interface CollaborationConfigDiagnostic {
  message: string
  path: string
}

export interface CollaborationConfigResolution {
  config: Readonly<CollaborationConfig>
  diagnostics: readonly CollaborationConfigDiagnostic[]
}

export interface CollaborationConfigLocations {
  agentDir: string
  cwd: string
  projectTrusted: boolean
}

type PartialCollaborationConfig = Partial<CollaborationConfig>

const CONFIG_KEYS = [
  "defaultWaitTimeoutMs",
  "hideSpawnAgentMetadata",
  "maxConcurrentThreadsPerSession",
  "maxWaitTimeoutMs",
  "minWaitTimeoutMs",
  "multiAgentModeHintText",
  "rootAgentUsageHintText",
  "spawnAgentUsageHintText",
  "subagentUsageHintText",
] as const satisfies readonly (keyof CollaborationConfig)[]
const CONFIG_KEY_SET = new Set<string>(CONFIG_KEYS)
const MAX_WAIT_TIMEOUT_MS = 3_600_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseConfigFile(path: string):
  | { config: PartialCollaborationConfig }
  | { error: string }
  | undefined {
  if (!existsSync(path)) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  if (!isRecord(parsed)) return { error: "configuration must be a JSON object" }

  const unknownKeys = Object.keys(parsed).filter((key) => !CONFIG_KEY_SET.has(key))
  if (unknownKeys.length > 0) {
    return { error: `unknown configuration fields: ${unknownKeys.join(", ")}` }
  }

  const config: PartialCollaborationConfig = {}
  for (const key of CONFIG_KEYS) {
    const value = parsed[key]
    if (value === undefined) continue
    if (key === "hideSpawnAgentMetadata") {
      if (typeof value !== "boolean") return { error: `${key} must be a boolean` }
      config[key] = value
    } else if (key.endsWith("Text")) {
      if (typeof value !== "string") return { error: `${key} must be a string` }
      config[key] = value
    } else {
      if (typeof value !== "number") return { error: `${key} must be a number` }
      config[key] = value
    }
  }
  return { config }
}

function validationError(config: CollaborationConfig): string | undefined {
  if (!Number.isSafeInteger(config.maxConcurrentThreadsPerSession)) {
    return "maxConcurrentThreadsPerSession must be a safe integer"
  }
  if (config.maxConcurrentThreadsPerSession < 1) {
    return "maxConcurrentThreadsPerSession must be at least 1"
  }

  for (const key of [
    "minWaitTimeoutMs",
    "maxWaitTimeoutMs",
    "defaultWaitTimeoutMs",
  ] as const) {
    const value = config[key]
    if (!Number.isSafeInteger(value)) return `${key} must be a safe integer`
    if (value < 0) return `${key} must be at least 0`
    if (value > MAX_WAIT_TIMEOUT_MS) return `${key} must be at most ${MAX_WAIT_TIMEOUT_MS}`
  }
  if (config.minWaitTimeoutMs > config.maxWaitTimeoutMs) {
    return "minWaitTimeoutMs must be at most maxWaitTimeoutMs"
  }
  if (config.defaultWaitTimeoutMs < config.minWaitTimeoutMs) {
    return "defaultWaitTimeoutMs must be at least minWaitTimeoutMs"
  }
  if (config.defaultWaitTimeoutMs > config.maxWaitTimeoutMs) {
    return "defaultWaitTimeoutMs must be at most maxWaitTimeoutMs"
  }
  return undefined
}

function applyConfigFile(
  base: CollaborationConfig,
  path: string,
  diagnostics: CollaborationConfigDiagnostic[],
): CollaborationConfig {
  const parsed = parseConfigFile(path)
  if (parsed === undefined) return base
  if ("error" in parsed) {
    diagnostics.push({ path, message: parsed.error })
    return base
  }

  const merged = { ...base, ...parsed.config }
  const error = validationError(merged)
  if (error !== undefined) {
    diagnostics.push({ path, message: error })
    return base
  }
  return merged
}

export function resolveCollaborationConfig(
  locations: CollaborationConfigLocations,
): CollaborationConfigResolution {
  const diagnostics: CollaborationConfigDiagnostic[] = []
  let config = applyConfigFile(
    { ...DEFAULT_COLLABORATION_CONFIG },
    join(locations.agentDir, COLLABORATION_CONFIG_FILENAME),
    diagnostics,
  )
  if (locations.projectTrusted) {
    config = applyConfigFile(
      config,
      join(locations.cwd, PROJECT_CONFIG_DIR, COLLABORATION_CONFIG_FILENAME),
      diagnostics,
    )
  }
  return {
    config: Object.freeze(config),
    diagnostics: Object.freeze(diagnostics),
  }
}
