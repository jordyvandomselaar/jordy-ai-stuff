import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import {
  getAgentDir,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent"

const GLOBAL_DESTINATION = "Global agent directory"
const PROJECT_DESTINATION = "Current project's .pi/agents directory"

const ROLE_TEMPLATES = {
  "default.md": `---
name: default
description: Default agent.
---
`,
  "explorer.md": `---
name: explorer
description: |-
  Use \`explorer\` for specific codebase questions.
  Explorers are fast and authoritative.
  They must be used to ask specific, well-scoped questions on the codebase.
  Rules:
  - In order to avoid redundant work, you should avoid exploring the same problem that explorers have already covered. Typically, you should trust the explorer results without additional verification. You are still allowed to inspect the code yourself to gain the needed context!
  - You are encouraged to spawn up multiple explorers in parallel when you have multiple distinct questions to ask about the codebase that can be answered independently. This allows you to get more information faster without waiting for one question to finish before asking the next. While waiting for the explorer results, you can continue working on other local tasks that do not depend on those results. This parallelism is a key advantage of delegation, so use it whenever you have multiple questions to ask.
  - Reuse existing explorers for related questions.
---
`,
  "worker.md": `---
name: worker
description: |-
  Use for execution and production work.
  Typical tasks:
  - Implement part of a feature
  - Fix tests or bugs
  - Split large refactors into independent chunks
  Rules:
  - Explicitly assign **ownership** of the task (files / responsibility). When the subtask involves code changes, you should clearly specify which files or modules the worker is responsible for. This helps avoid merge conflicts and ensures accountability. For example, you can say "Worker 1 is responsible for updating the authentication module, while Worker 2 will handle the database layer." By defining clear ownership, you can delegate more effectively and reduce coordination overhead.
  - Always tell workers they are **not alone in the codebase**, and they should not revert the edits made by others, and they should adjust their implementation to accommodate the changes made by others. This is important because there may be multiple workers making changes in parallel, and they need to be aware of each other's work to avoid conflicts and ensure a cohesive final product.
---
`,
} as const
type RoleFilename = keyof typeof ROLE_TEMPLATES

function roleFilenames(): RoleFilename[] {
  return Object.keys(ROLE_TEMPLATES).filter(
    (filename): filename is RoleFilename => Object.hasOwn(ROLE_TEMPLATES, filename),
  )
}

function errorCode(error: unknown): unknown {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined
  return error.code
}

function inspectAgentRoles(directory: string) {
  const current: RoleFilename[] = []
  const missing: RoleFilename[] = []
  const modified: RoleFilename[] = []
  mkdirSync(directory, { recursive: true })

  for (const filename of roleFilenames()) {
    const path = join(directory, filename)
    if (!existsSync(path)) {
      missing.push(filename)
    } else if (readFileSync(path, "utf8") === ROLE_TEMPLATES[filename]) {
      current.push(filename)
    } else {
      modified.push(filename)
    }
  }

  return { current, missing, modified }
}

function writeRoleFiles(
  directory: string,
  filenames: readonly RoleFilename[],
  mode: "create" | "overwrite",
): void {
  for (const filename of filenames) {
    try {
      writeFileSync(join(directory, filename), ROLE_TEMPLATES[filename], {
        encoding: "utf8",
        flag: mode === "create" ? "wx" : "w",
      })
    } catch (error) {
      if (mode !== "create" || errorCode(error) !== "EEXIST") throw error
      throw new Error(`${filename} was created by another process; run init again to inspect it`)
    }
  }
}

function scaffoldResultMessage(
  directory: string,
  created: readonly RoleFilename[],
  updated: readonly RoleFilename[],
  preserved: readonly RoleFilename[],
): string {
  const changes = [
    created.length === 0 ? undefined : `Created ${created.join(", ")}.`,
    updated.length === 0 ? undefined : `Updated ${updated.join(", ")}.`,
  ].filter((message): message is string => message !== undefined)
  const kept = preserved.length === 0 ? "" : ` Kept modified ${preserved.join(", ")}.`
  if (changes.length === 0) {
    return preserved.length === 0
      ? `Default agent roles are already current in ${directory}.`
      : `Kept modified ${preserved.join(", ")} in ${directory}; nothing changed.`
  }
  return `${changes.join(" ")} Wrote defaults in ${directory}.${kept} Run /reload to use them.`
}

export function registerAgentRoleScaffoldingCommand(
  pi: ExtensionAPI,
  globalAgentDir: string = getAgentDir(),
): void {
  pi.registerCommand("ultra-agents-init", {
    description: "Scaffold Codex's default agent role Markdown files",
    handler: async (_args, ctx) => {
      const destination = await ctx.ui.select("Scaffold default agent roles", [
        PROJECT_DESTINATION,
        GLOBAL_DESTINATION,
      ])
      if (destination === undefined) return
      if (destination === PROJECT_DESTINATION && !ctx.isProjectTrusted()) {
        ctx.ui.notify("Project role scaffolding requires a trusted project.", "warning")
        return
      }

      const directory = destination === PROJECT_DESTINATION
        ? join(ctx.cwd, ".pi", "agents")
        : join(globalAgentDir, "agents")
      try {
        const inspection = inspectAgentRoles(directory)
        writeRoleFiles(directory, inspection.missing, "create")
        const overwrite = inspection.modified.length > 0
          && await ctx.ui.confirm(
            "Replace modified default agent roles?",
            `${inspection.modified.join(", ")} differ from the current Codex defaults in ${directory}. Replace them? Other agent files are untouched.`,
          )
        const updated = overwrite ? inspection.modified : []
        const preserved = overwrite ? [] : inspection.modified
        writeRoleFiles(directory, updated, "overwrite")
        ctx.ui.notify(
          scaffoldResultMessage(directory, inspection.missing, updated, preserved),
          "info",
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.ui.notify(`Could not scaffold agent roles: ${message}`, "error")
      }
    },
  })
}
