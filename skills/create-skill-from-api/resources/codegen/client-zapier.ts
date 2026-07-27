// Zapier SDK transport template — copy to <skill>/src/<sdk-dir>/client.ts when
// the user wants authentication managed by the Zapier SDK.
// Pair it with config-zapier.ts (copied as config.ts).
import { createZapierSdk } from "@zapier/zapier-sdk";

export const zapier = createZapierSdk();

// TODO: host + basePath from the spec, no trailing slash.
const BASE_URL = "https://api.example.com";

/** Zapier authentication id, resolved by getAuth() in config.ts. */
export type AuthInput = string;

export type QueryParameterValue =
  | string
  | number
  | boolean
  | readonly string[]
  | readonly number[]
  | readonly boolean[]
  | undefined;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiRequest {
  auth: AuthInput;
  method: HttpMethod;
  path: string;
  query?: Readonly<Record<string, QueryParameterValue>>;
  headers?: Readonly<Record<string, string | undefined>>;
  body?: unknown;
  fields?: readonly string[] | null;
}

export class ApiValidationError extends Error {
  readonly actionName: string;
  readonly missingNames: readonly string[];

  constructor({ actionName, missingNames }: { actionName: string; missingNames: readonly string[] }) {
    super(`${actionName}: missing required argument(s): ${missingNames.join(", ")}`);
    this.name = "ApiValidationError";
    this.actionName = actionName;
    this.missingNames = missingNames;
  }
}

export function assertRequiredArguments<TArgs extends object>(
  actionName: string,
  args: TArgs | undefined,
  requiredNames: readonly (keyof TArgs & string)[],
): void {
  if (typeof args !== "object" || args === null) {
    throw new ApiValidationError({
      actionName,
      missingNames: requiredNames.length > 0 ? requiredNames : ["args"],
    });
  }
  const missingNames = requiredNames.filter((name) => args[name] === undefined || args[name] === null);
  if (missingNames.length > 0) {
    throw new ApiValidationError({ actionName, missingNames });
  }
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly method: HttpMethod;
  readonly url: string;
  readonly responseBody: string;

  constructor({
    status,
    method,
    url,
    responseBody,
  }: {
    status: number;
    method: HttpMethod;
    url: string;
    responseBody: string;
  }) {
    super(`API request failed with status ${status}: ${method} ${url}`);
    this.name = "ApiRequestError";
    this.status = status;
    this.method = method;
    this.url = url;
    this.responseBody = responseBody;
  }
}

// Client-side projection: keeps large responses manageable without relying on
// the API supporting sparse fieldsets.
function projectFields(value: unknown, fields: readonly string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => projectFields(item, fields));
  }
  if (typeof value === "object" && value !== null && !(value instanceof ArrayBuffer)) {
    const record = value as Record<string, unknown>;
    const projected: Record<string, unknown> = {};
    for (const field of fields) {
      if (field in record) {
        projected[field] = record[field];
      }
    }
    return projected;
  }
  return value;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    return response.json();
  }
  if (contentType.startsWith("text/")) {
    return response.text();
  }
  return response.arrayBuffer();
}

export async function apiFetch<TOutput>(request: ApiRequest): Promise<TOutput> {
  const url = new URL(`${BASE_URL}${request.path}`);
  for (const [name, value] of Object.entries(request.query ?? {})) {
    if (value === undefined) {
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      url.searchParams.append(name, String(item));
    }
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    if (value !== undefined) {
      headers[name] = value;
    }
  }
  if (request.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  const response = await zapier.fetch(url, {
    method: request.method,
    authenticationId: request.auth,
    headers,
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
  });

  if (!response.ok) {
    throw new ApiRequestError({
      status: response.status,
      method: request.method,
      url: url.toString(),
      responseBody: await response.text(),
    });
  }

  const parsed = await parseResponseBody(response);
  const fields = request.fields ?? null;
  return (fields === null ? parsed : projectFields(parsed, fields)) as TOutput;
}
