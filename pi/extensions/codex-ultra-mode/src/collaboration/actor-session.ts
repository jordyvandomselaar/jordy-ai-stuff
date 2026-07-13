export type CollaborationInputKind = "new_task" | "message" | "final_answer"

export interface CollaborationActorInput {
  kind: CollaborationInputKind
  sender: string
  recipient: string
  payload: string
  triggerTurn: boolean
}

export interface CollaborationInputSink {
  deliver(input: CollaborationActorInput): Promise<void> | void
}

export interface CollaborationHistoryMessage {
  role: string
  [property: string]: unknown
}

export interface CollaborationActorContext {
  history: readonly CollaborationHistoryMessage[]
  initialInput: CollaborationActorInput
}

export interface CollaborationActorSpec {
  path: string
  parentPath: string
  task: string
  context: CollaborationActorContext
  runtimeOverrides?: CollaborationRuntimeOverrides
  sessionState?: unknown
}

export interface CollaborationRuntimeOverrides {
  model?: string
  reasoningEffort?: string
}

export interface CollaborationActorSession extends CollaborationInputSink {
  checkpointPersistence?(): void
  dispose(): Promise<void> | void
  interrupt(): Promise<void> | void
  unload(): Promise<void> | void
}

export interface CollaborationActorFactory {
  rootActor?: CollaborationInputSink
  createActor(
    input: CollaborationActorSpec,
    parentSession?: CollaborationActorSession,
  ): Promise<CollaborationActorSession> | CollaborationActorSession
}
