---
name: branch-overview
description: >
  Use when the user wants a visual overview, mental model, architecture map, or
  walkthrough of everything changed on the current git branch compared with
  origin/main (or another remote base). Trigger on requests like "show me this
  branch", "branch overview", "visualize the diff", "what does this MR do?",
  "help me understand these changes", or "diagram the current branch". Groups
  the diff into behavioral themes, builds a manifest-driven Mermaid UI,
  self-verifies every panel, and opens the generated report in the default browser.
metadata:
  author: jordy
  version: "2.6.0"
---

# Branch Overview

Turn a large branch diff into a visual mental model rather than a file inventory. Compare
it with a remote base, then generate a report from a manifest plus Markdown and Mermaid.

## Quick Start

1. Establish the comparison base, defaulting to `origin/main`.
2. Gather commits, changed files, diff statistics, working-tree state, and ticket context.
3. Read the important diffs and group them by user-visible behavior or system role.
4. Copy `assets/overview.example/`; edit its manifest and `.md`/`.mmd` panel sources.
5. Run `scripts/build-overview.ts` to assemble, validate, and generate the HTML.
6. Open the generated HTML in the default browser with `open` on macOS or the platform's
   equivalent URL opener.
7. Confirm the report displays its built-in `Verified` status. If it reports a failure,
   use the named panels and visible render error to fix the authored sources and rebuild.

Read `references/overview-data.md` for the manifest contract and browser handoff.

## When This Skill Applies

Use it for:

- understanding a feature branch or merge request before review;
- explaining a large refactor as a system rather than a list of files;
- showing old-versus-new behavior, ownership, modes, and exceptions;
- onboarding someone to an in-progress branch;
- visualizing how multiple commits combine into one feature.

Do not use it for:

- a line-by-line code review or correctness verdict;
- a single-file diff that needs only a prose summary;
- generic architecture unrelated to the current branch;
- committing, pushing, or changing the branch unless separately requested.

## Hard Rules

- **Compare against a remote base.** Default to `origin/main`; honor another explicit
  base when supplied. Never silently compare against local `main`.
- **Include current working-tree state.** Distinguish committed branch changes from
  staged, unstaged, and untracked follow-up work.
- **Resolve tickets without blocking.** Try Linear first, then Jira. If neither returns
  context, mark it unavailable and continue; never invent ticket facts.
- **Lead with the reader's problem and public contract.** Group the diff by behavior,
  state the previous limitation, and show the smallest real usage for public API changes
  before explaining collector, rank, graph, or runtime internals.
- **Explain every concept, do not only diagram it.** A diagram compresses structure; the
  `.md` file referenced by `mentalModel.markdownFile` explains what it means, why the
  branch needs it, and which invariant the reader should retain. Write Markdown source,
  not paragraph arrays or embedded HTML.
- **Match the representation to the question.** Use a matrix for API choices, scenarios
  for a finite contract, and a numbered causal chain for order-dependent findings. Use
  mirrored Expected/Actual only when both executions are independently complex.
- **Explain findings with the smallest causal proof.** Preserve executable actor names;
  show causal order when relevant, the winner, stale survivor, and exact consequence.
  Put the expected invariant or final graph in the mental-model prose by default.
- **Make panel order the reading order.** Arrange `panels` in the intended top-to-bottom
  sequence and let the sidebar communicate that sequence. Do not add a detached “how to
  read this report” explanation.
- **Keep supporting facts in the mental model.** Do not add detached summary cards below
  a panel or a separate callout below it. Put outcomes, ownership, scope, validation,
  exceptions, and working-tree facts into the referenced Markdown file or
  `mentalModel.points`, where the explanation gives them context.
- **Keep authored content out of command strings.** Never use inline JavaScript, shell
  interpolation, base64, `TextEncoder`, or `btoa`; let the builder read `.md`/`.mmd`.
- **Edit only authored sources.** Never hand-edit generated HTML or debug JSON.
  Navigation and panels come from the manifest's `panels` array.
- **Open the generated file directly.** Use the operating system's default-browser
  opener; do not use Playwright MCP, Chrome DevTools MCP, or Computer Use.
- **Trust but surface runtime verification.** The generated page activates and checks
  every panel once, restores the grand overview, and shows `Verified` or a failure count
  in the header. Fix failures in authored sources and rebuild; never patch generated HTML.
- **Preserve the layout contract.** CSS Grid owns geometry, Mermaid keeps intrinsic
  `14px` sizing, the mental model and diagram fill equal usable height, and `main` plus
  each diagram retain their separate scroll regions. See `references/overview-data.md`.
- **Verify once after the spec is final.** The built-in verifier replaces per-panel
  clicking and reports only panels that fail rendering, containment, or reachability.

## First 60 Seconds

From the repository being explained:

```bash
BASE="${BASE:-origin/main}"
git show-ref --verify --quiet "refs/remotes/$BASE"
git rev-parse --verify "${BASE}^{commit}"
git show -s --format='%ci %H' "$BASE"
MERGE_BASE="$(git merge-base "$BASE" HEAD)"
git status --short --branch
git log --oneline --decorate "$BASE"..HEAD
git diff --stat "$MERGE_BASE" HEAD
git diff --name-status "$MERGE_BASE" HEAD
git diff --cached --stat HEAD
git diff --stat
git ls-files --others --exclude-standard
```

Interpret these separately:

- merge base → `HEAD` — committed branch delta without upstream-only changes;
- `git diff --cached HEAD` — staged overlay relative to the branch tip;
- `git diff` — unstaged tracked overlay;
- `git ls-files --others --exclude-standard` — untracked overlay. Inspect relevant
  untracked source or documentation before diagramming it.

If `origin/main` is unavailable, stop and ask for the intended remote base. Do not guess
from another local branch. Report the remote-tracking ref's commit and timestamp. Fetch
only when the user asks for a fresh remote update.

## Build the Branch Fact Sheet

Before creating diagrams, capture:

```markdown
- Branch/base:
- Goal inferred from commits, ticket, and changed behavior:
- User-visible contract before/after:
- Main execution pipeline:
- Change themes:
- New ownership boundaries:
- Modes and decisions:
- Explicit exceptions / compatibility paths:
- Tests and validation changed:
- Uncommitted overlay:
- Open questions or review findings:
- Finding proof, when relevant: invariant, named actors, causal order, winner, stale state, consequence, and committed/staged/unstaged provenance:
```

Read the highest-leverage files for each theme. Avoid narrating every test or mechanical
routing edit when one concept explains them all.

## Default Panel Model

Use four panels unless the branch strongly suggests another shape:

1. **Grand overview** — previous limitation → concrete new usage → ownership and outcome.
2. **Main behavioral flow** — the runtime or user journey introduced by the diff.
3. **Modes and ownership** — a caller-facing decision guide plus concrete outcome
   scenarios; explain internal ranking only after the public behavior is clear.
4. **Exceptions and proof** — compatibility, tests, validation, and uncommitted work.

For public APIs, map these to problem/snippet → choice matrix → scenarios → caveat. Do
not force that route on branches without user-facing choices.

Rename or merge panels when that makes the mental model clearer. One panel answers one
question. Give every conceptual panel a focused `mentalModel`; its prose should explain
the diagram rather than transcribe it.

When the user asks about a particular bug or a verified review finding, replace a broad
panel or add a **Finding spotlight** immediately after the panel that introduces the
affected behavior. One finding gets one panel. Title it as the reader's concrete question
(`Why does fallbackHelper survive?`), not an implementation category (`Winner
resolution`). Keep general resolution modes in a different panel. State whether the proof
and fix are committed, staged, unstaged, or absent directly in that panel.

## Generate the UI

Resolve `SKILL_ROOT` as the directory containing this `SKILL.md`, then create the
branch-specific data and generated output in a collision-safe temporary directory:

```bash
SKILL_ROOT="/absolute/path/to/branch-overview"
BRANCH_SLUG="$(git branch --show-current | tr '/ ' '--')"
OVERVIEW_DIR="$(mktemp -d "/tmp/${BRANCH_SLUG}-overview.XXXXXX")"
cp -R "$SKILL_ROOT/assets/overview.example/." "$OVERVIEW_DIR/"
# Edit manifest.json and replace the panel .md/.mmd sources.
node "$SKILL_ROOT/scripts/build-overview.ts" \
  --manifest "$OVERVIEW_DIR/manifest.json" \
  --output "$OVERVIEW_DIR/branch-overview.html"
```

The builder validates and embeds sources relative to the manifest. Fix the named field
or source when it fails; never patch generated HTML.

### Turn the diff into flows

- Use a horizontal subgraph for the stable pipeline and fan changed behavior vertically.
- Use decision diamonds for modes, flags, strategies, or compatibility branches.
- Show external/protocol owners separately from ordinary shared paths.
- Put file paths in quiet supporting text only when they help future navigation.
- Color semantically: blue orchestration, neutral domain, green success/data, orange
  diagnostics, purple protocols or special ownership.
- Make clear what is new, reused, intentionally excluded, and still uncommitted.

## Default-Browser Handoff

Open the generated file only after the builder succeeds:

```bash
case "$(uname -s)" in
  Darwin) open "$OVERVIEW_DIR/branch-overview.html" ;;
  Linux) xdg-open "$OVERVIEW_DIR/branch-overview.html" ;;
  *) echo "Open this file in your browser: $OVERVIEW_DIR/branch-overview.html" ;;
esac
```

The page's built-in verifier serially activates every panel and checks render success,
SVG and mental-model existence, two-axis diagram scrolling, reachable diagram and main
bounds, and viewport containment. It restores the first panel at the top-left scroll
position and reports the result in the header. A failure count means the overview needs
another authoring/build pass; hover the status for the failed panel IDs.

## Verification Checklist

- [ ] Comparison base is remote and explicit.
- [ ] Committed delta and working-tree overlay are distinguished.
- [ ] Every major change theme appears exactly once.
- [ ] Public API branches start with the user's limitation, a real usage example,
  ownership rule, ticket intent when available, and outcome.
- [ ] Sidebar panels run top-to-bottom in the intended reading order without a redundant
  navigation callout.
- [ ] Outcomes, ownership, scope, validation, and working-tree facts live in the mental
  model rather than detached summary cards or callouts.
- [ ] Every conceptual panel pairs its diagram with a meaningful mental model.
- [ ] Explanations describe behavior and reasoning rather than listing files or restating nodes.
- [ ] The manifest builder completed without validation or source-file errors.
- [ ] The generated page displays `Verified`; otherwise the named failed panels are fixed and rebuilt.
- [ ] Mermaid uses `14px` labels and intrinsic SVG sizing; both scroll axes can reach the
  complete diagram in the opened browser viewport.
- [ ] At browser widths up to `1100px`, `main` owns reachable horizontal overflow while
  the document itself still fits the viewport.
- [ ] CSS Grid owns panel geometry; runtime JavaScript does not assign layout dimensions.
- [ ] The shell fills the current default-browser viewport and remains readable when resized.
- [ ] Exceptions, compatibility behavior, and proof are explicit.
- [ ] Choice panels expose caller-facing axes; finite contracts use representative
  scenarios before private ranks or flags.
- [ ] Each finding matches its failure mechanism; order-dependent findings show causal
  order, executable actor names, and proof/fix provenance.
- [ ] A reader can identify the winner, stale state, and consequence without decoding a
  generalized control-flow diagram.
- [ ] The default-browser tab is left open on the grand overview.

## Common Failures

- **Overview mirrors the diff stat**: regroup files by behavior and ownership.
- **Diagram-only report**: add a `mentalModel` that explains meaning, reasoning,
  invariants, and scope; do not make readers reverse-engineer the prose from arrows.
- **Detached cards or callouts**: move their information into the referenced Markdown
  file or `mentalModel.points`; panel content should be the mental model and diagram.
- **Everything is “new”**: distinguish reused behavior from actual branch changes.
- **The overview starts inside the implementation**: state the developer's previous
  limitation and show the smallest new call or configuration before explaining the
  collector, registry, graph, or pipeline.
- **A flowchart is pretending to be a table**: compare API or mode choices with a matrix;
  teach finite contracts through scenarios before private ranks or flags.
- **The bug is buried in the architecture**: create a dedicated finding spotlight from
  the failing test. Show expected versus actual with concrete actors and the observed
  failure; move candidate ranking and other background mechanics elsewhere.
- **Abstract boxes hide the evidence**: replace labels like `Candidate`, `Compare`, and
  `Replace` with the names a reader sees in the test or public API.
- **Mirrored finding graphs create a poster, not a proof**: if one trigger fans into two
  large subgraphs or leaves a sea of whitespace, replace them with the numbered actual
  causal path and keep Expected/Actual as concise mental-model statements.
- **Proof provenance is unclear**: label the finding, proof, and fix as committed, staged, unstaged, or absent.
- **Builder rejects the overview**: fix the named manifest field or referenced source;
  never bypass validation or inline the content into a command.
- **Mermaid parse error**: simplify punctuation and quote or shorten labels.
- **Layout verification fails**: keep the page inside the viewport, `.app` fixed with
  `inset: 0`, the two-column minimum width inside `main`, and intrinsic Mermaid SVGs
  reachable through each diagram's two-axis scroll region.
- **Browser ownership or profile-lock errors**: Playwright was used despite this workflow.
  Open the generated file with the operating system command instead.
- **Only committed work appears**: inspect and label the working-tree overlay.

## Output Expectations

Report:
- the base and branch compared;
- the temporary manifest/source directory and generated HTML path;
- the conceptual panels created;
- whether the generated page opened in the default browser and displayed `Verified`;
- any uncommitted or unresolved work surfaced by the overview.

## Resources

- `assets/overview.example/` — copyable manifest, Markdown, and Mermaid starter.
- `assets/branch-overview.html` — fixed shell with data/runtime injection tokens.
- `assets/branch-overview-runtime.js` — JSON renderer, lazy Mermaid, and interactions.
- `assets/branch-overview-verifier.js` — rendering, containment, and reachability
  verifier, concatenated into the generated module by the builder.
- `scripts/build-overview.ts` — dependency-free source assembler, validator, and HTML
  generator.
- `references/overview-data.md` — manifest contract, Mermaid recipes, built-in verifier,
  and default-browser handoff.
