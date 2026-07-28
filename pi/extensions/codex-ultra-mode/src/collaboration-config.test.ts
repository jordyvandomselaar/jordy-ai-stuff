import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  COLLABORATION_CONFIG_FILENAME,
  DEFAULT_COLLABORATION_CONFIG,
  resolveCollaborationConfig,
} from "./collaboration-config.ts"

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value)}\n`)
}

function writeRole(path: string, frontmatter: string, body = ""): void {
  writeFileSync(path, `---\n${frontmatter}\n---\n\n${body}\n`)
}

describe("collaboration configuration", () => {
  test("merges global and trusted project configuration", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-ultra-config-"))
    const agentDir = join(root, "agent")
    const cwd = join(root, "workspace")
    mkdirSync(agentDir)
    mkdirSync(join(cwd, ".pi"), { recursive: true })
    try {
      expect(resolveCollaborationConfig({ agentDir, cwd, projectTrusted: true })).toEqual({
        config: DEFAULT_COLLABORATION_CONFIG,
        diagnostics: [],
      })

      writeJson(join(agentDir, COLLABORATION_CONFIG_FILENAME), {
        defaultWaitTimeoutMs: 500,
        defaultsOn: true,
        exposeSpawnAgentModelOverrides: false,
        maxConcurrentThreadsPerSession: 6,
        maxWaitTimeoutMs: 1_000,
        minWaitTimeoutMs: 100,
        waitAgentEnabled: false,
      })
      writeJson(join(cwd, ".pi", COLLABORATION_CONFIG_FILENAME), {
        defaultWaitTimeoutMs: 750,
        defaultsOn: false,
        exposeSpawnAgentModelOverrides: true,
        maxConcurrentThreadsPerSession: 2,
      })

      expect(resolveCollaborationConfig({ agentDir, cwd, projectTrusted: true })).toEqual({
        config: {
          agentRoles: [],
          defaultWaitTimeoutMs: 750,
          defaultsOn: false,
          exposeSpawnAgentModelOverrides: true,
          hideSpawnAgentMetadata: true,
          maxConcurrentThreadsPerSession: 2,
          maxWaitTimeoutMs: 1_000,
          minWaitTimeoutMs: 100,
          waitAgentEnabled: false,
        },
        diagnostics: [],
      })
      expect(resolveCollaborationConfig({ agentDir, cwd, projectTrusted: false })).toEqual({
        config: {
          agentRoles: [],
          defaultWaitTimeoutMs: 500,
          defaultsOn: true,
          exposeSpawnAgentModelOverrides: false,
          hideSpawnAgentMetadata: true,
          maxConcurrentThreadsPerSession: 6,
          maxWaitTimeoutMs: 1_000,
          minWaitTimeoutMs: 100,
          waitAgentEnabled: false,
        },
        diagnostics: [],
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("ignores an invalid layer without discarding the valid base", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-ultra-config-"))
    const agentDir = join(root, "agent")
    const cwd = join(root, "workspace")
    mkdirSync(agentDir)
    mkdirSync(join(cwd, ".pi"), { recursive: true })
    try {
      writeJson(join(agentDir, COLLABORATION_CONFIG_FILENAME), {
        maxConcurrentThreadsPerSession: 8,
      })
      const projectPath = join(cwd, ".pi", COLLABORATION_CONFIG_FILENAME)
      writeJson(projectPath, { minWaitTimeoutMs: 100_000, maxWaitTimeoutMs: 10_000 })

      expect(resolveCollaborationConfig({ agentDir, cwd, projectTrusted: true })).toEqual({
        config: { ...DEFAULT_COLLABORATION_CONFIG, maxConcurrentThreadsPerSession: 8 },
        diagnostics: [{
          path: projectPath,
          message: "minWaitTimeoutMs must be at most maxWaitTimeoutMs",
        }],
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("loads global roles and lets a trusted project override them", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-ultra-roles-"))
    const agentDir = join(root, "agent")
    const cwd = join(root, "workspace", "nested")
    const userRoles = join(agentDir, "agents")
    const projectRoles = join(root, "workspace", ".pi", "agents")
    mkdirSync(userRoles, { recursive: true })
    mkdirSync(projectRoles, { recursive: true })
    try {
      writeRole(
        join(userRoles, "worker.md"),
        "name: worker\ndescription: Global worker\nthinking: medium\ntools: read, write",
        "Work carefully.",
      )
      writeRole(
        join(projectRoles, "worker.md"),
        "name: worker\ndescription: Project worker\nthinking: high",
        "Own a disjoint write set.",
      )
      writeRole(
        join(projectRoles, "researcher.md"),
        "name: researcher\ndescription: Research specialist\nmodel: openai-codex/gpt-5.6-terra",
      )

      const trusted = resolveCollaborationConfig({ agentDir, cwd, projectTrusted: true })
      expect(trusted.diagnostics).toEqual([])
      expect(trusted.config.agentRoles).toMatchObject([
        {
          description: "Research specialist",
          model: "openai-codex/gpt-5.6-terra",
          name: "researcher",
          source: "project",
        },
        {
          description: "Project worker",
          name: "worker",
          source: "project",
          systemPrompt: "Own a disjoint write set.",
          thinkingLevel: "high",
        },
      ])

      const untrusted = resolveCollaborationConfig({ agentDir, cwd, projectTrusted: false })
      expect(untrusted.config.agentRoles).toMatchObject([{
        description: "Global worker",
        name: "worker",
        source: "user",
        systemPrompt: "Work carefully.",
        thinkingLevel: "medium",
        tools: ["read", "write"],
      }])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
