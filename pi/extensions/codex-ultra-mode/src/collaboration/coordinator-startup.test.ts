import { describe, expect, test } from "bun:test"
import { DEFAULT_COLLABORATION_CONFIG } from "../collaboration-config.ts"
import type {
  CollaborationActorFactory,
  CollaborationActorContext,
  CollaborationActorSession,
  CollaborationActorSpec,
} from "./actor-session.ts"
import {
  type AgentCommunication,
  CollaborationCoordinator,
  type PersistedAgentRecord,
} from "./coordinator.ts"
import { deferred, FakeClock, FakeSession, spawn } from "./coordinator-test-support.ts"

describe("CollaborationCoordinator startup", () => {
  test("owns recursive paths and atomically reserves one configured tree", async () => {
    const childSession = new FakeSession()
    const childCreation = deferred<CollaborationActorSession>()
    const nestedCreation = deferred<CollaborationActorSession>()
    const creations = [childCreation, nestedCreation]
    const actorSpecs: CollaborationActorSpec[] = []
    const factory: CollaborationActorFactory = {
      createActor: (input) => {
        actorSpecs.push(input)
        return creations.shift()?.promise ?? Promise.reject(new Error("unexpected"))
      },
    }
    const coordinator = new CollaborationCoordinator(
      factory,
      undefined,
      undefined,
      { ...DEFAULT_COLLABORATION_CONFIG, maxConcurrentThreadsPerSession: 3 },
    )

    await expect(spawn(coordinator, "/root", "invalid_fork", "Invalid", "0"))
      .rejects.toMatchObject({ code: "invalid_fork_turns" })
    expect(actorSpecs).toHaveLength(0)
    expect(coordinator.activeAgentCount).toBe(1)

    const child = spawn(coordinator, "/root", "research", "Research")
    expect(coordinator.activeAgentCount).toBe(2)
    childCreation.resolve(childSession)
    await child
    expect(actorSpecs[0].context.initialInput).toMatchObject({
      kind: "new_task",
      recipient: "/root/research",
      payload: "Research",
    })

    const nested = spawn(coordinator, "/root/research", "verify", "Verify")
    expect(coordinator.activeAgentCount).toBe(3)
    await expect(spawn(coordinator, "/root", "extra", "Extra")).rejects.toMatchObject({
      code: "capacity_exhausted",
    })

    nestedCreation.resolve(new FakeSession())
    await nested
    expect(coordinator.resolveTarget("/root", "research/verify").path).toBe(
      "/root/research/verify",
    )
    expect(coordinator.resolveTarget("/root/research", "verify").path).toBe(
      "/root/research/verify",
    )
    await expect(spawn(coordinator, "/root", "BadName", "Bad")).rejects.toMatchObject({
      code: "invalid_path",
    })
    await expect(spawn(coordinator, "/root", "research", "Duplicate")).rejects.toMatchObject({
      code: "duplicate_agent",
    })
  })

  test("rolls back failed starts and reuses terminal agents without losing records", async () => {
    const clock = new FakeClock()
    const root = new FakeSession()
    const session = new FakeSession()
    const pendingSession = new FakeSession()
    const pendingCreation = deferred<CollaborationActorSession>()
    const factory: CollaborationActorFactory = {
      createActor: ({ path }) => {
        if (path.endsWith("/broken")) throw new Error("start failed")
        if (path.endsWith("/pending")) return pendingCreation.promise
        return session
      },
    }
    const coordinator = new CollaborationCoordinator({ ...factory, rootActor: root }, clock)

    await expect(spawn(coordinator, "/root", "broken", "Broken")).rejects.toMatchObject({
      code: "initialization_failed",
    })
    expect(coordinator.activeAgentCount).toBe(1)
    expect(coordinator.listAgents().map((agent) => agent.path)).toEqual(["/root"])

    const pendingSpawn = spawn(coordinator, "/root", "pending", "Pending")
    expect(await coordinator.interrupt("/root", "pending")).toEqual({ kind: "pending_init" })
    pendingCreation.resolve(pendingSession)
    await expect(pendingSpawn).rejects.toMatchObject({ code: "initialization_interrupted" })
    expect(coordinator.getAgent("/root/pending").status).toEqual({ kind: "interrupted" })
    expect(pendingSession.disposals).toBe(1)
    expect(coordinator.activeAgentCount).toBe(1)

    await spawn(coordinator, "/root", "worker", "First task")
    const runningFollowUp = await coordinator.followUp("/root", "worker", "While running")
    expect(runningFollowUp.latestTask).toBe("While running")
    expect(session.deliveries.at(-1)).toMatchObject({
      payload: "While running",
      triggerTurn: true,
    })
    const completed = await coordinator.complete("/root/worker", "Done")
    expect(completed.status).toEqual({ kind: "completed", message: "Done" })
    expect(coordinator.activeAgentCount).toBe(1)
    expect(root.deliveries).toMatchObject([
      { payload: "Done", triggerTurn: false },
    ])
    expect(await coordinator.waitForMailbox("/root", 30_000)).toEqual({ kind: "activity" })
    const consumedActivity = coordinator.waitForMailbox("/root", 30_000)
    clock.fire()
    expect(await consumedActivity).toEqual({ kind: "timeout" })

    const resumed = await coordinator.followUp("/root", "worker", "Second task")
    expect(resumed).toMatchObject({
      latestTask: "Second task",
      status: { kind: "running" },
    })
    expect(session.deliveries.at(-1)).toMatchObject({
      payload: "Second task",
      triggerTurn: true,
    })
    expect(coordinator.activeAgentCount).toBe(2)

    await coordinator.interrupt("/root", "worker")
    expect(coordinator.getAgent("/root/worker").status).toEqual({ kind: "interrupted" })
    expect(coordinator.activeAgentCount).toBe(1)
    expect(session.unloads).toBe(2)
    expect(coordinator.listAgents().map((agent) => agent.path)).toEqual([
      "/root",
      "/root/pending",
      "/root/worker",
    ])
    expect(() => coordinator.resolveTarget("/root", "missing")).toThrow("unknown agent")
    await expect(coordinator.interrupt("/root", "/root")).rejects.toMatchObject({
      code: "invalid_operation",
    })
    await expect(
      coordinator.interrupt("/root/worker", "/root/worker"),
    ).rejects.toMatchObject({ code: "invalid_operation" })
  })

  test("does not resurrect an interrupted follow-up or accept its stale completion", async () => {
    const root = new FakeSession()
    const session = new FakeSession()
    const coordinator = new CollaborationCoordinator({ rootActor: root, createActor: () => session })
    await spawn(coordinator, "/root", "worker", "First task")
    await coordinator.complete("/root/worker", "Done")

    const delivery = deferred<void>()
    session.deliveryGate = delivery
    const followUp = coordinator.followUp("/root", "worker", "Second task")
    expect(coordinator.getAgent("/root/worker").status).toEqual({ kind: "pending_init" })

    await coordinator.interrupt("/root", "worker")
    expect(coordinator.getAgent("/root/worker").status).toEqual({ kind: "interrupted" })
    delivery.resolve()

    await expect(followUp).rejects.toMatchObject({ code: "initialization_interrupted" })
    expect((await coordinator.complete("/root/worker", "Stale")).status).toEqual({
      kind: "interrupted",
    })
    expect(coordinator.getAgent("/root/worker").mailboxSize).toBe(1)
    expect(root.deliveries).toHaveLength(1)
    expect(coordinator.activeAgentCount).toBe(1)
  })

  test("restores terminal context only when native session state is absent", async () => {
    const context: CollaborationActorContext = {
      history: [{ role: "user", content: "Original context", timestamp: 1 }],
      initialInput: {
        kind: "new_task",
        sender: "/root",
        recipient: "/root/legacy",
        payload: "Original task",
        triggerTurn: true,
      },
    }
    const records: PersistedAgentRecord[] = [
      {
        path: "/root/legacy",
        parentPath: "/root",
        latestTask: "Follow-up task",
        context,
        status: { kind: "completed", message: "Terminal answer" },
      },
      {
        path: "/root/native",
        parentPath: "/root",
        latestTask: "Native task",
        context: { ...context, initialInput: { ...context.initialInput, recipient: "/root/native" } },
        status: { kind: "completed", message: "Native answer" },
        sessionState: { version: 4 },
      },
    ]
    const specs: CollaborationActorSpec[] = []
    const persisted: PersistedAgentRecord[] = []
    const coordinator = new CollaborationCoordinator(
      {
        createActor(spec) {
          specs.push(spec)
          return new FakeSession()
        },
      },
      undefined,
      {
        acknowledgeCommunication(_communication: AgentCommunication) {},
        persistAgent(record) { persisted.push(record) },
        persistCommunication(_communication: AgentCommunication) {},
      },
    )

    await coordinator.restore(records)
    coordinator.checkpoint("/root/legacy")
    coordinator.checkpoint("/root/native")

    expect(specs[0].context.history).toEqual([
      context.history[0],
      { role: "assistant", content: "Terminal answer" },
      { role: "developer", content: "Most recent task: Follow-up task" },
    ])
    expect(specs[1].context).toBe(records[1].context)
    expect(persisted.map((record) => record.context)).toEqual([
      specs[0].context,
      records[1].context,
    ])
  })

 })
