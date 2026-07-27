---
name: create-skill-from-api
description: Build a new agent skill that wraps an HTTP API behind a strictly-typed, code-generated TypeScript SDK. Use when the user asks to "create a skill from an API", "build a skill for the <app> API", "wrap this API in a skill", or wants a typed SDK generated from Swagger/OpenAPI docs plus documented example workflows. Covers docs intake, Swagger conversion, Zapier SDK or self-managed auth (API key, OAuth 2.0, basic), CRUD category selection, SDK codegen, and authoring the final skill. Not for one-off API calls, and not for skills that don't wrap an HTTP API (use create-skills directly for those).
---

# Create a Skill from an API

Turn any HTTP API into a skill containing a working typed SDK, verified example workflows, and usage docs. Everything is driven by proven templates in `resources/` — copy and configure them; don't reinvent them.

## Hard rules

- **Ask, don't assume.** Every step marked ASK below requires an explicit user answer before proceeding.
- **Never run a workflow verification without per-flow permission.** Before live-testing each individual example workflow, ask the user for permission for that specific flow — flows may create, modify, or delete real data. A blanket "yes" for one flow does not cover the next.
- **Read-only by default.** Only enable create/update/delete generation when the user explicitly chose those categories.
- **Strict typing.** Use every type the API spec provides. Only where the spec lacks type information may `unknown` appear. `any` is never allowed.
- **Secrets are never committed to git and never read by the agent.** Keys, OAuth client config, and tokens live in a 1Password service-account vault or a git-ignored env file, injected into processes at runtime (`op run` / env loading). Never print, cat, or paste secret values anywhere. Git-ignore secret files (and verify with `git check-ignore`) before they exist.
- **Ask approval before installing npm packages.**
- **Never commit installed dependencies.** Before any npm install step, create or update `<new-skill>/src/.gitignore` so it contains `node_modules/` exactly once.
- **Scrub personal data** (colleague names, ids, emails) from everything written into the generated skill.
- **Verify before documenting.** References in the generated skill describe only behavior confirmed by a live call (with permission), including confirmed-broken endpoints as do-not-retry notes.

## Workflow

1. **Docs intake (ASK)** — ask whether the agent should find the API docs itself (probe well-known paths like `/swagger.json`, `/openapi.json`, `/api-docs`, and the developer docs site) or the user provides a link. Also ask what the new skill should be named.
2. **Fetch docs** — store them in `<new-skill>/resources/`. The generator only accepts Swagger 2.0 JSON; convert anything else first. Assess spec quality and report. See `references/codegen.md`.
3. **Auth strategy (ASK)** — ask whether to use the Zapier SDK or the user manages auth themselves; route via the table below. For self-managed auth, also ask the auth type and where the credential goes (header/query/basic).
4. **Action categories (ASK)** — ask which categories the skill needs: read, create, update, delete (any combination). Map to `ENABLED_CATEGORIES` in the generator.
5. **Generate the SDK** — copy the codegen templates into `<new-skill>/src/<sdk-dir>/`, fill the TODOs, run the generator, and verify (`tsc --noEmit` + harmless-read smoke test). See `references/codegen.md`.
6. **Example workflows (ASK)** — ask the user which common workflows the skill should document. For each one: ask permission to verify that specific flow live, implement it with the generated SDK, then write `<new-skill>/references/<workflow>.md` with the verified call chain, output shapes, and dead ends. Skip live verification (and say the doc is unverified) if permission is declined.
7. **Author the skill** — write the generated skill's SKILL.md and validate everything using the bundled create-skills skill at `references/create-skills/SKILL.md` (router pattern, frontmatter rules, checklists).

## Router

| Situation | Read |
|---|---|
| User wants to use Zapier SDK | `references/setup-zapier-sdk.md` |
| User does not want to use Zapier SDK (API key, OAuth, basic, none) | `references/setup-plain-fetch.md` |
| Converting docs to Swagger 2.0, configuring/running the generator | `references/codegen.md` |
| Writing and validating the final SKILL.md | `references/create-skills/SKILL.md` |

## Templates in resources/

| File | Copy to | Purpose |
|---|---|---|
| `codegen/generate.ts` | `src/<sdk-dir>/generate.ts` | Swagger 2.0 → typed actions/types/barrel; `ENABLED_CATEGORIES` config |
| `codegen/client-zapier.ts` | `src/<sdk-dir>/client.ts` | Transport via `zapier.fetch` + authenticationId |
| `codegen/client-fetch.ts` | `src/<sdk-dir>/client.ts` | Transport via plain `fetch` + `AUTH_SCHEME` (header/query/basic/none) |
| `codegen/config-zapier.ts` | `src/<sdk-dir>/config.ts` | Resolves the connection id via `findFirstConnection` (timeout-guarded, rename guidance on mismatch) |
| `codegen/config-api-key.ts` | `src/<sdk-dir>/config.ts` | API key / static bearer / basic from an env var |
| `codegen/config-oauth.ts` | `src/<sdk-dir>/config.ts` | Auth via `getValidAccessToken()` |
| `oauth/oauth.ts` | `src/<sdk-dir>/oauth.ts` | OAuth login server (PKCE), token cache, auto-refresh, `login`/`status` CLI |

Both clients expose the same surface (`apiFetch`, `AuthInput`, `assertRequiredArguments`, `ApiRequestError`, `ApiValidationError`), so generated actions are transport-agnostic. All configs expose `getAuth(): Promise<AuthInput>`.

## Generated skill layout

```
<skill-name>/
  SKILL.md                    # router: how the SDK works, topic table, pitfalls
  references/<workflow>.md    # one per verified workflow
  resources/swagger.json      # + original docs if converted
  src/
    .gitignore  package.json  tsconfig.json
    <sdk-dir>/
      generate.ts  client.ts  config.ts  [oauth.ts]
      types.ts  index.ts  actions/      # generated; re-run generate.ts to refresh
```

The generated SKILL.md must tell agents to import actions from `./src/<sdk-dir>/index.ts` (one file per action in `./src/<sdk-dir>/actions/`), to run scripts from `src/` with `npx tsx <file>` (real files — `tsx -e` is CJS and unchecked), how `getAuth()` works, and that `fields` projection keeps outputs small.

## Pitfalls

- `zapier.findFirstConnection({ title })` hangs forever without an exact-case match — the Zapier config races it against a timeout and, on timeout, uses a `listConnections()` scan only to identify the mis-titled connection. The resulting error is agent-facing: relay it in chat and ask the user to rename the connection to the exact title before retrying. Keep the timeout guard.
- Real APIs have endpoints their spec documents but their server breaks (400/500 regardless of params). Only live calls tell the truth.
- Hollow spec schemas (no properties) mean weakly-typed outputs: verify real shapes live and record them in the workflow references.
