import { describe, expect, test } from "bun:test"
import { DEFAULT_COLLABORATION_CONFIG } from "../collaboration-config.ts"
import type {
  CollaborationActorFactory,
  CollaborationActorSession,
  CollaborationActorSpec,
} from "./actor-session.ts"
import { CollaborationCoordinator } from "./coordinator.ts"
import { deferred, FakeClock, FakeSession, spawn } from "./coordinator-test-support.ts"

describe("CollaborationCoordinator delivery", () => {
  test("retains accepted queue-only activity for one later wait", async () => {
    const clock = new FakeClock()
    const session = new FakeSession()
    const creation = deferred<CollaborationActorSession>()
    const coordinator = new CollaborationCoordinator(
      { createActor: () => creation.promise },
      clock,
    )
    const pendingSpawn = spawn(coordinator, "/root", "worker", "First task")

    const pendingInput = coordinator.sendMessage(
      "/root",
      "/root/worker",
      "During initialization",
    )
    expect(coordinator.getAgent("/root/worker").mailboxSize).toBe(2)
    creation.resolve(session)
    await Promise.all([pendingSpawn, pendingInput])
    expect(session.deliveries).toHaveLength(2)
    expect(coordinator.getAgent("/root/worker").mailboxSize).toBe(0)

    expect(await coordinator.waitForMailbox("/root/worker", 30_000)).toEqual({ kind: "activity" })
    const noInitializationActivity = coordinator.waitForMailbox("/root/worker", 30_000)
    clock.fire()
    expect(await noInitializationActivity).toEqual({ kind: "timeout" })

    await coordinator.sendMessage("/root", "/root/worker", "While running")
    expect(session.deliveries).toHaveLength(3)
    expect(coordinator.getAgent("/root/worker").mailboxSize).toBe(0)
    expect(await coordinator.waitForMailbox("/root/worker", 30_000)).toEqual({ kind: "activity" })
    const noRunningActivity = coordinator.waitForMailbox("/root/worker", 30_000)
    clock.fire()
    expect(await noRunningActivity).toEqual({ kind: "timeout" })
  })

  test("retries rejected delivery before committing tasks, completion, or reuse", async () => {
    const clock = new FakeClock()
    const root = new FakeSession()
    const child = new FakeSession()
    const coordinator = new CollaborationCoordinator(
      { rootActor: root, createActor: () => child },
      clock,
    )
    await spawn(coordinator, "/root", "worker", "First task")

    child.deliveryFailures.push(new Error("child unavailable"))
    await expect(
      coordinator.followUp("/root", "worker", "Retried task", "followup-retry"),
    ).rejects.toMatchObject({ code: "delivery_failed" })
    expect(coordinator.getAgent("/root/worker")).toMatchObject({
      latestTask: "First task",
      mailboxSize: 1,
      status: { kind: "running" },
    })

    await coordinator.followUp("/root", "worker", "Retried task", "followup-retry")
    expect(coordinator.getAgent("/root/worker")).toMatchObject({
      latestTask: "Retried task",
      mailboxSize: 0,
      status: { kind: "running" },
    })
    const noTriggerActivity = coordinator.waitForMailbox("/root/worker", 30_000)
    clock.fire()
    expect(await noTriggerActivity).toEqual({ kind: "timeout" })

    root.deliveryFailures.push(new Error("parent unavailable"))
    const rejectedActivity = coordinator.waitForMailbox("/root", 30_000)
    await expect(coordinator.complete("/root/worker", "Final answer", "complete-retry"))
      .rejects.toMatchObject({ code: "delivery_failed" })
    expect(coordinator.getAgent("/root/worker").status).toEqual({
      kind: "completed",
      message: "Final answer",
    })
    expect(coordinator.getAgent("/root").mailboxSize).toBe(1)
    expect(child.unloads).toBe(1)
    clock.fire()
    expect(await rejectedActivity).toEqual({ kind: "timeout" })

    await coordinator.sendMessage("/root", "/root", "Flush", "flush-completion")
    expect(coordinator.getAgent("/root").mailboxSize).toBe(0)
    expect(child.unloads).toBe(1)
    expect(await coordinator.waitForMailbox("/root", 30_000)).toEqual({ kind: "activity" })

    const queuedDelivery = deferred<void>()
    child.deliveryGate = queuedDelivery
    const queueOnly = coordinator.sendMessage("/root", "/root/worker", "Queue-only reuse")
    expect(coordinator.getAgent("/root/worker").status).toEqual({
      kind: "completed",
      message: "Final answer",
    })
    expect(coordinator.activeAgentCount).toBe(1)
    queuedDelivery.resolve()
    await queueOnly
    expect(child.deliveries.at(-1)).toMatchObject({
      payload: "Queue-only reuse",
      triggerTurn: false,
    })
    await coordinator.followUp("/root", "/root/worker", "Resume after queued context")
    expect(coordinator.getAgent("/root/worker").status).toEqual({ kind: "running" })
    expect(coordinator.activeAgentCount).toBe(2)

    root.deliveryFailures.push(new Error("parent unavailable"))
    await expect(coordinator.fail("/root/worker", "Broken")).rejects.toMatchObject({
      code: "delivery_failed",
    })
    expect(coordinator.getAgent("/root/worker")).toMatchObject({
      mailboxSize: 0,
      status: { kind: "errored", message: "Broken" },
    })
    expect(coordinator.getAgent("/root").mailboxSize).toBe(1)
    const rejectedFailure = root.deliveries.at(-1)

    await coordinator.sendMessage("/root", "/root", "Flush", "flush-failure")
    expect(root.deliveries.at(-2)).toEqual(rejectedFailure)
    expect(coordinator.getAgent("/root").mailboxSize).toBe(0)
    expect(child.unloads).toBe(2)
  })

  test("keeps identical concurrent communications as distinct operations", async () => {
    const session = new FakeSession()
    const coordinator = new CollaborationCoordinator({ createActor: () => session })
    await spawn(coordinator, "/root", "worker", "First task")

    const messageDelivery = deferred<void>()
    session.deliveryGate = messageDelivery
    const firstMessage = coordinator.sendMessage("/root", "worker", "Same message")
    const secondMessage = coordinator.sendMessage("/root", "worker", "Same message")
    expect(coordinator.getAgent("/root/worker").mailboxSize).toBe(2)
    messageDelivery.resolve()
    const messages = await Promise.all([firstMessage, secondMessage])
    expect(messages[0].id).not.toBe(messages[1].id)
    expect(
      session.deliveries.filter((input) => input.payload === "Same message"),
    ).toHaveLength(2)

    const followUpDelivery = deferred<void>()
    session.deliveryGate = followUpDelivery
    const firstFollowUp = coordinator.followUp("/root", "worker", "Same follow-up")
    const secondFollowUp = coordinator.followUp("/root", "worker", "Same follow-up")
    expect(coordinator.getAgent("/root/worker").mailboxSize).toBe(2)
    followUpDelivery.resolve()
    await Promise.all([firstFollowUp, secondFollowUp])
    expect(
      session.deliveries.filter((input) => input.payload === "Same follow-up"),
    ).toHaveLength(2)
  })

 })
