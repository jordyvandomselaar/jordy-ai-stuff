// OAuth auth config template — copy to <skill>/src/<sdk-dir>/config.ts
// alongside client-fetch.ts (copied as client.ts) and oauth.ts.
// getValidAccessToken() transparently refreshes expired tokens; run
// "npx tsx <sdk-dir>/oauth.ts login" once to obtain the initial tokens.
import type { AuthInput } from "./client.js";
import { getValidAccessToken } from "./oauth.js";

export async function getAuth(): Promise<AuthInput> {
  return getValidAccessToken();
}
