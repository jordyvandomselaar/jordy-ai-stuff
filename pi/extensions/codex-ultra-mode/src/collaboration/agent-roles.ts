import {
  type Dirent,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs"
import { dirname, join } from "node:path"
import {
  type ExtensionAPI,
  parseFrontmatter,
} from "@earendil-works/pi-coding-agent"

type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>
type AgentRoleSource = "project" | "user"

export interface CollaborationAgentRole {
  description: string
  filePath: string
  model?: string
  name: string
  source: AgentRoleSource
  systemPrompt: string
  thinkingLevel?: ThinkingLevel
  tools?: readonly string[]
}

export interface AgentRoleDiagnostic {
  message: string
  path: string
}

export interface AgentRoleResolution {
  diagnostics: readonly AgentRoleDiagnostic[]
  roles: readonly CollaborationAgentRole[]
}

export interface AgentRoleLocations {
  agentDir: string
  cwd: string
  projectTrusted: boolean
}

interface AgentRoleFrontmatter extends Record<string, unknown> {
  description?: unknown
  model?: unknown
  name?: unknown
  thinking?: unknown
  tools?: unknown
}

const ROLE_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/
const THINKING_LEVELS = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
])
const ROLE_MARKERS = {
  close: "</agent_role>",
  open: "<agent_role>",
} as const

function parseTools(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined
  const tools = typeof value === "string"
    ? value.split(",")
    : Array.isArray(value) && value.every((tool) => typeof tool === "string")
      ? value
      : undefined
  if (tools === undefined) throw new Error("tools must be a comma-separated string or string array")
  const normalized = [...new Set(tools.map((tool) => tool.trim()).filter(Boolean))]
  return normalized.length === 0 ? undefined : Object.freeze(normalized)
}

function loadRole(
  filePath: string,
  source: AgentRoleSource,
): CollaborationAgentRole {
  const { frontmatter, body } = parseFrontmatter<AgentRoleFrontmatter>(
    readFileSync(filePath, "utf8"),
  )
  const model = frontmatter.model
  const thinking = frontmatter.thinking
  const roleModel = typeof model === "string" ? model : undefined
  const roleThinking =
    typeof thinking === "string" && THINKING_LEVELS.has(thinking as ThinkingLevel)
      ? thinking as ThinkingLevel
      : undefined
  if (typeof frontmatter.name !== "string" || !ROLE_NAME_PATTERN.test(frontmatter.name)) {
    throw new Error("name must use lowercase letters, digits, hyphens, or underscores")
  }
  if (
    typeof frontmatter.description !== "string"
    || frontmatter.description.trim().length === 0
  ) {
    throw new Error("description is required")
  }
  if (model !== undefined && roleModel === undefined) {
    throw new Error("model must be a string")
  }
  if (thinking !== undefined && roleThinking === undefined) {
    throw new Error("thinking must be off, minimal, low, medium, high, xhigh, or max")
  }
  return Object.freeze({
    description: frontmatter.description.trim(),
    filePath,
    model: roleModel,
    name: frontmatter.name,
    source,
    systemPrompt: body.trim(),
    thinkingLevel: roleThinking,
    tools: parseTools(frontmatter.tools),
  })
}

function loadRoleDirectory(
  directory: string,
  source: AgentRoleSource,
): AgentRoleResolution {
  if (!existsSync(directory)) return { diagnostics: [], roles: [] }
  const diagnostics: AgentRoleDiagnostic[] = []
  const roles = new Map<string, CollaborationAgentRole>()
  let entries: Dirent[]
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    return {
      diagnostics: [{
        message: error instanceof Error ? error.message : "failed to read agent roles",
        path: directory,
      }],
      roles: [],
    }
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.name.endsWith(".md")) continue
    const filePath = join(directory, entry.name)
    let isFile = entry.isFile()
    if (entry.isSymbolicLink()) {
      try {
        isFile = statSync(filePath).isFile()
      } catch {
        continue
      }
    }
    if (!isFile) continue
    try {
      const role = loadRole(filePath, source)
      if (roles.has(role.name)) {
        diagnostics.push({
          message: `duplicate agent role name '${role.name}' in the same scope`,
          path: filePath,
        })
        continue
      }
      roles.set(role.name, role)
    } catch (error) {
      diagnostics.push({
        message: error instanceof Error ? error.message : "failed to load agent role",
        path: filePath,
      })
    }
  }
  return { diagnostics, roles: [...roles.values()] }
}

function nearestProjectRoleDirectory(cwd: string): string | undefined {
  let directory = cwd
  while (true) {
    const candidate = join(directory, ".pi", "agents")
    if (existsSync(candidate)) return candidate
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

export function resolveAgentRoles(locations: AgentRoleLocations): AgentRoleResolution {
  const user = loadRoleDirectory(join(locations.agentDir, "agents"), "user")
  const projectDirectory = locations.projectTrusted
    ? nearestProjectRoleDirectory(locations.cwd)
    : undefined
  const project = projectDirectory === undefined
    ? { diagnostics: [], roles: [] }
    : loadRoleDirectory(projectDirectory, "project")
  const roles = new Map(user.roles.map((role) => [role.name, role]))
  for (const role of project.roles) roles.set(role.name, role)
  return {
    diagnostics: Object.freeze([...user.diagnostics, ...project.diagnostics]),
    roles: Object.freeze([...roles.values()].sort((left, right) => left.name.localeCompare(right.name))),
  }
}

export function agentRole(
  roles: readonly CollaborationAgentRole[],
  name: string,
): CollaborationAgentRole | undefined {
  return roles.find((role) => role.name === name)
}

export function formatAgentRoles(roles: readonly CollaborationAgentRole[]): string {
  if (roles.length === 0) return ""
  const formatted = roles.map((role) => {
    const settings = [
      role.model === undefined ? undefined : `model: ${role.model}`,
      role.thinkingLevel === undefined ? undefined : `thinking: ${role.thinkingLevel}`,
      role.tools === undefined ? undefined : `tools: ${role.tools.join(", ")}`,
    ].filter((setting) => setting !== undefined)
    const suffix = settings.length === 0 ? "" : `\nLocked settings: ${settings.join("; ")}`
    return `${role.name}: {\n${role.description}${suffix}\n}`
  })
  return `Available roles:\n${formatted.join("\n")}`
}

export function applyAgentRolePrompt(
  systemPrompt: string,
  role: CollaborationAgentRole,
): string {
  const pattern = new RegExp(`${ROLE_MARKERS.open}[\\s\\S]*?${ROLE_MARKERS.close}`, "g")
  const basePrompt = systemPrompt.replace(pattern, "").trimEnd()
  if (role.systemPrompt.length === 0) return basePrompt
  const prefix = basePrompt.length === 0 ? "" : `${basePrompt}\n\n`
  return `${prefix}${ROLE_MARKERS.open}\nRole: ${role.name}\n${role.systemPrompt}\n${ROLE_MARKERS.close}`
}
