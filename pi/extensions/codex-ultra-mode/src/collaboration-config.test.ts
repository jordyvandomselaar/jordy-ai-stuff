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
        maxConcurrentThreadsPerSession: 6,
        maxWaitTimeoutMs: 1_000,
        minWaitTimeoutMs: 100,
      })
      writeJson(join(cwd, ".pi", COLLABORATION_CONFIG_FILENAME), {
        defaultWaitTimeoutMs: 750,
        maxConcurrentThreadsPerSession: 2,
      })

      expect(resolveCollaborationConfig({ agentDir, cwd, projectTrusted: true })).toEqual({
        config: {
          defaultWaitTimeoutMs: 750,
          hideSpawnAgentMetadata: true,
          maxConcurrentThreadsPerSession: 2,
          maxWaitTimeoutMs: 1_000,
          minWaitTimeoutMs: 100,
        },
        diagnostics: [],
      })
      expect(resolveCollaborationConfig({ agentDir, cwd, projectTrusted: false })).toEqual({
        config: {
          defaultWaitTimeoutMs: 500,
          hideSpawnAgentMetadata: true,
          maxConcurrentThreadsPerSession: 6,
          maxWaitTimeoutMs: 1_000,
          minWaitTimeoutMs: 100,
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
})
