# Setup: plain-fetch transport

Use when the user manages authentication themselves (no Zapier SDK).

## Install

All code lives in `<new-skill>/src`. Ask the user for approval before installing anything, then:

```bash
cd <new-skill>/src
touch .gitignore
grep -qxF "node_modules/" .gitignore || printf "node_modules/\n" >> .gitignore
[ -f package.json ] || npm init -y
npm install -D typescript tsx @types/node
```

If `.gitignore` already exists, preserve its contents and only add `node_modules/` if missing.

Add a strict `tsconfig.json` (`"strict": true`, `"module": "nodenext"`, `"target": "es2022"`). Set `"type": "module"` in package.json.

## Ask about auth (required)

1. **ASK the auth type**: API key / OAuth 2.0 / static bearer token / basic / none.
2. **ASK the placement** whenever the API docs don't make it unambiguous: which header name and prefix (`Authorization: Bearer <x>`, `X-Api-Key: <x>`, ...), or which query parameter (`?api_key=<x>`). Not every API uses bearer tokens.

Copy `resources/codegen/client-fetch.ts` → `src/<sdk-dir>/client.ts`; set `BASE_URL` and map the answers onto `AUTH_SCHEME` (`header` / `query` / `basic` / `none`).

## Secrets policy (non-negotiable)

- API keys, OAuth client ids/secrets, and tokens are **never committed to git**. Before writing any secret-adjacent file (`.env`, `.oauth-tokens.json`), add it to `.gitignore` and verify with `git check-ignore <file>`.
- Suggest the user pick one storage setup:
  1. **1Password service account** with a dedicated vault for the agent — secrets resolved at runtime with `op run --env-file=.env -- <command>` using secret references (`op://Vault/Item/field`) in the env file, so no plaintext values exist on disk.
  2. **Env vars in a git-ignored file** (e.g. `src/.env`) loaded into the process at runtime.
- **Never read or print secret values.** Don't cat env files with plaintext secrets, don't echo keys, don't paste them into code, docs, logs, or chat. The user puts values in place; scripts read them from `process.env` only.

## Per auth type

**API key / static bearer** — copy `config-api-key.ts` → `config.ts`; name the env var after the app (e.g. `LINEAR_API_KEY`). Tell the user where to put the key (vault item or git-ignored env file); never place it yourself.

**Basic** — same as API key, but store `user:password` in the env var and set `AUTH_SCHEME` to `{ kind: "basic" }`.

**OAuth 2.0** — copy `resources/oauth/oauth.ts` → `src/<sdk-dir>/oauth.ts` and `config-oauth.ts` → `config.ts`, then:

1. Git-ignore `.oauth-tokens.json` **before** the first login; verify with `git check-ignore`.
2. Fill the TODOs: `AUTHORIZATION_URL`, `TOKEN_URL`, `SCOPES`, env var names. PKCE stays on unless the provider rejects `code_challenge`.
3. Walk the user through creating an OAuth app with the provider; the registered redirect URI must be exactly `http://127.0.0.1:8973/callback`. Client id/secret go into their chosen secret storage.
4. Run `npx tsx <sdk-dir>/oauth.ts login` and have the user open the printed URL. Tokens land in `.oauth-tokens.json` (chmod 600). `npx tsx <sdk-dir>/oauth.ts status` shows metadata only, never values.
5. `getValidAccessToken()` refreshes expired tokens automatically. `oauth.ts` ships with the generated skill so future agents can refresh and re-login.

**None** — write a `config.ts` whose `getAuth()` returns `""` and set `AUTH_SCHEME` to `{ kind: "none" }`.
