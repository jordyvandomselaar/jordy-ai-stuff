import { describe, expect, test } from "bun:test"
import type { CollaborationActorInput } from "./actor-session.ts"
import { CollaborationCoordinator } from "./coordinator.ts"
import { PiActorFactory } from "./pi-actor-session.ts"
import {
  FakePiSession,
  rootContext,
  taskRequest,
  waitUntil,
} from "./pi-actor-test-support.ts"

describe("Pi actor settlement", () => {
  test.each([
    ["error", { kind: "errored", message: "Boom" }],
    ["aborted", { kind: "interrupted" }],
  ] as const)("maps %s settlement to coordinator status", async (stopReason, expected) => {
    const session = new FakePiSession()
    let coordinator: CollaborationCoordinator
    const factory = new PiActorFactory({ deliver() {} }, () => coordinator, async () => session)
    coordinator = new CollaborationCoordinator(factory)
    factory.bindRoot(rootContext(), {
      thinkingLevel: "xhigh",
      tools: ["read"],
      ultraEnabled: true,
    })

    await coordinator.spawn("/root", "child", taskRequest("Run"))
    session.finish(stopReason, "Boom")
    await waitUntil(() => coordinator.getAgent("/root/child").status.kind !== "running")
    expect(coordinator.getAgent("/root/child").status).toEqual(expected)
  })

  test("keeps the latest accepted triggering run as settlement owner", async () => {
    const rootDeliveries: CollaborationActorInput[] = []
    const session = new FakePiSession()
    let coordinator: CollaborationCoordinator
    const factory = new PiActorFactory(
      { deliver(input) { rootDeliveries.push(input) } },
      () => coordinator,
      async () => session,
    )
    coordinator = new CollaborationCoordinator(factory)
    factory.bindRoot(rootContext(), {
      thinkingLevel: "xhigh",
      tools: ["read"],
      ultraEnabled: true,
    })

    await coordinator.spawn("/root", "child", taskRequest("First"))
    session.finish("stop", "Stale first answer", 0)
    await coordinator.followUp("/root", "child", "Second")
    expect(coordinator.getAgent("/root/child").status).toEqual({ kind: "running" })
    expect(rootDeliveries).toEqual([])

    session.finish("stop", "Current second answer", 1)
    await waitUntil(() => rootDeliveries.length === 1)
    expect(rootDeliveries[0]).toMatchObject({ payload: "Current second answer" })
  })

  test("rejected triggering input does not supersede the accepted settlement owner", async () => {
    const rootDeliveries: CollaborationActorInput[] = []
    const session = new FakePiSession()
    let coordinator: CollaborationCoordinator
    const factory = new PiActorFactory(
      { deliver(input) { rootDeliveries.push(input) } },
      () => coordinator,
      async () => session,
    )
    coordinator = new CollaborationCoordinator(factory)
    factory.bindRoot(rootContext(), {
      thinkingLevel: "xhigh",
      tools: ["read"],
      ultraEnabled: true,
    })

    await coordinator.spawn("/root", "child", taskRequest("Accepted"))
    session.rejectNextTrigger = true
    await expect(coordinator.followUp("/root", "child", "Rejected", "retry-task"))
      .rejects.toMatchObject({ code: "delivery_failed" })
    expect(coordinator.getAgent("/root/child")).toMatchObject({
      mailboxSize: 1,
      status: { kind: "running" },
    })

    session.finish("stop", "Accepted answer", 0)
    await waitUntil(() => rootDeliveries.length === 1)
    expect(rootDeliveries[0]).toMatchObject({ payload: "Accepted answer" })
    expect(rootDeliveries.some((input) => input.payload.includes("Agent failed"))).toBe(false)

    await coordinator.followUp("/root", "child", "Rejected", "retry-task")
    expect(coordinator.getAgent("/root/child")).toMatchObject({
      mailboxSize: 0,
      status: { kind: "running" },
    })
  })

  test("root notification rejection does not rewrite a valid child answer as failure", async () => {
    const session = new FakePiSession()
    const attempted: CollaborationActorInput[] = []
    let reject = true
    let coordinator: CollaborationCoordinator
    const factory = new PiActorFactory(
      {
        deliver(input) {
          attempted.push(input)
          if (reject) {
            reject = false
            throw new Error("root persistence unavailable")
          }
        },
      },
      () => coordinator,
      async () => session,
    )
    coordinator = new CollaborationCoordinator(factory)
    factory.bindRoot(rootContext(), {
      thinkingLevel: "xhigh",
      tools: ["read"],
      ultraEnabled: true,
    })

    await coordinator.spawn("/root", "child", taskRequest("Work"))
    session.finish("stop", "Valid answer")
    await waitUntil(() => coordinator.getAgent("/root/child").status.kind === "completed")
    expect(coordinator.getAgent("/root").mailboxSize).toBe(1)
    expect(coordinator.getAgent("/root/child").status).toEqual({
      kind: "completed",
      message: "Valid answer",
    })
    expect(attempted).toHaveLength(1)
    expect(attempted[0].payload).toBe("Valid answer")
    expect(attempted.some((input) => input.payload.includes("Agent failed"))).toBe(false)
  })
 })
