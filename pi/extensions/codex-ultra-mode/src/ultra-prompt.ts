import { MULTI_AGENT_MODE_MARKERS } from "./ultra-contract.ts"

export function removeUltraPromptBlock(content: string): string {
  const pattern = new RegExp(
    `${MULTI_AGENT_MODE_MARKERS.open}[\\s\\S]*?${MULTI_AGENT_MODE_MARKERS.close}`,
    "g",
  )
  return content.replace(pattern, "")
}
