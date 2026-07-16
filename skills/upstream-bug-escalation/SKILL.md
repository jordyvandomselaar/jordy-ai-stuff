---
name: upstream-bug-escalation
description: >
  Use when a bug crosses repository or dependency boundaries and the user wants a
  safe workaround, root-cause investigation, explanation of why the proper fix
  belongs upstream, maintainer-ready issue draft, or says “find a workaround and
  dig into the real fix”, “prepare an upstream issue”, or “give the maintainer a
  precise report”. Implements and validates the smallest reversible mitigation,
  proves the ownership boundary from source and diagnostics, and presents a
  detailed GitHub issue draft without posting it. Do not use for routine locally
  owned bugs with a clear complete fix.
---

# Upstream Bug Escalation

Diagnose the actual failure, keep the user moving with a reversible local
mitigation, and hand them a maintainer-grade upstream report. The workaround and
the proper fix are separate deliverables; do not blur them.

## Hard Rules

- **Never automatically create or post a GitHub issue, comment, pull request, or
  other external report.** Present the complete draft to the user first.
- Only publish later when the user gives a separate, explicit instruction to do
  so in the current conversation.
- Preserve raw evidence before changing behavior: exact errors, timestamps,
  versions, effective configuration, diagnostics, and relevant lifecycle paths.
- **NEVER present a dependency range, documented minimum, development version,
  lockfile value, or inspected source revision as the observed runtime.** Every
  environment value MUST be labeled by provenance. If the actual runtime version
  was not captured, say `not captured`; list requirements or development versions
  separately and label them exactly.
- **The affected upstream package version is mandatory evidence.** Before drafting,
  resolve it from observed runtime metadata when available. If the runtime version
  was not captured, report that honestly AND inspect the public source package
  manifest; report its declared version separately as inspected-source evidence.
  **NEVER omit both values and NEVER relabel a manifest version as runtime evidence.**
- Label facts, strong inferences, and unresolved hypotheses honestly.
- **Every multi-owner, intermittent, or load-sensitive escalation MUST classify
  concurrency and stress explicitly:** causal, required to reproduce, merely an
  amplifier, or irrelevant. Never leave that relationship implicit.
- **The public issue MUST read like a maintainer report, not an investigation
  transcript or evaluation artifact.** State each fact and conclusion once. Keep
  only evidence that advances the diagnosis, reproduction, fix, or regression
  proof. Use natural prose and valid, consistently rendered Markdown.
- Prefer the smallest reversible workaround that stays inside the user's owned
  boundary. **The public mitigation MUST name at least one concrete lost
  capability or performance, reliability, or operational cost.** Scope and a
  removal condition alone are not trade-offs.
- **A public mitigation is incomplete unless its own section explicitly states
  all four release fields: exact scope, validation status or results, concrete
  cost, and the condition that removes the workaround.** All four MUST be
  present before delivery; information elsewhere in the response does not fill
  a missing field.
- Do not weaken authentication, authorization, secret handling, platform safety,
  or data integrity to make the symptom disappear.
- Do not install, downgrade, bootstrap, migrate, or replace dependencies without
  first following the environment's dependency safety rules.
- Do not manufacture an upstream problem. If ownership is local, fix it locally
  and explain why no escalation is warranted.
- Never put tokens, credentials, private payloads, personal data, or proprietary
  source excerpts into a public issue draft. Redact narrowly while preserving the
  technical signal.
- **A public draft MUST NOT contain downstream project names, repository names,
  internal labels, private revisions, or raw checkout paths.** Those values are
  private investigation context, not maintainer evidence. Before emitting the
  draft, choose one neutral architectural role and neutral path labels. **From
  the first public-artifact token onward, NEVER type a collected downstream-only
  value, even temporarily; draft directly with the neutral vocabulary instead of
  relying on later sanitization.** Keep public dependency names, versions,
  symbols, exact errors, and focused lifecycle behavior intact. **This ban applies to EVERY issue section,
  including environment fields, source labels, code comments, reproduction steps,
  ownership prose, suggested fixes, and workaround or mitigation text.**

## First 60 Seconds

1. Capture the exact failure text and the operation that triggered it.
2. Identify the involved components, versions, runtime, protocol or transport,
   feature flags, and effective configuration.
3. Stop runaway retries or fan-out if they are causing damage, but do not erase
   the event/log evidence.
4. Locate the first relevant stack frame in owned code and the first frame in the
   suspected dependency.
5. Classify the likely boundary:
   - locally owned implementation bug;
   - integration mismatch between local and upstream code;
   - upstream resource/lifecycle/API bug;
   - environment/auth/network failure;
   - still unproven.

## Decision Guide

| Evidence | Default action |
| --- | --- |
| Local code violates a documented dependency contract | Fix locally; do not blame upstream |
| Dependency has the correct scoped API but calls a broader path internally | Add reversible mitigation and draft an upstream issue |
| Multiple in-process consumers share module-global state | Trace creation, ownership, eviction, and shutdown for each consumer |
| Failure only appears under high concurrency | Determine whether concurrency is the cause or merely an amplifier |
| A workaround changes transport, consistency, caching, or performance | Keep it narrow and document the exact trade-off |
| Root cause remains speculative | Present an investigation plan, not a confident issue report |
| Authentication is missing or broken | Stop and report the auth failure; do not route around it |

## Workflow

### 1. Build an evidence timeline

Collect only what advances the diagnosis:

- first failure and subsequent retries;
- timestamps and ordering;
- provider/runtime diagnostics;
- close/error codes and reasons;
- versions and effective settings;
- request size or phase when relevant;
- whether events had already streamed;
- the smallest known trigger.

Search structured event/log records instead of relying on the shortened error
shown in a UI. Extract only relevant fields and redact sensitive values.

### 2. Trace the complete lifecycle across the boundary

Read representative source on both sides. Follow the resource from creation to
cleanup:

1. Who creates it?
2. What identifies its owner?
3. Is state per request, per owner, per process, or global?
4. Who retains/reuses it?
5. What action evicts or shuts it down?
6. Does cleanup target the owner or every resource of that type?

For ownership or lifecycle bugs, include downstream code showing resource
creation, owner identity, retention/reuse, and one scoped release. Include
upstream code showing the state scope and the cleanup or mutation call. Prefer
one compact downstream lifecycle excerpt and one compact upstream state/cleanup
excerpt. The public issue MUST use that evidence budget by default. Add an
excerpt only when it proves a distinct material claim that the selected excerpts
and concise prose do not already establish. Delete blocks that repeat creation,
cleanup, ownership, provenance, or the causal conclusion.

### 3. Reproduce narrowly

Reduce the observed incident to the smallest credible reproduction:

- minimum number of owners, resources, consumers, or processes;
- minimum configuration and flags;
- explicit setup, action, and observed result;
- note stress settings separately as amplifiers rather than requirements.

Do not claim a reduced reproduction was executed if it was inferred from source.
Say “source-level reproduction path” or “proposed minimal reproduction” instead.

### 4. Implement a reversible local workaround

When the user asked for a fix and the proper fix is outside the owned boundary:

1. Choose the smallest mitigation that prevents user harm.
2. Keep unaffected owners, consumers, traffic, or behavior unchanged when possible.
3. Add regression tests proving the mitigation and its scope.
4. Run the narrow tests, then the relevant full suite.
5. Record what the workaround gives up: performance, caching, concurrency,
   fidelity, or functionality.
6. Make removal obvious once upstream ships the proper fix.

Do not patch installed dependency files in place. Prefer owned configuration,
adapter behavior, or a compatibility shim with a clear deletion condition.

### 5. Prove why the proper solution belongs elsewhere

The escalation must answer all of these:

- What exact downstream action is legitimate?
- What exact upstream behavior broadens or corrupts it?
- What identifier or API already exists to implement correct scoping?
- Why can't the downstream workaround safely implement the full fix?
- What peer or unrelated-owner behavior is unintentionally affected?
- What regression test would fail before and pass after the fix?

If the evidence changes the ownership conclusion, update the workaround and do
not force an upstream narrative.

### 6. Prepare the maintainer-ready issue draft

Read and fill [`assets/upstream-issue-template.md`](assets/upstream-issue-template.md).
Keep its section order unless a section is genuinely irrelevant. Include concrete
code from both the downstream integration and upstream package. Public upstream
paths and symbols stay exact. Downstream snippet labels MUST use the neutral role
unless a public identifier is strictly required to reproduce the dependency contract.

The report must include:

- concise title with affected component and failure;
- summary and impact;
- exact environment/effective configuration;
- relevant downstream lifecycle code;
- upstream state/cleanup code;
- observed diagnostics;
- reproducible steps;
- expected versus actual behavior;
- a narrowly suggested fix;
- a peer-isolation regression test;
- current workaround and its trade-offs.

Prefer the shortest report that preserves this proof. Omit repeated provenance,
redundant diagnostics, unrelated cleanup internals, and aggregate test counts that
do not directly validate the reported failure.

After every issue section is complete, the final action before delivery MUST be
an exact-string audience lint over a buffer containing only the public title and
body. Search for every collected downstream-only name, revision, and locator;
replace each match with the chosen neutral role, then rerun the lint until it
returns zero matches. An earlier lint does not count because later-written
sections can reintroduce private investigation terms.

### 7. Present, do not publish

Finish by giving the user:

1. the diagnosis in 2-4 sentences;
2. workaround files/behavior and validation results;
3. remaining uncertainty, if any;
4. a fully filled issue title and Markdown body using the exact template.

Stop there. Do not open a browser or call GitHub APIs merely because the draft is
ready.

## Proof Model

For a resource-isolation regression, prove the transition explicitly:

- pre-action: resources A and B exist and B is open/reusable;
- action: shut down or evict owner A;
- post-action: A is closed/removed exactly once;
- isolation: B was not closed and remains reusable;
- final cleanup: shutting down B later closes B exactly once.

For a workaround regression, prove:

- precondition: the risky path would otherwise activate for the affected owner or
  operation;
- action: exercise that owner or operation through the normal public flow;
- postcondition: only the affected scope uses the mitigation;
- isolation: unrelated consumers, traffic, security controls, and data integrity
  remain intact.

## Guardrails and Anti-patterns

- Do not stop at “probably environmental flakiness” when status codes, stack
  frames, structured diagnostics, or state transitions are available.
- Do not call high concurrency the root cause merely because it makes the failure
  frequent. Test whether it is an amplifier.
- Do not present a blunt workaround as the architectural fix.
- Do not omit downstream code. Maintainers need to see the legitimate lifecycle
  that invokes their package.
- Do not paste an entire trace, giant payload, or sensitive configuration into
  the issue. Extract the smallest diagnostic evidence.
- Do not propose a fix without naming the owning identifier and a regression test.
- Do not create a vague issue containing only error text and “please investigate”.
- Do not publish before the user reviews the exact draft.

## Correctness Checklist

- [ ] Exact error sequence and relevant structured diagnostics are preserved.
- [ ] Versions and effective configuration are included.
- [ ] Every environment version is labeled as observed, required, development/test,
      or inspected-source evidence; an unknown actual runtime says `not captured`.
- [ ] The affected upstream package has either an observed runtime version or an
      explicitly labeled public-manifest version; when runtime is unknown, both the
      unknown runtime and inspected-source value are stated.
- [ ] Downstream creation/disposal lifecycle is traced with paths and symbols.
- [ ] Upstream state ownership and cleanup behavior are traced with paths and symbols.
- [ ] Facts are separated from inference.
- [ ] Concurrency and stress are explicitly classified as causal, required,
      amplifying, or irrelevant.
- [ ] The workaround is narrow, reversible, tested, and names at least one
      concrete capability, performance, reliability, or operational cost.
- [ ] The public mitigation section explicitly contains its scope, validation,
      concrete cost, and removal condition.
- [ ] The proposed proper fix targets the actual ownership boundary.
- [ ] Regression proof covers peer isolation, not only target cleanup.
- [ ] The report is concise, non-repetitive, natural, and valid Markdown; the
      default evidence budget is one downstream and one upstream excerpt, and
      every additional excerpt proves a distinct material claim.
- [ ] Public draft contains no secrets, private payloads, downstream-only names,
      private revisions, raw checkout paths, or unnecessary internal data.
- [ ] The last pre-delivery action searched the completed public title/body for
      every collected downstream-only value and returned zero matches.
- [ ] Full issue title and body are presented to the user.

## References

- [`assets/upstream-issue-template.md`](assets/upstream-issue-template.md) — exact
  maintainer-ready issue format; always use for the final draft.
