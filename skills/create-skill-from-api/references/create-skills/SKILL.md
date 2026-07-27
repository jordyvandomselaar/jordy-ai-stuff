---
name: create-skills
description: >
  Use when creating, refactoring, reviewing, or improving Agent Skills / Pi skills,
  including SKILL.md files, @skills directories, skill references, scripts, assets,
  trigger descriptions, skill evals, or reusable agent workflows. Use when the user asks
  to "create a skill", "make a new skill", "turn this into a skill", "improve this skill",
  or design a capability package for future agents.
metadata:
  author: jordy
  version: "1.0.0"
---

# Create Skills

Build skills that make future agents reliably better at a coherent class of tasks.
A good skill is not a wiki page. It is an activation surface, operating contract,
routing system, workflow, guardrail set, and proof checklist packaged for progressive
disclosure.

## Operating Rules

- Work from real expertise. Do not create a generic "best practices" blob if the
  user has not provided domain-specific context, examples, source material, or desired
  behavior.
- When the skill targets a specific agent harness, read that harness's current skill
  documentation before relying on memory; skill loading, frontmatter, commands, and
  packaging details change over time.
- Interview first when the request is vague. Ask a small batch of high-yield questions
  instead of dumping a huge form on the user.
- If the user already gave enough context, do not stall with unnecessary questions;
  synthesize the fact sheet and build.
- Keep `SKILL.md` as the router and operating contract. Move deep topic material into
  one-level `references/` files, reusable templates into `assets/`, and executable
  helpers into `scripts/`.
- Optimize for progressive disclosure: the frontmatter description triggers the skill,
  `SKILL.md` tells the agent what to do next, and references/scripts load only when
  explicitly routed.
- Prefer hard rules, decision trees, examples, anti-patterns, and output contracts over
  vague advice.
- Separate hard invariants from softer preferences. Use words like **must**, **never**,
  and **always** only when violations are genuinely bugs or unsafe.
- For portability, follow the Agent Skills spec even when Pi is lenient: directory name
  and `name` should match; use lowercase letters, numbers, and hyphens; keep the
  description non-empty and under 1024 characters.
- Do not add install/setup/bootstrap commands or dependency-changing scripts casually.
  If scripts need dependencies, document them and follow the environment's safety rules
  before running anything.
- Never put secrets, tokens, credentials, or personal sensitive data in a skill.

## First 60 Seconds

1. Identify whether the user wants to create, refactor, review, package, or evaluate a
   skill.
2. Determine target location and scope:
    - user-global Pi skill: `(PI_CODING_AGENT_DIR, default ~/.pi/agent)/skills/<name>/SKILL.md`
   - project skill: `.agents/skills/<name>/SKILL.md`
   - pi package/extension skill: `<package-or-extension>/skills/<name>/SKILL.md`
   - Another global location
3. Check whether a skill with the same name already exists before writing.
4. Gather real source material: related skills, docs, runbooks, code review comments,
   incidents, scripts, command history, or a completed task transcript.
5. Classify the skill shape with the Skill Shape Router below.
6. Build only after you have enough facts to write a non-generic skill.

## Intake Interview

When the user asks for a skill but has not provided enough detail, ask these questions
in one concise batch. Drop questions already answered by the user.

1. **Name and scope:** What should the skill be called, and should it be global,
   project-local, or bundled in a package/extension?
2. **Target tasks:** What 3-5 real user prompts should definitely trigger it?
3. **Near misses:** What 3-5 similar prompts should *not* trigger it?
4. **Hard rules:** What must the agent always do, never do, or verify?
5. **Source material:** Which docs, existing skills, code files, review comments,
   tickets, runbooks, or previous conversations should I study first?
6. **Output contract:** What should the agent produce when the skill is used
   (code changes, review findings, a report, a UI, a command result, a checklist)?
7. **Tools/scripts:** Are there canonical commands or scripts the future agent should
   run? Are any destructive, dependency-changing, authenticated, or environment-specific?

If the user does not know the answers, propose a minimal draft plan and ask for approval:

```text
I can make this as a [shape] skill with:
- trigger surface: ...
- hard rules: ...
- references/scripts: ...
- output format: ...

Missing facts that would materially improve it: ...
Proceed with this draft, or fill those gaps first?
```

## Skill Shape Router

Choose the shape before writing. If a skill spans multiple shapes, keep `SKILL.md` as
the shared router and split deep details into references.

| User need | Best shape | Core sections |
| --- | --- | --- |
| Audit/review a narrow class of artifacts | Checklist skill | Rules, Anti-patterns, Output Format |
| Expert help across many subtopics | Router expert | When Applies, Topic Router, Operating Rules, References |
| Debug/triage production or local failures | Operational skill | First 60 Seconds, Workflow, Common Errors, Verification |
| Create/refactor code in a domain | Implementation skill | Workflow, Design Principles, Guardrails, Proof Checklist |
| Use canonical commands/scripts | Script-backed skill | Workflow, Commands, Script Usage, Failure Handling |
| Many related capabilities | Skill suite | Small focused skills, cross-routing, extension/package docs |
| Output in a strict format | Template skill | Input Contract, Output Template, Validation Checklist |

For examples of strong shapes and section patterns, read `references/exemplar-patterns.md`.
For a reusable skeleton, use `assets/skill-template.md`.

## Build Workflow

### 1. Research and extract the reusable expertise

- Read the source material the user named.
- Read nearby skills that solve similar problems, especially their frontmatter,
  routing maps, guardrails, and output contracts.
- Extract facts the model would otherwise get wrong:
  - fragile command sequences
  - domain-specific gotchas
  - project conventions
  - recurring review feedback
  - common failure messages
  - exact APIs/file paths/tools
  - examples of good and bad outputs

Do not copy bulky docs into the skill. Convert source material into decision rules,
procedures, and references.

### 2. Write a fact sheet before editing files

For non-trivial skills, internally organize the facts as:

```markdown
## Skill Fact Sheet
- Name:
- Scope/path:
- Skill shape:
- Should trigger for:
- Should not trigger for:
- Primary workflow:
- Hard rules:
- Guardrails / anti-patterns:
- References to include:
- Scripts/assets to include:
- Output contract:
- Verification / eval plan:
- Open questions:
```

Ask the user one targeted follow-up if a missing fact would materially change the skill.
Otherwise proceed with documented assumptions.

### 3. Draft the top-level `SKILL.md` as an operating contract

Use this default section order unless the skill has a stronger reason to differ:

1. YAML frontmatter
2. `# Skill Name`
3. Mission / Quick Start
4. When This Skill Applies
5. Operating Rules
6. First 60 Seconds or Intake/Triage
7. Topic Router / Skill Shape Router / Decision Guide
8. Workflow
9. Key Principles
10. Correctness Checklist / Review Checklist
11. Guardrails / Anti-patterns / Common Pitfalls
12. Output Expectations / Output Format
13. References

Keep `SKILL.md` concise and loaded with decision-making value. If it is turning into
an encyclopedia, split it.

### 4. Write trigger descriptions deliberately

The frontmatter `description` carries the entire activation burden before the skill
loads. It should:

- start with `Use when...` or otherwise directly instruct activation;
- mention exact user intents, APIs, file types, errors, commands, and casual phrases;
- include near-synonyms users will actually type;
- be pushy enough to catch indirect requests;
- stay precise enough to avoid near-miss activation;
- remain under 1024 characters.

Do not write descriptions like `Helps with X`. That is useless activation soup.

### 5. Decide references, assets, and scripts

Add a `references/` file when:

- the detail is topic-specific and not always needed;
- the top-level skill would exceed a compact operating contract;
- the content is a deep API guide, command matrix, troubleshooting catalogue, or example set.

Add an `assets/` file when:

- the agent needs a reusable output template, config skeleton, or non-executable resource.

Add a `scripts/` file when:

- the workflow needs repeatable mechanical verification or transformation;
- code is more reliable than model judgment;
- the script can be non-interactive, documented with `--help`, and safe to run.

Script requirements:

- no interactive prompts;
- clear `--help` usage;
- helpful error messages that say what went wrong and how to fix it;
- structured stdout when practical; diagnostics to stderr;
- safe defaults, dry-run support for destructive/stateful operations, and meaningful exit codes.

Prefer TypeScript for new skill helper scripts unless the task truly needs another language.

### Script shape and file layout

Prefer small, task-specific executable scripts over one large command router.

Default layout for script-backed skills:

```text
scripts/
  check-auth.ts
  list-things.ts
  get-thing.ts
  create-thing.ts

  lib/
    api.ts
    types.ts
    validate.ts
    format.ts
```

Rules:

- Each user-facing action should usually get its own executable script.
- Keep executable scripts thin: parse args, call shared logic, print output.
- Put reusable API clients, auth, validation, types, and formatting in `scripts/lib/`.
- Use kebab-case TypeScript filenames for scripts.
- Prefer action/resource names that match the underlying API or workflow:
  - `list-notes.ts`
  - `get-note.ts`
  - `check-auth.ts`
- Avoid giant umbrella CLIs unless the whole workflow is genuinely tiny.
- If a script starts accumulating a command router, schema validation, API client,
  and output formatting in one file, split it.
- Do not add a package manager setup or dependency graph just to split files; use
  local relative imports and runtime-supported TypeScript when possible.
- Every executable script should support `--help` or have clear usage documented in
  `SKILL.md`.

A single-file script is acceptable only when it is small, single-purpose, and
unlikely to grow. When in doubt, split by user-facing action and share internals
through `scripts/lib/`.

### 6. Validate before finishing

Check:

- directory name matches `name`;
- frontmatter has valid YAML, `name`, and `description`;
- description is under 1024 characters;
- references are relative paths from the skill root;
- `SKILL.md` tells the agent exactly when to load each reference;
- any scripts are executable when intended and have usage docs;
- no secrets or private data were written;
- the skill has at least one workflow, hard-rule set, guardrail set, or output contract;
- the skill is not just generic advice the model already knows.

For serious skills, also create or propose:

- 8-10 should-trigger prompts and 8-10 should-not-trigger prompts for description evals;
- 2-3 output quality evals with expected outputs and objective assertions.

## Quality Bar

A skill is ready when it satisfies these checks:

- [ ] It has a specific, intent-rich activation description.
- [ ] It captures domain/project expertise the model would otherwise miss.
- [ ] It has a clear workflow or decision tree, not just declarations.
- [ ] It names hard rules separately from preferences.
- [ ] It contains concrete anti-patterns/gotchas.
- [ ] It tells the agent how to verify success.
- [ ] It has an output format when consistency matters.
- [ ] It uses references/assets/scripts only where progressive disclosure helps.
- [ ] It avoids unnecessary dependency/setup commands.
- [ ] It remains small enough for context and easy to maintain.

## Common Mistakes To Avoid

- Writing a skill before extracting real source material.
- Making the description too vague to trigger or so broad it triggers everywhere.
- Turning `SKILL.md` into a long tutorial instead of a router.
- Saying "follow best practices" instead of naming actual rules and gotchas.
- Offering menus of equal options instead of choosing a default path.
- Omitting near-miss cases, causing false-positive activation.
- Including scripts that require hidden setup, interactive input, or undocumented secrets.
- Leaving out output expectations, forcing future agents to improvise every response.
- Forgetting validation/evals, so the skill only "feels" good once.

## Output Expectations

When creating or updating a skill, finish with:

- created/modified paths;
- the selected skill shape;
- key trigger phrases included in the description;
- references/assets/scripts added;
- validation performed;
- any assumptions or open questions;
- suggested trigger/eval prompts if not already added.

Keep the summary concise. The files are the product.

## References

- `references/exemplar-patterns.md` — common patterns from strong existing skills.
- `assets/skill-template.md` — reusable `SKILL.md` skeleton for new skills.
