---
name: skill-name
description: >
  Use when [user intent and task class]. Use when the user mentions [exact APIs,
  file types, commands, errors, workflows, or casual phrases]. Do not use for
  [important near-miss boundary] unless [condition].
metadata:
  author: [owner]
  version: "1.0.0"
---

# Skill Name

One paragraph mission: what future agents should become reliably better at when
this skill activates.

## When This Skill Applies

- Exact trigger term or API.
- Casual phrase users might type.
- Error message / file type / command / artifact.
- Review/debug/generation mode.

## Quick Start

Default posture and first move. State the normal path in 3-5 bullets.

## Operating Rules

- Always ...
- Never ...
- Prefer ...
- Ask only when ...

## First 60 Seconds

1. Inspect / clarify ...
2. Classify ...
3. Route ...
4. Verify ...

## Topic Router

| User signal | Read / do |
| --- | --- |
| [signal] | `references/[topic].md` |
| [error text] | [workflow or command] |

## Workflow

1. Read the relevant source/context.
2. Apply the routed reference or checklist.
3. Make the smallest correct change or produce the requested output.
4. Validate with the narrowest proof.
5. Report the result in the expected format.

## Key Principles

1. Domain-specific principle.
2. Domain-specific principle.
3. Domain-specific principle.

## Correctness Checklist

- [ ] Invariant that must hold.
- [ ] Invariant that must hold.
- [ ] Verification step completed.

## Guardrails

- Do not ...
- Do not ...
- If uncertain, ...

## Common Pitfalls

- Pitfall → fix.
- Error message → next best move.
- Anti-pattern → preferred pattern.

## Output Expectations

Provide:
- what was inspected/changed;
- evidence or validation;
- final result;
- remaining risks/open questions.

Use this format when consistency matters:

```text
## [Artifact]

path:line - finding or change
```

## References

- `references/[topic].md` — when to load it and why.

