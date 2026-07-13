const string = (description: string) => ({ type: "string", description } as const)
const number = (description: string) => ({ type: "number", description } as const)

function object(
  properties: Record<string, unknown>,
  required: readonly string[] = [],
) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  } as const
}

const spawnDescription = `Spawns an agent to work on the specified task. If your current task is \`/root/task1\` and you spawn_agent with task_name "task_3" the agent will have canonical task name \`/root/task1/task_3\`.
You are then able to refer to this agent as \`task_3\` or \`/root/task1/task_3\` interchangeably. However an agent \`/root/task2/task_3\` would only be able to communicate with this agent via its canonical name \`/root/task1/task_3\`.
The spawned agent inherits built-in and discovered-extension tools and can spawn its own subagents. Parent-only SDK-injected and inline tools are omitted because Pi cannot recreate their executable definitions.
Only call this tool for a concrete, bounded subtask that can run independently alongside useful local work; otherwise continue locally.
It will be able to send you and other running agents messages, and its final answer will be provided to you when it finishes.
The new agent's canonical task name will be provided to it along with the message.

Note that passing \`fork_turns="none"\` will not pass any surrounding context to the spawned subagent, which may cause the agent to lack the context it needs to complete its task, whereas \`fork_turns="all"\` will provide the subagent with all surrounding context.`

export function collaborationToolContracts(config: CollaborationConfig) {
  const spawnProperties = {
    task_name: string("Task name for the new agent. Use lowercase letters, digits, and underscores."),
    message: string("Initial plain-text task for the new agent."),
    fork_turns: string("Optional number of turns to fork. Defaults to `all`. Use `none`, `all`, or a positive integer string such as `3` to fork only the most recent turns."),
    ...(config.hideSpawnAgentMetadata ? {} : {
      model: string("Optional active Pi model to use. Requires a truncated fork; accepts provider/model references."),
      reasoning_effort: string("Optional child reasoning effort: off, minimal, low, medium, high, xhigh, or max. Requires a truncated fork."),
    }),
  }
  return {
  spawn_agent: {
    label: "Spawn Agent",
    description: config.spawnAgentUsageHintText ?? spawnDescription,
    parameters: object(
      spawnProperties,
      ["task_name", "message"],
    ),
  },
  send_message: {
    label: "Send Message",
    description: "Send a message to an existing agent. The message will be delivered promptly. Does not trigger a new turn.",
    parameters: object(
      {
        target: string("Relative or canonical task name to message (from spawn_agent)."),
        message: string("Message text to queue on the target agent."),
      },
      ["target", "message"],
    ),
  },
  followup_task: {
    label: "Follow-up Task",
    description: "Send a follow-up task to an existing non-root target agent and trigger a turn if it is idle. If the target is already running, deliver the task promptly at message boundaries while sampling, or after the pending tool call completes.",
    parameters: object(
      {
        target: string("Agent id or canonical task name to send a follow-up task to (from spawn_agent)."),
        message: string("Message text to send to the target agent."),
      },
      ["target", "message"],
    ),
  },
  wait_agent: {
    label: "Wait for Agent",
    description: "Wait for a mailbox update from any live agent, including queued messages and final-status notifications. The wait also ends early when new user input is steered into the active turn. Does not return the content; returns either a summary of which agents have updates (if any), an interruption summary for steered input, or a timeout summary if no activity arrives before the deadline.",
    parameters: object({
      timeout_ms: number(`Timeout in milliseconds. Defaults to ${config.defaultWaitTimeoutMs}; minimum ${config.minWaitTimeoutMs}, maximum ${config.maxWaitTimeoutMs}.`),
    }),
  },
  interrupt_agent: {
    label: "Interrupt Agent",
    description: "Interrupt an agent's current turn, if any, and return its previous status. The agent remains available for messages and follow-up tasks.",
    parameters: object(
      { target: string("Agent id or canonical task name to interrupt (from spawn_agent).") },
      ["target"],
    ),
  },
  list_agents: {
    label: "List Agents",
    description: "List live agents in the current root thread tree. Optionally filter by task-path prefix.",
    parameters: object({
      path_prefix: string("Task-path prefix filter without a trailing slash. Omit to list all live agents."),
    }),
  },
  } as const
}

export const COLLABORATION_TOOL_CONTRACTS = collaborationToolContracts({
  defaultWaitTimeoutMs: 30_000,
  hideSpawnAgentMetadata: true,
  maxConcurrentThreadsPerSession: 4,
  maxWaitTimeoutMs: 3_600_000,
  minWaitTimeoutMs: 10_000,
})
import type { CollaborationConfig } from "../collaboration-config.ts"
