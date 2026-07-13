import { describe, expect, test } from "bun:test"
import {
  resolveUltraContext,
  type UltraContextModel,
} from "./ultra-context.ts"

const sol: UltraContextModel = {
  api: "openai-codex-responses",
  id: "gpt-5.6-sol",
  provider: "openai-codex",
}

describe("Ultra context", () => {
  test.each(
    [
      ["enabled Sol", sol, true, "ultra"],
      ["enabled Terra", { ...sol, id: "gpt-5.6-terra" }, true, "ultra"],
      ["disabled Sol", sol, false, "explicit"],
      ["different provider", { ...sol, provider: "anthropic" }, true, "ultra"],
      ["different API", { ...sol, api: "google-generative-ai" }, true, "ultra"],
      ["different model", { ...sol, id: "claude-opus-4-1" }, true, "ultra"],
      ["missing model", undefined, true, "unsupported"],
    ] satisfies Array<[
      string,
      UltraContextModel | undefined,
      boolean,
      ReturnType<typeof resolveUltraContext>["kind"],
    ]>,
  )(
    "%s",
    (_name, model, ultraEnabled, expectedKind) => {
      const context = resolveUltraContext(model, ultraEnabled)

      expect(context.kind).toBe(expectedKind)
    },
  )
})
