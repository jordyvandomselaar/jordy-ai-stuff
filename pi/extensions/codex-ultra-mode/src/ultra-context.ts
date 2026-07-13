export interface UltraContextModel {
  api?: string
  id?: string
  provider?: string
}

export type UltraContext =
  | {
      kind: "unsupported"
      active: false
      supported: false
    }
  | {
      kind: "explicit"
      active: false
      supported: true
    }
  | {
      kind: "ultra"
      active: true
      supported: true
    }

export function resolveUltraContext(
  model: UltraContextModel | undefined,
  ultraEnabled: boolean,
): UltraContext {
  if (model === undefined) return { kind: "unsupported", active: false, supported: false }
  if (!ultraEnabled) return { kind: "explicit", active: false, supported: true }
  return { kind: "ultra", active: true, supported: true }
}
