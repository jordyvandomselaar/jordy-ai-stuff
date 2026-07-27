// API-key auth config template — copy to <skill>/src/<sdk-dir>/config.ts
// alongside client-fetch.ts (copied as client.ts). Also works for static
// bearer tokens and basic auth (store "user:password" in the env var).
//
// Secrets policy: the key is injected into the process environment at runtime
// (1Password `op run` or a git-ignored env file). It is never committed to
// git, and agents never read or print its value.
import type { AuthInput } from "./client.js";

// TODO: name the env var after the app, e.g. EXAMPLE_APP_API_KEY.
const API_KEY_ENV_VAR = "EXAMPLE_APP_API_KEY";

export async function getAuth(): Promise<AuthInput> {
  const apiKey = process.env[API_KEY_ENV_VAR];
  if (apiKey === undefined || apiKey === "") {
    throw new Error(
      `Missing ${API_KEY_ENV_VAR}. Inject it at runtime, e.g. ` +
        `"op run --env-file=.env -- npx tsx <script>" (1Password) or by loading a git-ignored .env file. ` +
        `Never commit the key or paste it into files.`,
    );
  }
  return apiKey;
}
