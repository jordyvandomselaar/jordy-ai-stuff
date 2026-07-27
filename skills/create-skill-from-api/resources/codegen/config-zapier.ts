// Zapier auth config template — copy to <skill>/src/<sdk-dir>/config.ts
// alongside client-zapier.ts (copied as client.ts).
import { zapier, type AuthInput } from "./client.js";

// TODO: the exact title of the user's Zapier connection. If they don't have
// one yet, suggest creating an "API by Zapier" connection named
// "<App> - API by Zapier".
const AUTHENTICATION_TITLE = "<App> - API by Zapier";

// findFirstConnection's promise never settles when no exact-case title match
// exists, so it races against this timeout instead of hanging forever.
const FIND_CONNECTION_TIMEOUT_MS = 10_000;

let cachedAuthenticationId: AuthInput | null = null;

async function findConnectionIdByExactTitle(): Promise<AuthInput | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), FIND_CONNECTION_TIMEOUT_MS);
    zapier.findFirstConnection({ title: AUTHENTICATION_TITLE }).then(
      (result) => {
        clearTimeout(timeout);
        resolve(result.data?.id ?? null);
      },
      () => {
        clearTimeout(timeout);
        resolve(null);
      },
    );
  });
}

export async function getAuth(): Promise<AuthInput> {
  if (cachedAuthenticationId !== null) {
    return cachedAuthenticationId;
  }
  const exactId = await findConnectionIdByExactTitle();
  if (exactId !== null) {
    cachedAuthenticationId = exactId;
    return exactId;
  }
  // findFirstConnection is the required resolution mechanism; this scan only
  // locates a mis-titled connection so the user can rename it.
  const wantedTitle = AUTHENTICATION_TITLE.trim().toLowerCase();
  for await (const connection of zapier.listConnections().items()) {
    if (connection.title?.trim().toLowerCase() === wantedTitle) {
      throw new Error(
        `Found connection "${connection.title}", but resolving it requires the exact title ` +
          `"${AUTHENTICATION_TITLE}". The user cannot see this message — tell them in chat to rename ` +
          `the connection to exactly that title, wait for their confirmation, then retry.`,
      );
    }
  }
  throw new Error(
    `No Zapier authentication found with title "${AUTHENTICATION_TITLE}". ` +
      `Create one (e.g. an "API by Zapier" connection) with exactly that title, or update AUTHENTICATION_TITLE in config.ts.`,
  );
}
