import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const sourceRoot = join(packageRoot, "src")

function typescriptSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return typescriptSourceFiles(path)
    return entry.endsWith(".ts") ? [path] : []
  })
}

function moduleSpecifiers(source: string): string[] {
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]))
}

function physicalLineCount(source: string): number {
  const lines = source.split("\n").length
  return source.endsWith("\n") ? lines - 1 : lines
}

describe("codex-ultra-mode package layout", () => {
  test("declares a standalone package and keeps production imports package-local", () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>
      name?: string
      peerDependencies?: Record<string, string>
      pi?: { extensions?: string[] }
      type?: string
    }
    expect(manifest).toMatchObject({
      name: "codex-ultra-mode",
      type: "module",
      pi: { extensions: ["./src/index.ts"] },
    })
    expect(manifest.dependencies).toBeUndefined()

    const peers = Object.keys(manifest.peerDependencies ?? {})
    const productionFiles = typescriptSourceFiles(sourceRoot)
      .filter((path) => !path.endsWith(".test.ts") && !path.includes("test-support"))
    const violations: string[] = []
    for (const sourceFile of productionFiles) {
      for (const specifier of moduleSpecifiers(readFileSync(sourceFile, "utf8"))) {
        if (specifier.startsWith("node:")) continue
        if (peers.some((peer) => specifier === peer || specifier.startsWith(`${peer}/`))) continue
        if (specifier.startsWith(".")) {
          const target = resolve(dirname(sourceFile), specifier)
          const targetRelative = relative(sourceRoot, target)
          const insideSource = targetRelative !== ".."
            && !targetRelative.startsWith(`..${sep}`)
            && !isAbsolute(targetRelative)
          if (insideSource && existsSync(target)) continue
        }
        violations.push(`${relative(packageRoot, sourceFile)} -> ${specifier}`)
      }
    }
    expect(violations).toEqual([])
  })

  test("keeps every TypeScript file within the physical line budget", () => {
    const violations = typescriptSourceFiles(sourceRoot).flatMap((path) => {
      const lines = physicalLineCount(readFileSync(path, "utf8"))
      return lines > 300 ? [`${relative(sourceRoot, path)}: ${lines} lines`] : []
    })
    expect(violations).toEqual([])
  })
})
