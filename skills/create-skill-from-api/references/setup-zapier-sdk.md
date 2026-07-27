# Setup: Zapier SDK transport

Use when the user wants authentication managed by the Zapier SDK.

## Install

All code lives in `<new-skill>/src`. Ask the user for approval before installing anything, then:

```bash
cd <new-skill>/src
touch .gitignore
grep -qxF "node_modules/" .gitignore || printf "node_modules/\n" >> .gitignore
[ -f package.json ] || npm init -y
npm install @zapier/zapier-sdk
npm install -D typescript tsx @types/node
```

If `.gitignore` already exists, preserve its contents and only add `node_modules/` if missing.

Add a strict `tsconfig.json` (`"strict": true`, `"module": "nodenext"`, `"target": "es2022"`). Set `"type": "module"` in package.json.

If any Zapier SDK call fails with an authentication error, stop and report it to the user — do not work around it.

## Wire up the templates

1. Copy `resources/codegen/client-zapier.ts` → `src/<sdk-dir>/client.ts`; set `BASE_URL` (host + basePath from the spec, no trailing slash).
2. Copy `resources/codegen/config-zapier.ts` → `src/<sdk-dir>/config.ts`.
3. **ASK the user for the title of their Zapier connection** for this app. If they don't have one, suggest creating an "API by Zapier" connection named `<App> - API by Zapier` and have them confirm the title. Put it in `AUTHENTICATION_TITLE`.

`getAuth()` resolves the connection id with `zapier.findFirstConnection({ title })` — that is the required mechanism, and it needs the title to match exactly (case included). Because its promise never settles when there is no exact-case match, the template races it against a timeout; on timeout it scans `listConnections()` only to locate a mis-titled connection and then throws. The user never sees script output — when that error fires, relay it in chat: tell the user which connection to rename and to what exact title, wait for their confirmation, then retry. Keep the timeout guard — without it a title mismatch kills the process silently.

## Verify

Run a script (real file, not `tsx -e`) that calls `getAuth()` and prints the resolved id. If it throws, the connection title is wrong or the connection doesn't exist yet.
