import { describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent"
import { registerAgentRoleScaffoldingCommand } from "./agent-role-scaffolding.ts"
import { resolveAgentRoles } from "./collaboration/agent-roles.ts"

type RegisteredCommand = Parameters<ExtensionAPI["registerCommand"]>[1]

describe("default agent-role scaffolding", () => {
  test("creates missing roles and confirms before refreshing modified defaults", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-ultra-agent-init-"))
    const globalAgentDir = join(root, "global")
    const globalRoles = join(globalAgentDir, "agents")
    const cwd = join(root, "project")
    const projectRoles = join(cwd, ".pi", "agents")
    const commands = new Map<string, RegisteredCommand>()
    const confirmations: string[] = []
    const notifications: string[] = []
    let destination = "Global"
    let allowOverwrite = false
    let projectTrusted = false
    const pi = {
      registerCommand(name: string, command: RegisteredCommand) {
        commands.set(name, command)
      },
    } as ExtensionAPI
    const ctx = {
      cwd,
      isProjectTrusted: () => projectTrusted,
      ui: {
        confirm: async (_title: string, message: string) => {
          confirmations.push(message)
          return allowOverwrite
        },
        notify: (message: string) => notifications.push(message),
        select: async (_title: string, options: string[]) =>
          options.find((option) => option.startsWith(destination)),
      },
    } as ExtensionContext

    try {
      registerAgentRoleScaffoldingCommand(pi, globalAgentDir)
      const init = commands.get("ultra-agents-init")
      expect(existsSync(globalRoles)).toBe(false)
      expect(existsSync(projectRoles)).toBe(false)

      await init?.handler("", ctx)

      expect(readdirSync(globalRoles).sort()).toEqual([
        "default.md",
        "explorer.md",
        "worker.md",
      ])
      expect(existsSync(projectRoles)).toBe(false)
      expect(confirmations).toEqual([])
      expect(resolveAgentRoles({ agentDir: globalAgentDir, cwd, projectTrusted: false })
        .roles.map((role) => role.name)).toEqual(["default", "explorer", "worker"])

      await init?.handler("", ctx)
      expect(confirmations).toEqual([])
      expect(notifications.at(-1)).toContain("already current")

      const workerPath = join(globalRoles, "worker.md")
      const customPath = join(globalRoles, "reviewer.md")
      writeFileSync(workerPath, "custom worker\n")
      writeFileSync(customPath, "custom reviewer\n")
      await init?.handler("", ctx)

      expect(confirmations).toHaveLength(1)
      expect(confirmations[0]).toContain("worker.md")
      expect(confirmations[0]).not.toContain("reviewer.md")
      expect(readFileSync(workerPath, "utf8")).toBe("custom worker\n")
      expect(readFileSync(customPath, "utf8")).toBe("custom reviewer\n")

      allowOverwrite = true
      await init?.handler("", ctx)

      expect(confirmations).toHaveLength(2)
      expect(readFileSync(workerPath, "utf8")).toContain("Use for execution and production work.")
      expect(readFileSync(customPath, "utf8")).toBe("custom reviewer\n")

      destination = "Current project"
      await init?.handler("", ctx)
      expect(existsSync(projectRoles)).toBe(false)
      expect(notifications.at(-1)).toContain("requires a trusted project")

      projectTrusted = true
      await init?.handler("", ctx)
      expect(readdirSync(projectRoles).sort()).toEqual([
        "default.md",
        "explorer.md",
        "worker.md",
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
