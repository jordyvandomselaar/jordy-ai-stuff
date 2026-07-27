# Exemplar Skill Patterns

Use this reference when choosing a skill shape, reviewing a draft skill, or turning
domain knowledge into a durable capability package.

## The strongest shared pattern

Powerful skills are usually not knowledge dumps. They are:

1. **Activation surfaces** — frontmatter descriptions with exact trigger terms.
2. **Operating contracts** — hard rules the agent must follow.
3. **Routing systems** — user signal to reference/workflow mapping.
4. **Procedures** — first steps, workflows, and command sequences.
5. **Guardrails** — anti-patterns and things not to do.
6. **Proof models** — validation checklists, eval prompts, or concrete verification steps.
7. **Output contracts** — final answer/report/comment shape.

If a draft skill lacks at least three of these, it is probably too weak.

## Section patterns that work

### Compact checklist skill

Best for audits and reviews.

```markdown
# Web Interface Guidelines

## Rules

### Accessibility
- ...

### Performance
- ...

## Anti-patterns
- ...

## Output Format
file:line - finding
```

Why it works:
- low context cost;
- no ambiguity about what to flag;
- strict output shape makes results scanable.

### Router expert skill

Best for broad domains with many subtopics.

```markdown
# Domain Expert

## When this skill applies
- API names
- casual phrases
- file types
- review/debug triggers

## Quick Routing
| User signal | Reference |
| --- | --- |
| state/lifecycle | references/state.md |
| performance | references/performance.md |

## Workflow
1. Understand request
2. Consult right reference
3. Apply and verify

## Key Principles
- ...
```

Why it works:
- `SKILL.md` stays compact;
- deep material loads only when needed;
- exact trigger terms improve activation.

### Operational/debugging skill

Best for build, run, test, signing, deployment, data, or production triage.

```markdown
# Debug Skill

## Quick Start
Default posture and first tool/command.

## First 60 Seconds
- collect minimal facts
- classify failure
- choose path

## Workflow
1. Inspect artifact
2. Run narrow validation
3. Classify failure
4. Propose minimum fix

## Common Errors → Next Best Move
- error text → reference/workflow

## Guardrails
- do not conflate X with Y
- do not run destructive commands

## Output Expectations
- artifact inspected
- failure class
- next validation/fix
```

Why it works:
- prevents random command flailing;
- maps errors to actions;
- distinguishes evidence from inference.

### Implementation/design skill

Best for creating code or UI in a domain.

```markdown
# Implementation Skill

## Operating Rules
- native/default APIs first
- version gates
- state ownership rules

## Workflow
1. inspect existing project conventions
2. choose architecture/pattern
3. implement smallest correct change
4. verify build/tests/usability

## Design Principles
- ...

## Review Checklist
- ...

## When To Use Other Skills
- ...
```

Why it works:
- the skill shapes architecture, not just syntax;
- cross-routing avoids one skill becoming a junk drawer.

### Script-backed skill

Best when mechanical checks or transformations outperform prose.

```markdown
# Script-backed Skill

## Workflow
1. inspect inputs
2. run `scripts/analyze.ts --json ...`
3. interpret JSON using this guide
4. fix or report

## Script Contract
- non-interactive
- `--help`
- structured stdout
- diagnostics to stderr
- dry-run for dangerous actions

## Failure Handling
- exit code 2 → invalid input
- exit code 3 → auth/environment problem
```

Why it works:
- repeatable verification;
- fewer hallucinated interpretations;
- agent can recover from clear errors.

## Writing style

Use:
- direct imperatives;
- short paragraphs;
- bullets and numbered steps;
- exact API names, command names, file paths, and error messages;
- concrete wrong/right examples;
- words like **prefer**, **avoid**, **do not**, **must**, and **verify**.

Avoid:
- long background explanations;
- generic advice;
- equal-option menus without a default;
- historical transition framing;
- unchecked assumptions about environment, secrets, or installed dependencies.

## Progressive disclosure rules

- Put activation-critical terms in the frontmatter description.
- Put always-needed behavior in `SKILL.md`.
- Put topic-specific depth in `references/<topic>.md`.
- Put templates in `assets/`.
- Put repeatable mechanical logic in `scripts/`.
- In `SKILL.md`, tell the agent exactly when to load each reference.

Bad:

```md
See references/ for more details.
```

Good:

```md
If the user mentions migration errors or incompatible store hashes, read
`references/migration.md` before answering.
```

## Description pattern

Use this formula:

```text
Use when [creating/reviewing/debugging/refactoring] [specific artifact/domain].
Use when the user mentions [exact APIs/files/errors/workflows] or asks to
[common casual phrasing]. Do not use for [near-miss if important].
```

Include should-trigger terms and near-miss boundaries from the intake interview.

## Evaluation pattern

For trigger quality:
- collect 8-10 should-trigger prompts;
- collect 8-10 should-not-trigger near misses;
- include casual wording, typos, file paths, and larger multi-step prompts;
- run multiple times if the agent/client supports observability;
- improve only from train failures, then check validation prompts.

For output quality:
- start with 2-3 realistic tasks;
- describe expected output in human terms;
- add objective assertions after seeing initial outputs;
- compare with-skill against without-skill or previous-skill;
- keep changes that improve pass rate enough to justify token/time cost.

