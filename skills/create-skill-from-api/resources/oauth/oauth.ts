// OAuth 2.0 helper template (authorization code + PKCE) — copy to
// <skill>/src/<sdk-dir>/oauth.ts and keep it in the generated skill so tokens
// can be refreshed and re-issued later.
//
// CLI (run from <skill>/src):
//   npx tsx <sdk-dir>/oauth.ts login    interactive browser login, stores tokens
//   npx tsx <sdk-dir>/oauth.ts status   shows token presence/expiry (never values)
//
// Secrets policy:
// - Client id/secret come from env vars injected at runtime (1Password
//   `op run` or a git-ignored env file). Never hardcode them here.
// - The token cache (.oauth-tokens.json, written next to this file) must be
//   git-ignored BEFORE the first login; verify with `git check-ignore`.
// - Never print token or secret values; status output is metadata only.
import crypto from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

// TODO: fill in from the provider's OAuth documentation.
const AUTHORIZATION_URL = "https://auth.example.com/oauth/authorize";
const TOKEN_URL = "https://auth.example.com/oauth/token";
const SCOPES: readonly string[] = [];
// Keep PKCE on unless the provider rejects code_challenge.
const USE_PKCE = true;

// TODO: name the env vars after the app. The redirect URI below must be
// registered on the OAuth app the user creates with the provider.
const CLIENT_ID_ENV_VAR = "EXAMPLE_APP_OAUTH_CLIENT_ID";
const CLIENT_SECRET_ENV_VAR = "EXAMPLE_APP_OAUTH_CLIENT_SECRET";

const REDIRECT_PORT = 8973;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const EXPIRY_MARGIN_MS = 60_000;

const tokenFilePath = path.join(path.dirname(fileURLToPath(import.meta.url)), ".oauth-tokens.json");

interface StoredTokens {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt?: number;
}

interface TokenEndpointResponse {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
}

function getClientId(): string {
  const clientId = process.env[CLIENT_ID_ENV_VAR];
  if (clientId === undefined || clientId === "") {
    throw new Error(
      `Missing ${CLIENT_ID_ENV_VAR}. Inject it at runtime (1Password \`op run\` or a git-ignored env file); never commit it.`,
    );
  }
  return clientId;
}

async function readStoredTokens(): Promise<StoredTokens | null> {
  try {
    return JSON.parse(await readFile(tokenFilePath, "utf8")) as StoredTokens;
  } catch {
    return null;
  }
}

async function writeStoredTokens(tokens: StoredTokens): Promise<void> {
  await writeFile(tokenFilePath, `${JSON.stringify(tokens, null, 2)}\n`);
  await chmod(tokenFilePath, 0o600);
}

async function requestTokens(grantParameters: Readonly<Record<string, string>>): Promise<StoredTokens> {
  const body = new URLSearchParams({ client_id: getClientId(), ...grantParameters });
  // Public PKCE clients have no secret; confidential clients must set it.
  const clientSecret = process.env[CLIENT_SECRET_ENV_VAR];
  if (clientSecret !== undefined && clientSecret !== "") {
    body.set("client_secret", clientSecret);
  }
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`Token request failed with status ${response.status}: ${await response.text()}`);
  }
  const parsed = (await response.json()) as TokenEndpointResponse;
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresAt: parsed.expires_in === undefined ? undefined : Date.now() + parsed.expires_in * 1000,
  };
}

/** Returns a usable access token, refreshing it first when expired. */
export async function getValidAccessToken(): Promise<string> {
  const stored = await readStoredTokens();
  if (stored === null) {
    throw new Error(`No OAuth tokens stored at ${tokenFilePath}. Run: npx tsx oauth.ts login`);
  }
  if (stored.expiresAt === undefined || Date.now() < stored.expiresAt - EXPIRY_MARGIN_MS) {
    return stored.accessToken;
  }
  if (stored.refreshToken === undefined) {
    throw new Error("Access token expired and no refresh token is stored. Run: npx tsx oauth.ts login");
  }
  const refreshed = await requestTokens({
    grant_type: "refresh_token",
    refresh_token: stored.refreshToken,
  });
  const merged: StoredTokens = {
    ...refreshed,
    // Some providers omit the refresh token on refresh; keep the old one.
    refreshToken: refreshed.refreshToken ?? stored.refreshToken,
  };
  await writeStoredTokens(merged);
  return merged.accessToken;
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

async function waitForCallback(expectedState: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const url = new URL(request.url ?? "/", REDIRECT_URI);
      if (url.pathname !== "/callback") {
        response.writeHead(404).end();
        return;
      }
      const finish = (statusCode: number, message: string): void => {
        response.writeHead(statusCode, { "content-type": "text/html" });
        response.end(`<html><body><p>${message}</p></body></html>`);
        server.close();
        clearTimeout(timeout);
      };
      const error = url.searchParams.get("error");
      if (error !== null) {
        finish(400, "Login failed. You can close this tab.");
        reject(new Error(`Authorization failed: ${error} ${url.searchParams.get("error_description") ?? ""}`));
        return;
      }
      const code = url.searchParams.get("code");
      if (code === null || url.searchParams.get("state") !== expectedState) {
        finish(400, "Invalid callback. You can close this tab.");
        reject(new Error("Callback missing code or state mismatch."));
        return;
      }
      finish(200, "Login complete. You can close this tab.");
      resolve(code);
    });
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for the OAuth callback."));
    }, LOGIN_TIMEOUT_MS);
    server.listen(REDIRECT_PORT, "127.0.0.1");
  });
}

async function login(): Promise<void> {
  const state = base64Url(crypto.randomBytes(16));
  const verifier = base64Url(crypto.randomBytes(32));
  const authorizationUrl = new URL(AUTHORIZATION_URL);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", getClientId());
  authorizationUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authorizationUrl.searchParams.set("state", state);
  if (SCOPES.length > 0) {
    authorizationUrl.searchParams.set("scope", SCOPES.join(" "));
  }
  if (USE_PKCE) {
    authorizationUrl.searchParams.set("code_challenge", base64Url(crypto.createHash("sha256").update(verifier).digest()));
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
  }

  console.log("Open this URL in your browser to log in:\n");
  console.log(authorizationUrl.toString());
  console.log(`\nWaiting for the callback on ${REDIRECT_URI} ...`);

  const code = await waitForCallback(state);
  const tokens = await requestTokens({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    ...(USE_PKCE ? { code_verifier: verifier } : {}),
  });
  await writeStoredTokens(tokens);
  console.log(`Login successful. Tokens stored in ${tokenFilePath} (keep this file git-ignored).`);
}

async function status(): Promise<void> {
  const stored = await readStoredTokens();
  if (stored === null) {
    console.log(`No tokens stored at ${tokenFilePath}. Run: npx tsx oauth.ts login`);
    return;
  }
  const expiry =
    stored.expiresAt === undefined
      ? "no recorded expiry"
      : `${Date.now() < stored.expiresAt ? "expires" : "expired"} at ${new Date(stored.expiresAt).toISOString()}`;
  console.log(`Tokens stored (${expiry}, refresh token ${stored.refreshToken === undefined ? "absent" : "present"}).`);
}

const isRunDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isRunDirectly) {
  const command = process.argv[2];
  if (command === "login") {
    await login();
  } else if (command === "status") {
    await status();
  } else {
    console.error("Usage: npx tsx oauth.ts <login|status>");
    process.exitCode = 1;
  }
}
