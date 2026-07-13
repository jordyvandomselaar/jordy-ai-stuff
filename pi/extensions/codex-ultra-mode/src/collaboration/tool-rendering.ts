import { Text } from "@earendil-works/pi-tui"

const PREVIEW_LENGTH = 72
const RESULT_TEXT_LENGTH = 1_000
const EXPANDED_DETAILS_LENGTH = 2_000

export interface CollaborationTheme {
  bold(text: string): string
  fg(color: "dim" | "error" | "muted" | "success" | "toolTitle" | "warning", text: string): string
}

function preview(value: unknown): string {
  if (typeof value !== "string") return ""
  const compact = value.replace(/\s+/g, " ").trim()
  return compact.length <= PREVIEW_LENGTH
    ? compact
    : `${compact.slice(0, PREVIEW_LENGTH - 1)}…`
}

function boundedResult(value: string): string {
  return value.length <= RESULT_TEXT_LENGTH
    ? value
    : `${value.slice(0, RESULT_TEXT_LENGTH - 14)}\n… [truncated]`
}

function argumentSummary(args: Record<string, unknown>): string {
  const target = preview(args.target ?? args.task_name ?? args.path_prefix)
  const message = preview(args.message)
  return [target, message ? `“${message}”` : ""].filter(Boolean).join(" ")
}

export function renderCollaborationCall(
  label: string,
  args: Record<string, unknown>,
  theme: CollaborationTheme,
): Text {
  const summary = argumentSummary(args)
  const content = theme.fg("toolTitle", theme.bold(label))
    + (summary ? ` ${theme.fg("muted", summary)}` : "")
  return new Text(content, 0, 0)
}

export function renderCollaborationResult(
  toolName: string,
  content: readonly { type: string; text?: string }[],
  details: unknown,
  options: { expanded: boolean; isError: boolean; isPartial: boolean },
  theme: CollaborationTheme,
): Text {
  if (options.isPartial) return new Text(theme.fg("warning", "Working…"), 0, 0)
  const text = boundedResult(
    content.flatMap((block) => typeof block.text === "string" ? [block.text] : []).join("\n").trim(),
  )
  if (options.isError) {
    return new Text(theme.fg("error", text || "Collaboration operation failed"), 0, 0)
  }

  const acknowledgement = toolName === "send_message"
    ? "✓ Message delivered"
    : toolName === "followup_task"
      ? "✓ Follow-up delivered"
      : text || "✓ Done"
  let output = theme.fg("success", acknowledgement)
  if (options.expanded && details !== undefined) {
    const fullDetails = JSON.stringify(details, null, 2) ?? String(details)
    const serialized = fullDetails.length <= EXPANDED_DETAILS_LENGTH
      ? fullDetails
      : `${fullDetails.slice(0, EXPANDED_DETAILS_LENGTH - 14)}\n… [truncated]`
    if (serialized && serialized !== "{}") output += `\n${theme.fg("dim", serialized)}`
  }
  return new Text(output, 0, 0)
}
