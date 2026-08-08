import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const SAFE_ID = /^[a-z][a-z0-9-]*$/;

interface OverviewMentalModelPoint {
  title: string;
  body: string;
}

interface OverviewMentalModelManifest {
  title: string;
  markdownFile: string;
  points?: OverviewMentalModelPoint[];
}

interface OverviewPanelManifest {
  id: string;
  navTitle: string;
  navSummary: string;
  heading: string;
  summary: string;
  mermaidFile: string;
  mentalModel?: OverviewMentalModelManifest;
}

interface OverviewManifest {
  version: 2;
  header: { title: string; subtitle: string; chip: string };
  sidebar: {
    label: string;
    guardrail: { title: string; body: string };
  };
  panels: OverviewPanelManifest[];
}

export interface OverviewSpec extends Omit<OverviewManifest, "panels"> {
  panels: Array<
    Omit<OverviewPanelManifest, "mermaidFile" | "mentalModel"> & {
      mermaid: string;
      mentalModel?: Omit<OverviewMentalModelManifest, "markdownFile"> & {
        markdown: string;
      };
    }
  >;
}

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringAt(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path}.${key} must be a non-empty string.`);
  }
  return value;
}

function parsePoints(value: unknown, path: string): OverviewMentalModelPoint[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value.map((item, index) => {
    const pointPath = `${path}[${index}]`;
    const point = recordAt(item, pointPath);
    return {
      title: stringAt(point, "title", pointPath),
      body: stringAt(point, "body", pointPath),
    };
  });
}

function parseMentalModelManifest(
  value: unknown,
  path: string,
): OverviewMentalModelManifest {
  const mentalModel = recordAt(value, path);
  if (mentalModel.markdown !== undefined) {
    throw new Error(`${path}.markdown is not supported; use ${path}.markdownFile.`);
  }
  return {
    title: stringAt(mentalModel, "title", path),
    markdownFile: stringAt(mentalModel, "markdownFile", path),
    ...(mentalModel.points === undefined
      ? {}
      : { points: parsePoints(mentalModel.points, `${path}.points`) }),
  };
}

function parsePanelManifest(value: unknown, index: number): OverviewPanelManifest {
  const path = `panels[${index}]`;
  const panel = recordAt(value, path);
  const id = stringAt(panel, "id", path);
  if (!SAFE_ID.test(id)) {
    throw new Error(`${path}.id must be a kebab-case HTML id.`);
  }
  for (const field of ["cards", "callout", "mermaid"] as const) {
    if (panel[field] === undefined) continue;
    throw new Error(
      `${path}.${field} is not supported in the manifest; use referenced source files.`,
    );
  }
  return {
    id,
    navTitle: stringAt(panel, "navTitle", path),
    navSummary: stringAt(panel, "navSummary", path),
    heading: stringAt(panel, "heading", path),
    summary: stringAt(panel, "summary", path),
    mermaidFile: stringAt(panel, "mermaidFile", path),
    ...(panel.mentalModel === undefined
      ? {}
      : {
          mentalModel: parseMentalModelManifest(
            panel.mentalModel,
            `${path}.mentalModel`,
          ),
        }),
  };
}

function parseManifest(value: unknown): OverviewManifest {
  const root = recordAt(value, "overview");
  if (root.version !== 2) throw new Error("overview.version must be 2.");
  const header = recordAt(root.header, "overview.header");
  const sidebar = recordAt(root.sidebar, "overview.sidebar");
  const guardrail = recordAt(sidebar.guardrail, "overview.sidebar.guardrail");
  if (!Array.isArray(root.panels) || root.panels.length === 0) {
    throw new Error("overview.panels must contain at least one panel.");
  }
  const panels = root.panels.map(parsePanelManifest);
  const ids = new Set<string>();
  for (const panel of panels) {
    if (ids.has(panel.id)) throw new Error(`Duplicate panel id: ${panel.id}.`);
    ids.add(panel.id);
  }
  return {
    version: 2,
    header: {
      title: stringAt(header, "title", "overview.header"),
      subtitle: stringAt(header, "subtitle", "overview.header"),
      chip: stringAt(header, "chip", "overview.header"),
    },
    sidebar: {
      label: stringAt(sidebar, "label", "overview.sidebar"),
      guardrail: {
        title: stringAt(guardrail, "title", "overview.sidebar.guardrail"),
        body: stringAt(guardrail, "body", "overview.sidebar.guardrail"),
      },
    },
    panels,
  };
}

function resolveSourcePath({
  manifestDirectory,
  source,
  fieldPath,
}: {
  manifestDirectory: string;
  source: string;
  fieldPath: string;
}): string {
  if (isAbsolute(source)) {
    throw new Error(`${fieldPath} must be relative to the manifest.`);
  }
  const resolved = resolve(manifestDirectory, source);
  const relativePath = relative(manifestDirectory, resolved);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new Error(`${fieldPath} must stay inside the manifest directory.`);
  }
  return resolved;
}

async function readSource({
  manifestDirectory,
  canonicalManifestDirectory,
  source,
  fieldPath,
}: {
  manifestDirectory: string;
  canonicalManifestDirectory: string;
  source: string;
  fieldPath: string;
}): Promise<string> {
  const sourcePath = resolveSourcePath({ manifestDirectory, source, fieldPath });
  let canonicalSourcePath: string;
  try {
    canonicalSourcePath = await realpath(sourcePath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${fieldPath} (${source}): ${message}`);
  }
  const relativePath = relative(canonicalManifestDirectory, canonicalSourcePath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${fieldPath} must stay inside the manifest directory.`);
  }
  const content = await readFile(canonicalSourcePath, "utf8");
  if (content.trim() === "") throw new Error(`${fieldPath} (${source}) must not be empty.`);
  return content;
}

export async function loadOverviewSpec({
  manifest,
}: {
  manifest: string;
}): Promise<OverviewSpec> {
  const manifestDirectory = dirname(manifest);
  const [rawManifest, canonicalManifestDirectory] = await Promise.all([
    readFile(manifest, "utf8"),
    realpath(manifestDirectory),
  ]);
  const parsed = parseManifest(JSON.parse(rawManifest) as unknown);
  const panels = await Promise.all(
    parsed.panels.map(async (panel, index) => {
      const sourceOptions = { manifestDirectory, canonicalManifestDirectory };
      const mermaid = await readSource({
        ...sourceOptions,
        source: panel.mermaidFile,
        fieldPath: `panels[${index}].mermaidFile`,
      });
      const mentalModel = panel.mentalModel
        ? {
            title: panel.mentalModel.title,
            markdown: await readSource({
              ...sourceOptions,
              source: panel.mentalModel.markdownFile,
              fieldPath: `panels[${index}].mentalModel.markdownFile`,
            }),
            ...(panel.mentalModel.points ? { points: panel.mentalModel.points } : {}),
          }
        : undefined;
      return {
        id: panel.id,
        navTitle: panel.navTitle,
        navSummary: panel.navSummary,
        heading: panel.heading,
        summary: panel.summary,
        mermaid,
        ...(mentalModel ? { mentalModel } : {}),
      };
    }),
  );
  return { ...parsed, panels };
}
