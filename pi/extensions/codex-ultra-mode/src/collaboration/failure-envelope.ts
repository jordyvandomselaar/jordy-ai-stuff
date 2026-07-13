const MAX_ERROR_BYTES = 4_000
const TRUNCATION_MARKER = "\n…[error truncated]"

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value
  let bytes = 0
  let result = ""
  for (const codePoint of value) {
    const size = Buffer.byteLength(codePoint)
    if (bytes + size > maxBytes) break
    result += codePoint
    bytes += size
  }
  return `${result}${TRUNCATION_MARKER}`
}

export function failureEnvelope(error: string): string {
  const guidance = "\n\nSend a follow-up task to retry or continue the work."
  const prefix = "Agent failed: "
  const budget = MAX_ERROR_BYTES - Buffer.byteLength(prefix + guidance + TRUNCATION_MARKER)
  return `${prefix}${truncateUtf8(error, budget)}${guidance}`
}
