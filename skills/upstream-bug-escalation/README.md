# Upstream Bug Escalation

A Pi skill for bugs whose symptom appears in one project but whose proper fix belongs in a dependency or another repository.

It keeps two outcomes separate:

1. **Keep users moving:** implement and validate the smallest reversible workaround inside the boundary you control.
2. **Make the upstream fix actionable:** prove the ownership boundary and prepare a maintainer-ready issue draft with focused evidence.

The skill presents the issue for review. It never posts an issue, comment, or pull request without a separate, explicit instruction from the user.

## What the skill does

When a failure crosses a repository or dependency boundary, the skill:

- preserves exact errors, structured diagnostics, versions, configuration, and event ordering before changing behavior;
- traces the resource lifecycle on both sides of the boundary, from creation and ownership through reuse and cleanup;
- distinguishes verified facts from source-backed inference and unresolved hypotheses;
- determines whether the bug is local, an integration mismatch, upstream-owned, environmental, or still unproven;
- classifies concurrency or stress as causal, required to reproduce, amplifying, or irrelevant;
- implements a narrow local mitigation when the full fix is outside the owned codebase;
- validates the workaround's scope and records its concrete cost and removal condition;
- proposes the smallest upstream fix that restores the intended ownership boundary;
- defines a regression proof that covers both target cleanup and peer isolation; and
- produces a concise, sanitized GitHub issue draft using the bundled [issue template](assets/upstream-issue-template.md).

The skill is designed for lifecycle and shared-state failures, but the workflow also applies to cross-boundary bugs involving caches, transports, adapters, SDKs, and other dependency-owned behavior.

## When to use it

Use the skill for requests such as:

- “Find a safe workaround and dig into the real fix.”
- “Explain why the proper solution belongs upstream.”
- “Prepare a precise issue for the dependency maintainer.”
- “This only fails under load—figure out whether concurrency is the cause.”

Do not use it for a routine, locally owned bug with a clear complete fix. The skill will not manufacture an upstream blame story when the evidence points back to local code.

## Output

A completed escalation contains four deliverables:

1. **Diagnosis** — the failure mechanism, ownership boundary, confidence, and remaining uncertainty.
2. **Temporary mitigation** — the exact scope, validation result, concrete trade-off, and condition for removal.
3. **Upstream fix direction** — the owner identifier or scoped API that should replace the broader behavior, plus a peer-isolation regression test.
4. **Maintainer-ready issue draft** — a focused title and Markdown body with environment details, lifecycle evidence, diagnostics, reproduction, expected and actual behavior, suggested fix, and regression proof.

The public draft uses neutral downstream labels and excludes private repository names, revisions, checkout paths, secrets, and proprietary payloads. Public dependency names, versions, symbols, errors, and focused technical evidence remain intact.

## How it is proven

The evaluation suite in [`evals/suites/upstream-bug-escalation`](../../evals/suites/upstream-bug-escalation) exercises a multi-turn investigation of a shared WebSocket lifecycle bug. Disposing one in-process owner triggers global cache cleanup and breaks an unrelated peer after streaming has begun.

To pass, the agent must:

- activate and follow the skill;
- recover the complete failure story from logs and pinned source;
- report version and environment evidence with honest provenance;
- identify global cleanup as the ownership violation;
- propose owner-scoped cleanup and a peer-isolation regression test;
- provide a safe, reversible workaround with an explicit cost;
- produce well-formed, concise issue Markdown;
- keep private downstream identifiers out of the public artifact; and
- earn the top semantic-readiness grade as an actionable maintainer report.

See the comparison artifacts:

- [Before using the skill](proof/before.md)
- [After using the skill](proof/after.md)

## Files

- [`SKILL.md`](SKILL.md) — activation contract, investigation workflow, hard rules, and correctness checklist.
- [`assets/upstream-issue-template.md`](assets/upstream-issue-template.md) — required structure and release gate for the final issue draft.
- [`proof/`](proof/) — before-and-after examples of the skill's effect.
