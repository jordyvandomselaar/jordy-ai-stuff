import type {
  Extension,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent"

const CODEX_CONVERSION_EXTENSION_MARKER = "pi-codex-conversion"
const CODEX_PREWARM_EVENTS = [
  "session_start",
  "model_select",
  "before_agent_start",
] as const
const CHILD_PREWARM_DISABLED = {
  ok: false,
  error: "Cached WebSocket prewarm is disabled for Ultra child sessions",
} as const

type ChildExtensionResources = {
  extensions: Array<Pick<Extension, "handlers" | "path" | "resolvedPath">>
}

function isCodexConversionExtension(
  extension: ChildExtensionResources["extensions"][number],
): boolean {
  return extension.path.includes(CODEX_CONVERSION_EXTENSION_MARKER)
    || extension.resolvedPath.includes(CODEX_CONVERSION_EXTENSION_MARKER)
}

function withoutCachedWebSocketPrewarm(ctx: ExtensionContext): ExtensionContext {
  const modelRegistry = new Proxy(ctx.modelRegistry, {
    get(target, property) {
      if (property === "getApiKeyAndHeaders") {
        return async () => CHILD_PREWARM_DISABLED
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  return new Proxy(ctx, {
    get(target, property, receiver) {
      return property === "modelRegistry"
        ? modelRegistry
        : Reflect.get(target, property, receiver)
    },
  })
}

export function disableChildCachedWebSocketPrewarm(
  resources: ChildExtensionResources,
): void {
  // Child actors share extension modules in one process. Cached WebSocket
  // prewarming would create one connection per actor and share its cache across
  // otherwise isolated sessions, so child provider traffic stays on SSE.
  for (const extension of resources.extensions) {
    if (!isCodexConversionExtension(extension)) continue

    for (const eventType of CODEX_PREWARM_EVENTS) {
      const handlers = extension.handlers.get(eventType)
      if (handlers === undefined) continue
      extension.handlers.set(eventType, handlers.map((handler) => async (...args: unknown[]) => {
        const ctx = args[1] as ExtensionContext
        return handler(args[0], withoutCachedWebSocketPrewarm(ctx))
      }))
    }
  }
}
