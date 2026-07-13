import { describe, expect, test } from "bun:test"
import { DEFAULT_COLLABORATION_CONFIG } from "../collaboration-config.ts"
import type {
  CollaborationActorFactory,
  CollaborationActorSession,
  CollaborationActorSpec,
} from "./actor-session.ts"
import { CollaborationCoordinator } from "./coordinator.ts"
import { deferred, FakeClock, FakeSession, spawn } from "./coordinator-test-support.ts"

describe("CollaborationCoordinator shutdown", () => {
  test("wakes mailbox waits and tears every session down exactly once", async () => {
    const clock = new FakeClock()
    const root = new FakeSession()
    const firstSession = new FakeSession()
    const secondSession = new FakeSession()
    const pendingSession = new FakeSession()
    const pendingCreation = deferred<CollaborationActorSession>()
    const availableSessions = [firstSession, secondSession]
    const factory: CollaborationActorFactory = {
      createActor: () => availableSessions.shift() ?? pendingCreation.promise,
    }
    const coordinator = new CollaborationCoordinator({ ...factory, rootActor: root }, clock)
    const first = await spawn(coordinator, "/root", "first", "First")
    await spawn(coordinator, "/root", "second", "Second")

    await coordinator.sendMessage("/root", "first", "Queued input")
    expect(firstSession.deliveries.at(-1)).toMatchObject({
      payload: "Queued input",
      triggerTurn: false,
    })

    const activity = coordinator.waitForMailbox("/root", 30_000)
    const remainingWait = coordinator.waitForMailbox("/root", 30_000)
    await coordinator.sendMessage(first.path, "/root", "An update")
    expect(await activity).toEqual({ kind: "activity" })
    clock.fire()
    expect(await remainingWait).toEqual({ kind: "timeout" })

    const timeout = coordinator.waitForMailbox("/root", 30_000)
    clock.fire()
    expect(await timeout).toEqual({ kind: "timeout" })
    const abortController = new AbortController()
    const aborted = coordinator.waitForMailbox("/root", 30_000, abortController.signal)
    abortController.abort()
    expect(await aborted).toEqual({ kind: "aborted" })
    const shutdownWait = coordinator.waitForMailbox("/root", 30_000)
    const pendingSpawn = spawn(coordinator, "/root", "pending", "Pending")

    const listedSessions = coordinator
      .listAgents()
      .filter((agent) => agent.path !== "/root")
    expect(listedSessions).toHaveLength(3)
    const firstDisposal = coordinator.dispose()
    const secondDisposal = coordinator.dispose()
    await Promise.all([firstDisposal, secondDisposal])
    expect(await shutdownWait).toEqual({ kind: "shutdown" })

    pendingCreation.resolve(pendingSession)
    await expect(pendingSpawn).rejects.toMatchObject({ code: "coordinator_shutdown" })
    expect(coordinator.activeAgentCount).toBe(0)
    expect(firstSession.interrupts).toBe(1)
    expect(secondSession.interrupts).toBe(1)
    expect(firstSession.disposals).toBe(1)
    expect(secondSession.disposals).toBe(1)
    expect(pendingSession.interrupts).toBe(0)
    expect(pendingSession.disposals).toBe(1)
  })

  test("bounds shutdown while retaining exactly-once late cleanup", async () => {
    const clock = new FakeClock()
    const session = new FakeSession()
    const interrupt = deferred<void>()
    session.interruptGate = interrupt
    const coordinator = new CollaborationCoordinator({ createActor: () => session }, clock)
    await spawn(coordinator, "/root", "worker", "Work")

    expect(session.disposals).toBe(0)
    const shutdown = coordinator.dispose()
    expect(coordinator.dispose()).toBe(shutdown)
    await Promise.resolve()
    expect(session.interrupts).toBe(1)
    expect(session.disposals).toBe(0)

    clock.fire()
    await shutdown
    expect(session.disposals).toBe(1)

    interrupt.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(session.disposals).toBe(1)

    const failureClock = new FakeClock()
    const failureRoot = new FakeSession()
    const failureSession = new FakeSession()
    const unload = deferred<void>()
    failureSession.unloadGate = unload
    const failureCoordinator = new CollaborationCoordinator(
      { rootActor: failureRoot, createActor: () => failureSession },
      failureClock,
    )
    await spawn(failureCoordinator, "/root", "worker", "Work")
    const failure = failureCoordinator.fail("/root/worker", "Broken")
    while (failureSession.unloads === 0) await Promise.resolve()

    expect(failureSession.disposals).toBe(0)
    const failureShutdown = failureCoordinator.dispose()
    expect(failureCoordinator.dispose()).toBe(failureShutdown)
    failureClock.fire()
    await failureShutdown
    expect(failureSession.disposals).toBe(1)

    unload.resolve()
    await failure
    expect(failureSession.disposals).toBe(1)
  })
 })
