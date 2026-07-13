import type {
  CollaborationActorSession,
} from "./actor-session.ts"
import type { CollaborationClock } from "./coordinator.ts"
import { CollaborationCoordinator } from "./coordinator.ts"

export class FakeSession implements CollaborationActorSession {
  deliveries: Array<{ payload: string; triggerTurn: boolean }> = []
  interrupts = 0
  unloads = 0
  disposals = 0
  deliveryGate?: Deferred<void>
  interruptGate?: Deferred<void>
  unloadGate?: Deferred<void>
  deliveryFailures: Error[] = []

  async deliver(input: { payload: string; triggerTurn: boolean }): Promise<void> {
    this.deliveries.push(input)
    await this.deliveryGate?.promise
    const failure = this.deliveryFailures.shift()
    if (failure !== undefined) throw failure
  }

  async interrupt(): Promise<void> {
    this.interrupts += 1
    await this.interruptGate?.promise
  }

  async unload(): Promise<void> {
    this.unloads += 1
    await this.unloadGate?.promise
  }

  dispose(): void {
    this.disposals += 1
  }
}

export interface Deferred<Value> {
  promise: Promise<Value>
  resolve(value: Value): void
  reject(error: Error): void
}

export function deferred<Value>(): Deferred<Value> {
  let resolvePromise: (value: Value) => void = () => {}
  let rejectPromise: (error: Error) => void = () => {}
  const promise = new Promise<Value>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

export class FakeClock implements CollaborationClock {
  callbacks: Array<() => void> = []

  schedule(_delayMs: number, callback: () => void): () => void {
    this.callbacks.push(callback)
    return () => {
      const index = this.callbacks.indexOf(callback)
      if (index !== -1) this.callbacks.splice(index, 1)
    }
  }

  fire(): void {
    this.callbacks.shift()?.()
  }
}

export function spawn(
  coordinator: CollaborationCoordinator,
  parentPath: string,
  taskName: string,
  task: string,
  forkTurns?: unknown,
): Promise<ReturnType<CollaborationCoordinator["getAgent"]>> {
  return coordinator.spawn(parentPath, taskName, {
    task,
    parentHistory: [],
    forkTurns,
  })
}
