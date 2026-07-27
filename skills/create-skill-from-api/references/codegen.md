# Generating the SDK

## Input contract: Swagger 2.0 only

`generate.ts` reads `<new-skill>/resources/swagger.json` and it must be **Swagger 2.0 JSON**. Never fork the generator per docs format — convert the docs instead:

- **OpenAPI 3.x** → convert to Swagger 2.0 and save as `resources/swagger.json`, keeping the original as `resources/original-openapi.json`. Mapping: `components.schemas` → `definitions` (`#/components/schemas/X` refs → `#/definitions/X`), `requestBody` → a `body` parameter with a `schema`, `responses.<code>.content.application/json.schema` → `responses.<code>.schema`, `servers[0].url` → `host` + `basePath` + `schemes`, `nullable`/`oneOf` → closest Swagger 2.0 equivalent (drop to plain type if needed). Write a small one-off conversion script rather than editing by hand when the spec is large.
- **HTML docs, Postman collections, markdown** → hand-build a minimal Swagger 2.0 document covering the endpoints the user actually needs (paths, methods, parameters with `in`, response schemas). Smaller but accurate beats complete but guessed.

## Assess spec quality before generating

Report findings to the user:

```bash
jq '.paths | length' resources/swagger.json          # path count
jq '[.paths[] | keys[]] | length' resources/swagger.json  # operation count
jq '[.definitions[] | select(.properties == null)] | length' resources/swagger.json  # hollow schemas
```

- **Hollow definitions** (`{"type":"object","title":"X"}` with no properties) become `Record<string, unknown>` outputs — warn the user that output typing will be weak and real shapes must be verified live.
- Check parameters use sane `in` locations and that success responses carry schemas.

## Copy and configure

Copy `resources/codegen/generate.ts` → `src/<sdk-dir>/generate.ts`, then set:

- `ENABLED_CATEGORIES` — from the user's answer to the action-categories question (read = GET, create = POST, update = PUT/PATCH, delete = DELETE). Read-only is the default; never enable write categories the user didn't ask for.
- Verify `swaggerPath` resolves (`../../resources/swagger.json` relative to the script).

Run from `<new-skill>/src`:

```bash
npx tsx <sdk-dir>/generate.ts
```

It regenerates `types.ts`, `actions/` (one kebab-case file per operation with `<Name>Args`/`<Name>Output` and required-argument validation), and the `index.ts` barrel. Safe to re-run any time.

Handled automatically (warnings on stderr): path params misdeclared as query params or missing entirely (springfox), `Iterable«X»` rendered as `X[]`, function/file name collisions (suffixed), skipped operations (form-data params, GET-with-body).

## Typing rules

Use every type the spec provides — enums become literal unions, `$ref`s become named types, bodies and outputs are typed from schemas. Only where the spec has no type information may `unknown` (or `Record<string, unknown>`) appear. `any` is never allowed, including in one-off scripts.

## Verify

1. `npx tsc --noEmit` from `src/` must be clean.
2. Smoke-test with a harmless read (e.g. a "current user" endpoint) through the generated action + `getAuth()`, projecting a couple of fields. Use a real script file — `tsx -e` runs CJS (no top-level await) and skips type-checking.
3. Expect broken endpoints in real APIs: the spec documents them, the server 400/500s anyway. Only live calls tell the truth; record confirmed dead ends in the generated skill's references so future agents don't retry them.
