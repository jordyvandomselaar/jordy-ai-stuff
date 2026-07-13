import type {
  AgentSession,
  ExtensionAPI,
  ExtensionContext,
  ToolInfo,
} from "@earendil-works/pi-coding-agent"
import type { CollaborationConfig } from "../collaboration-config.ts"
import type { CollaborationActorSpec } from "./actor-session.ts"
import type { CollaborationCoordinator } from "./coordinator.ts"

export type PiSession = Pick<
  AgentSession,
  | "abort"
  | "dispose"
  | "isStreaming"
  | "messages"
  | "pendingMessageCount"
  | "sendCustomMessage"
  | "subscribe"
  | "waitForIdle"
> & {
  shutdownExtensions?(): Promise<void>
}

export interface PiActorRuntimeSnapshot {
  collaborationConfig: CollaborationConfig
  cwd: string
  extensionPaths: readonly string[]
  model: NonNullable<ExtensionContext["model"]>
  modelRegistry: ExtensionContext["modelRegistry"]
  projectTrusted: boolean
  systemPrompt: string
  thinkingLevel: ReturnType<ExtensionAPI["getThinkingLevel"]>
  toolInfos: readonly ToolInfo[]
  tools: readonly string[]
  ultraEnabled: boolean
}

export interface PiRootRuntimeSelection {
  collaborationConfig?: CollaborationConfig
  thinkingLevel: PiActorRuntimeSnapshot["thinkingLevel"]
  toolInfos?: readonly ToolInfo[]
  tools: readonly string[]
  ultraEnabled: boolean
}

export interface PersistedPiActorState {
  messages: PiSession["messages"]
  runtime: Pick<
    PiActorRuntimeSnapshot,
    | "collaborationConfig"
    | "cwd"
    | "extensionPaths"
    | "model"
    | "projectTrusted"
    | "systemPrompt"
    | "thinkingLevel"
    | "toolInfos"
    | "tools"
    | "ultraEnabled"
  >
  version: 5
}

export interface PiActorPersistence {
  initializeActorSession(path: string, state: PersistedPiActorState): void
  persistActorMessage(
    path: string,
    sequence: number,
    message: PiSession["messages"][number],
  ): void
  persistActorRuntime(path: string, runtime: PersistedPiActorState["runtime"]): void
}

export interface PiActorRuntimeStore {
  readonly snapshot: PiActorRuntimeSnapshot
  update(snapshot: PiActorRuntimeSnapshot): void
}

export interface PiChildSessionRequest {
  readonly coordinator: CollaborationCoordinator
  readonly runtime: PiActorRuntimeStore
  readonly spec: CollaborationActorSpec
}

export type PiChildSessionCreator = (request: PiChildSessionRequest) => Promise<PiSession>
