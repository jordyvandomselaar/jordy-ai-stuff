import { describe, expect, test } from "bun:test"
import { DEFAULT_COLLABORATION_CONFIG } from "../collaboration-config.ts"
import type {
  CollaborationActorFactory,
  CollaborationActorSession,
  CollaborationActorSpec,
} from "./actor-session.ts"
import { CollaborationCoordinator } from "./coordinator.ts"
import { deferred, FakeClock, FakeSession, spawn } from "./coordinator-test-support.ts"

describe("CollaborationCoordinator terminal lifecycle", () => {
  test("failure owns unload when interrupted", async () => {
    const root = new FakeSession()
    const session = new FakeSession()
    const coordinator = new CollaborationCoordinator({ rootActor: root, createActor: () => session })
    await spawn(coordinator, "/root", "worker", "First task")

    const unloading = deferred<void>()
    session.unloadGate = unloading
    const failureActivity = coordinator.waitForMailbox("/root", 30_000)
    const failure = coordinator.fail("/root/worker", "Failed")
    expect(await failureActivity).toEqual({ kind: "activity" })
    expect(root.deliveries).toMatchObject([
      {
        payload: "Agent failed: Failed\n\nSend a follow-up task to retry or continue the work.",
        triggerTurn: false,
      },
    ])
    expect(coordinator.getAgent("/root/worker").status).toEqual({ kind: "running" })
    const interruption = coordinator.interrupt("/root", "worker")
    unloading.resolve()

    await Promise.all([failure, interruption])
    expect(coordinator.getAgent("/root/worker").status).toEqual({ kind: "interrupted" })
    expect(session.interrupts).toBe(1)
    expect(session.unloads).toBe(1)

    const shutdownSession = new FakeSession()
    const shutdownCoordinator = new CollaborationCoordinator({
      createActor: () => shutdownSession,
    })
    await spawn(shutdownCoordinator, "/root", "worker", "First task")
    const shutdownUnload = deferred<void>()
    shutdownSession.unloadGate = shutdownUnload
    const shutdownFailure = shutdownCoordinator.fail("/root/worker", "Failed")
    await Promise.resolve()
    await Promise.resolve()
    expect(shutdownSession.unloads).toBe(1)
    const shutdown = shutdownCoordinator.dispose()
    shutdownUnload.resolve()

    await Promise.all([shutdownFailure, shutdown])
    expect(shutdownCoordinator.getAgent("/root/worker").status).toEqual({ kind: "shutdown" })
    expect(shutdownSession.interrupts).toBe(1)
    expect(shutdownSession.unloads).toBe(1)
    expect(shutdownSession.disposals).toBe(1)
  })

  test("failure claims the actor before notifying its parent", async () => {
    const root = new FakeSession()
    const session = new FakeSession()
    const coordinator = new CollaborationCoordinator({ rootActor: root, createActor: () => session })
    await spawn(coordinator, "/root", "worker", "First task")

    const parentDelivery = deferred<void>()
    root.deliveryGate = parentDelivery
    const parentActivity = coordinator.waitForMailbox("/root", 30_000)
    const failure = coordinator.fail("/root/worker", "Failed")
    await Promise.resolve()

    const followUp = coordinator.followUp("/root", "worker", "Recover")
    expect(session.deliveries).toHaveLength(1)
    parentDelivery.resolve()
    expect(await parentActivity).toEqual({ kind: "activity" })
    await Promise.all([failure, followUp])

    expect(session.unloads).toBe(1)
    expect(session.deliveries.at(-1)).toMatchObject({ payload: "Recover", triggerTurn: true })
    expect(coordinator.getAgent("/root/worker")).toMatchObject({
      latestTask: "Recover",
      status: { kind: "running" },
    })
  })

  test("terminalizes and retries shutdown delivery when outbox persistence rejects", async () => {
    const root = new FakeSession()
    const child = new FakeSession()
    let rejectOutbox = true
    const coordinator = new CollaborationCoordinator({
      rootActor: root,
      createActor: () => child,
    }, undefined, {
      persistAgent() {},
      persistCommunication() {
        if (!rejectOutbox) return
        rejectOutbox = false
        throw new Error("root persistence unavailable")
      },
      acknowledgeCommunication() {},
    })
    await spawn(coordinator, "/root", "worker", "Work")

    await expect(coordinator.complete("/root/worker", "Durable answer"))
      .rejects.toMatchObject({ code: "delivery_failed" })
    expect(coordinator.getAgent("/root/worker").status).toEqual({
      kind: "completed",
      message: "Durable answer",
    })
    expect(coordinator.getAgent("/root").mailboxSize).toBe(1)
    expect(child.unloads).toBe(1)

    await coordinator.dispose()
    expect(root.deliveries.at(-1)).toMatchObject({
      kind: "final_answer",
      payload: "Durable answer",
    })
  })

 })
