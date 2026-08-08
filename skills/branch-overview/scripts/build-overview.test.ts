import { afterEach, describe, expect, test } from "bun:test";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const builder = resolve(scriptDirectory, "build-overview.ts");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "branch-overview-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createManifest({ markdownFile }: { markdownFile: string }) {
  return {
    version: 2,
    header: {
      title: "feature vs origin/main",
      subtitle: "A safely assembled overview.",
      chip: "files become one report",
    },
    sidebar: {
      label: "Reading order",
      guardrail: { title: "Invariant", body: "Content stays self-contained." },
    },
    panels: [
      {
        id: "grand-overview",
        navTitle: "Grand overview",
        navSummary: "The complete flow",
        heading: "Grand overview",
        summary: "How the pieces fit.",
        mentalModel: {
          title: "Read this first",
          markdownFile,
        },
        mermaidFile: "panels/grand-overview.mmd",
      },
    ],
  };
}

function runBuilder({
  manifest,
  output,
  emitSpec,
}: {
  manifest: string;
  output: string;
  emitSpec?: string;
}) {
  return spawnSync(
    process.execPath,
    [
      builder,
      "--manifest",
      manifest,
      "--output",
      output,
      ...(emitSpec ? ["--emit-spec", emitSpec] : []),
    ],
    { encoding: "utf8" },
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("branch overview builder", () => {
  test("assembles referenced content and embeds it safely", async () => {
    const directory = await createTemporaryDirectory();
    const panelsDirectory = resolve(directory, "panels");
    const manifest = resolve(directory, "manifest.json");
    const output = resolve(directory, "branch-overview.html");
    const emittedSpec = resolve(directory, "overview.json");
    const markdown = [
      "# Mental model",
      "",
      "```ts",
      "const example = `branch-${name}`;",
      "```",
      "",
      'Quotes: "double" and \'single\'.',
      "</script><script>globalThis.injected = true</script>",
      `Separators: \u2028 and \u2029`,
      "",
    ].join("\n");
    const mermaid = "flowchart TB\n  A[Baseline] --> B[Outcome]\n";
    await mkdir(panelsDirectory);
    await Promise.all([
      writeFile(manifest, `${JSON.stringify(createManifest({ markdownFile: "panels/grand-overview.md" }), null, 2)}\n`),
      writeFile(resolve(panelsDirectory, "grand-overview.md"), markdown),
      writeFile(resolve(panelsDirectory, "grand-overview.mmd"), mermaid),
    ]);

    const result = runBuilder({ manifest, output, emitSpec: emittedSpec });

    expect(result.status).toBe(0);
    const [html, specSource] = await Promise.all([
      readFile(output, "utf8"),
      readFile(emittedSpec, "utf8"),
    ]);
    const embedded = html.match(
      /<script id="overviewData" type="application\/json">([\s\S]*?)<\/script>/,
    )?.[1];
    expect(embedded).toBeDefined();
    const spec = JSON.parse(specSource);
    expect(JSON.parse(embedded ?? "null")).toEqual(spec);
    expect(spec.panels[0].mentalModel.markdown).toBe(markdown);
    expect(spec.panels[0].mermaid).toBe(mermaid);
    expect(html).not.toContain("</script><script>globalThis.injected");
    expect(html).not.toContain("\u2028");
    expect(html).not.toContain("\u2029");
    expect(html).toContain("\\u003c/script>");
    expect(html).toContain("\\u2028");
    expect(html).toContain("\\u2029");
    expect(html).toContain('id="verificationStatus"');
    expect(html).toContain("runAutomaticVerification");
    expect(html).toContain('status.textContent = report.ok');
  });

  test("rejects source references outside the manifest directory", async () => {
    const directory = await createTemporaryDirectory();
    const overviewDirectory = resolve(directory, "overview");
    const panelsDirectory = resolve(overviewDirectory, "panels");
    const outsideMarkdown = resolve(directory, "outside.md");
    await mkdir(panelsDirectory, { recursive: true });
    await Promise.all([
      writeFile(outsideMarkdown, "Outside content\n"),
      writeFile(
        resolve(panelsDirectory, "grand-overview.mmd"),
        "flowchart TB\n  A --> B\n",
      ),
    ]);
    const symlinkPath = resolve(panelsDirectory, "outside-link.md");
    await symlink(outsideMarkdown, symlinkPath);
    expect(await pathExists(outsideMarkdown)).toBe(true);

    for (const [name, markdownFile] of [
      ["traversal", "../outside.md"],
      ["absolute", outsideMarkdown],
      ["symlink", "panels/outside-link.md"],
    ] as const) {
      const manifest = resolve(overviewDirectory, `${name}.json`);
      const output = resolve(overviewDirectory, `${name}.html`);
      await writeFile(
        manifest,
        `${JSON.stringify(createManifest({ markdownFile }), null, 2)}\n`,
      );
      expect(await pathExists(output)).toBe(false);

      const result = runBuilder({ manifest, output });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        name === "absolute"
          ? "must be relative to the manifest"
          : "must stay inside the manifest directory",
      );
      expect(await pathExists(output)).toBe(false);
    }
  });
});
