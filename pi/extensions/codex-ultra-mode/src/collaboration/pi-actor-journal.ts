import type { SessionEntry } from "@earendil-works/pi-coding-agent"
import type { PersistedAgentRecord } from "./coordinator-contracts.ts"
import type {
  PersistedPiActorState,
  PiActorPersistence,
} from "./pi-actor-contracts.ts"
import { persistedActorState } from "./pi-runtime.ts"

const DEFINITION_ENTRY = "codex-ultra-actor-definition"
const LIFECYCLE_ENTRY = "codex-ultra-actor-lifecycle"
const MESSAGE_ENTRY = "codex-ultra-actor-message"
const RUNTIME_ENTRY = "codex-ultra-actor-runtime"

interface ActorJournalWriter {
  appendCustomEntry(customType: string, data?: unknown): string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function definition(
  entry: SessionEntry,
): Pick<PersistedAgentRecord, "context" | "parentPath" | "path"> | undefined {
  if (entry.type !== "custom" || entry.customType !== DEFINITION_ENTRY) return undefined
  const data = entry.data
  if (
    !isRecord(data)
    || typeof data.path !== "string"
    || typeof data.parentPath !== "string"
    || !isRecord(data.context)
    || !Array.isArray(data.context.history)
    || !isRecord(data.context.initialInput)
  ) return undefined
  return data as Pick<PersistedAgentRecord, "context" | "parentPath" | "path">
}

function lifecycle(
  entry: SessionEntry,
): Pick<PersistedAgentRecord, "latestTask" | "path" | "status"> | undefined {
  if (entry.type !== "custom" || entry.customType !== LIFECYCLE_ENTRY) return undefined
  const data = entry.data
  if (
    !isRecord(data)
    || typeof data.path !== "string"
    || (data.latestTask !== null && typeof data.latestTask !== "string")
    || !isRecord(data.status)
    || typeof data.status.kind !== "string"
  ) return undefined
  return data as Pick<PersistedAgentRecord, "latestTask" | "path" | "status">
}

function message(entry: SessionEntry): {
  message: PersistedPiActorState["messages"][number]
  path: string
  sequence: number
} | undefined {
  if (entry.type !== "custom" || entry.customType !== MESSAGE_ENTRY) return undefined
  const data = entry.data
  if (
    !isRecord(data)
    || typeof data.path !== "string"
    || !Number.isSafeInteger(data.sequence)
    || (data.sequence as number) < 0
    || !isRecord(data.message)
  ) return undefined
  return {
    path: data.path,
    sequence: data.sequence as number,
    message: data.message as PersistedPiActorState["messages"][number],
  }
}

function runtime(entry: SessionEntry): {
  path: string
  runtime: PersistedPiActorState["runtime"]
} | undefined {
  if (entry.type !== "custom" || entry.customType !== RUNTIME_ENTRY) return undefined
  const data = entry.data
  if (!isRecord(data) || typeof data.path !== "string") return undefined
  const state = persistedActorState({ version: 5, messages: [], runtime: data.runtime })
  return state === undefined ? undefined : { path: data.path, runtime: state.runtime }
}

export class PiActorJournal implements PiActorPersistence {
  private readonly definitions = new Set<string>()
  private readonly lifecycleFingerprints = new Map<string, string>()
  private readonly runtimeFingerprints = new Map<string, string>()
  private readonly sequences = new Map<string, Set<number>>()

  constructor(private readonly writer: () => ActorJournalWriter | undefined) {}

  bind(entries: readonly SessionEntry[]): void {
    this.definitions.clear()
    this.lifecycleFingerprints.clear()
    this.runtimeFingerprints.clear()
    this.sequences.clear()
    for (const entry of entries) {
      const actorDefinition = definition(entry)
      if (actorDefinition !== undefined) this.definitions.add(actorDefinition.path)
      const actorLifecycle = lifecycle(entry)
      if (actorLifecycle !== undefined) {
        this.lifecycleFingerprints.set(actorLifecycle.path, JSON.stringify(actorLifecycle))
      }
      const actorRuntime = runtime(entry)
      if (actorRuntime !== undefined) {
        this.runtimeFingerprints.set(actorRuntime.path, JSON.stringify(actorRuntime.runtime))
      }
      const actorMessage = message(entry)
      if (actorMessage !== undefined) this.messageSequences(actorMessage.path).add(actorMessage.sequence)
    }
  }

  persistAgent(record: PersistedAgentRecord): void {
    const writer = this.writer()
    if (writer === undefined) return
    if (!this.definitions.has(record.path)) {
      writer.appendCustomEntry(DEFINITION_ENTRY, {
        path: record.path,
        parentPath: record.parentPath,
        context: record.context,
      })
      this.definitions.add(record.path)
    }
    const actorLifecycle = {
      path: record.path,
      latestTask: record.latestTask,
      status: record.status,
    }
    const fingerprint = JSON.stringify(actorLifecycle)
    if (this.lifecycleFingerprints.get(record.path) === fingerprint) return
    writer.appendCustomEntry(LIFECYCLE_ENTRY, actorLifecycle)
    this.lifecycleFingerprints.set(record.path, fingerprint)
  }

  initializeActorSession(path: string, state: PersistedPiActorState): void {
    this.persistActorRuntime(path, state.runtime)
    state.messages.forEach((item, sequence) => this.persistActorMessage(path, sequence, item))
  }

  persistActorMessage(
    path: string,
    sequence: number,
    item: PersistedPiActorState["messages"][number],
  ): void {
    const writer = this.writer()
    if (writer === undefined || this.messageSequences(path).has(sequence)) return
    writer.appendCustomEntry(MESSAGE_ENTRY, { path, sequence, message: item })
    this.messageSequences(path).add(sequence)
  }

  persistActorRuntime(path: string, value: PersistedPiActorState["runtime"]): void {
    const writer = this.writer()
    if (writer === undefined) return
    const fingerprint = JSON.stringify(value)
    if (this.runtimeFingerprints.get(path) === fingerprint) return
    writer.appendCustomEntry(RUNTIME_ENTRY, { path, runtime: value })
    this.runtimeFingerprints.set(path, fingerprint)
  }

  restore(entries: readonly SessionEntry[]): PersistedAgentRecord[] {
    const definitions = new Map<string, NonNullable<ReturnType<typeof definition>>>()
    const lifecycles = new Map<string, NonNullable<ReturnType<typeof lifecycle>>>()
    const runtimes = new Map<string, PersistedPiActorState["runtime"]>()
    const messages = new Map<string, Map<number, PersistedPiActorState["messages"][number]>>()
    for (const entry of entries) {
      const actorDefinition = definition(entry)
      if (actorDefinition !== undefined) definitions.set(actorDefinition.path, actorDefinition)
      const actorLifecycle = lifecycle(entry)
      if (actorLifecycle !== undefined) lifecycles.set(actorLifecycle.path, actorLifecycle)
      const actorRuntime = runtime(entry)
      if (actorRuntime !== undefined) runtimes.set(actorRuntime.path, actorRuntime.runtime)
      const actorMessage = message(entry)
      if (actorMessage !== undefined) {
        let actorMessages = messages.get(actorMessage.path)
        if (actorMessages === undefined) {
          actorMessages = new Map()
          messages.set(actorMessage.path, actorMessages)
        }
        actorMessages.set(actorMessage.sequence, actorMessage.message)
      }
    }
    return [...definitions.values()].flatMap((actorDefinition) => {
      const actorLifecycle = lifecycles.get(actorDefinition.path)
      if (actorLifecycle === undefined) return []
      const actorRuntime = runtimes.get(actorDefinition.path)
      const actorMessages = [...(messages.get(actorDefinition.path)?.entries() ?? [])]
        .sort(([left], [right]) => left - right)
        .map(([, item]) => item)
      return [{
        ...actorDefinition,
        latestTask: actorLifecycle.latestTask,
        status: actorLifecycle.status,
        sessionState: actorRuntime === undefined ? undefined : {
          version: 5 as const,
          messages: actorMessages,
          runtime: actorRuntime,
        },
      }]
    })
  }

  restoreActor(entries: readonly SessionEntry[], path: string): PersistedAgentRecord | undefined {
    return this.restore(entries).find((record) => record.path === path)
  }

  private messageSequences(path: string): Set<number> {
    let actorSequences = this.sequences.get(path)
    if (actorSequences === undefined) {
      actorSequences = new Set()
      this.sequences.set(path, actorSequences)
    }
    return actorSequences
  }
}
