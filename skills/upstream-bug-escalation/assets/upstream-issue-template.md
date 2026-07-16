# Upstream Issue Draft Template

Present the filled title and body to the user. Do not post it.

## Mandatory public-artifact release gate

The issue MUST NOT be presented until all four steps pass:

1. Collect every downstream-only name and locator encountered during investigation:
   project and repository names, internal labels, private revisions, raw checkout
   paths, organization shorthand, and identifying code comments.
2. Before writing the public title, choose one consistent neutral role and neutral
   path labels. From the first public-artifact token onward, **NEVER type a
   collected downstream-only value, even as a draft placeholder.** Write clean
   with the neutral vocabulary; later replacement is defense in depth, not the
   primary safety mechanism.
3. Replace every accidental occurrence in the exact public title and complete
   body. This MUST cover headings,
   environment fields, prose, lists, source labels, code comments, reproduction,
   ownership, suggested fixes, regression proof, and workaround or mitigation
   sections. A request for downstream lifecycle code authorizes the focused
   behavior and symbols; it does **not** authorize private identifiers.
4. After every section is written, copy only the completed public title and body
   into a review buffer and exact-string search it for every collected value.
   **Any unnecessary match in ANY section blocks delivery.** Replace matches with
   the chosen neutral role and repeat the search until it returns zero matches.
   An earlier search does not count: later-written sections can reintroduce private
   terms. Keep public dependency names, versions, revisions, symbols, exact errors,
   and focused technical proof intact.

Keep the private diagnosis outside the issue distinct from the public artifact.
The diagnosis may use local names when helpful to the user; that does not make
those names appropriate for the maintainer-facing title or body.

## Title

```text
[<affected component>] <one owned action> causes <incorrect cross-owner impact>
```

## Body

````markdown
## Summary

<Describe the legitimate action, the incorrect behavior, affected peers/users,
and why the ownership scope is wrong. Keep this to 2-3 short paragraphs.>

## Environment

- Host/runtime/platform: `<only values actually captured; say "not captured" once if none>`
- Affected package: `<observed runtime version, or "runtime not captured; inspected public manifest declares <version>">`
- Effective configuration: `<relevant flags, protocol, transport, or mode>`
- Execution topology: `<processes, consumers, owners, workers, resources, etc.>`
- Inspected upstream revision: `<include only when public and useful to reproduce or locate the code>`

Add dependency requirements or development versions only when they materially
affect the failure. Do not fill the section with unrelated `not captured` fields.

## Relevant downstream lifecycle

<Explain why the downstream action is legitimate. Use one compact call-chain
excerpt showing creation, owner identity, and individual disposal. Add another
only when it proves a distinct material claim that this excerpt and concise
prose do not already establish.>

```ts
// downstream/path/to/lifecycle.ts
<focused creation-to-cleanup call chain>
```

## Root cause in <affected package>

<Explain the upstream state scope and the exact call that broadens cleanup. Use
one focused excerpt showing the scoped API and unscoped call site. Add another
only under the same distinct-material-claim rule. Before delivery, name the
claim each public code block proves and remove any block whose claim is already
established.>

```ts
// upstream/path/to/state-and-cleanup.ts
<state scope, scoped operation, and broad call site>
```

## Observed diagnostics

```text
<first exact failure>
<terminal retry message>
```

<Add only structured fields needed to interpret that sequence. State which
details are verified and which are inferred. Redact secrets and private payloads.>

## Reproduction

1. <Minimum setup and configuration.>
2. <Create the minimum number of owners/resources.>
3. <Ensure both resources are active/reusable.>
4. <Dispose or evict one owner.>
5. <Observe unintended impact on the unrelated resource or owner.>

Explain naturally whether concurrency or stress is causal, required to reproduce,
merely an amplifier, or irrelevant, and why. If this is a proposed source-level
reproduction rather than an executed one, say so.

## Expected behavior

- <Target owner's resource is cleaned up exactly once.>
- <Unrelated resources remain available and reusable.>
- <Other owner-specific cleanup still runs.>

## Actual behavior

- <Cleanup affects broader/global state.>
- <Peer or unrelated-owner operations fail, restart, reconnect, or become invalid.>
- <User-visible impact and retry behavior.>

## Suggested fix

<Name the existing owner identifier and thread it through the mutation or cleanup path. Keep
the proposal narrow and avoid redesigning unrelated code.>

Show only the minimal changed call or pseudocode needed to communicate the scoped
operation. Call out other shutdown paths only when they can cause the same bug.

## Regression test

Create resources A and B, then prove:

- A and B exist before the action;
- shutting down A closes/removes A exactly once;
- B is not closed and remains reusable;
- later shutdown of B closes B exactly once.

## Temporary downstream mitigation

<Describe the current reversible workaround, its exact scope, validation, and
removal condition. **Name at least one concrete cost** such as lost functionality,
reduced fidelity or reuse, latency or throughput impact, reliability risk, or
operational burden. Scope and removal timing do not count as trade-offs. **This
section MUST explicitly contain all four fields—scope, validation, concrete cost,
and removal condition. Do not rely on another section to supply one.**>
````

## Final presentation shape

Use this response shape around the filled draft. Render the issue body directly
as Markdown; **do not wrap the whole body in a code fence**, because its focused
source excerpts already use fences.

```text
### Diagnosis

<2-4 sentences: root cause, ownership boundary, and confidence.>

### Temporary mitigation

- Changed: `<owned path/behavior>`
- Trade-off: `<what is slower/reduced/different>`
- Validation: `<commands and results>`
- Removal condition: `<upstream version/fix condition>`

### Upstream issue draft

**Title**

`[component] precise failure title`

**Body**

<the fully filled issue body above>
```
