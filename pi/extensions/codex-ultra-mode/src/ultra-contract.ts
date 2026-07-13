import {
  DEFAULT_COLLABORATION_CONFIG,
  type CollaborationConfig,
} from "./collaboration-config.ts"

export const CODEX_PARITY_COMMIT = "8cf9a1b1f8ea35c724831a739fea2d725d72c582" as const

export const CODEX_PARITY_SOURCES = {
  modeInstructions: "codex-rs/core/src/context/multi_agent_mode_instructions.rs",
  collaborationConfig: "codex-rs/core/src/config/mod.rs",
  collaborationTools: "codex-rs/core/src/tools/handlers/multi_agents_spec.rs",
  collaborationRuntime: "codex-rs/core/src/tools/handlers/multi_agents_v2/",
} as const

export const MULTI_AGENT_MODE_MARKERS = {
  open: "<multi_agent_mode>",
  close: "</multi_agent_mode>",
} as const

export const EXPLICIT_REQUEST_ONLY_MULTI_AGENT_MODE_TEXT =
  "Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work."

export const PROACTIVE_MULTI_AGENT_MODE_TEXT =
  "Proactive multi-agent delegation is active. Any earlier instruction requiring an explicit user request before spawning sub-agents no longer applies. Use sub-agents when parallel work would materially improve speed or quality. This mode remains active until a later multi-agent mode developer message changes it."

export const CODEX_COLLABORATION_TOOLS = [
  "spawn_agent",
  "send_message",
  "followup_task",
  "wait_agent",
  "interrupt_agent",
  "list_agents",
] as const

export type CodexCollaborationTool = (typeof CODEX_COLLABORATION_TOOLS)[number]

export const ROOT_AGENT_PATH = "/root" as const

export const COLLABORATION_SHUTDOWN_TIMEOUT_MS = 2_000

const ROOT_AGENT_USAGE_HINT = `You are \`/root\`, the primary agent in a team of agents collaborating to fulfill the user's goals.

At the start of your turn, you are the active agent.
You can spawn sub-agents to handle subtasks, and those sub-agents can spawn their own sub-agents.
All agents in the team, including the agents that you can assign tasks to, are equally intelligent and capable. Spawned agents inherit built-in and discovered-extension tools; parent-only SDK-injected and inline tools are omitted because Pi cannot recreate their executable definitions.

You can use \`spawn_agent\` to create a new agent, \`followup_task\` to give an existing agent a new task and trigger a turn, and \`send_message\` to pass a message to a running agent without triggering a turn.
Child agents can also spawn their own sub-agents.
You can decide how much context you want to propagate to your sub-agents with the \`fork_turns\` parameter.

You will receive messages in the analysis channel in the form:
\`\`\`
Message Type: MESSAGE | FINAL_ANSWER
Task name: <recipient>
Sender: <author>
Payload:
<payload text>
\`\`\`
They may be addressed as to=/root`

const SUBAGENT_USAGE_HINT = `You are an agent in a team of agents collaborating to complete a task.

You can spawn sub-agents to handle subtasks, and those sub-agents can spawn their own sub-agents. All agents in the team, including the agents that you can assign tasks to, are equally intelligent and capable. Spawned agents inherit built-in and discovered-extension tools; parent-only SDK-injected and inline tools are omitted because Pi cannot recreate their executable definitions.

You can use \`spawn_agent\` to create a new agent, \`followup_task\` to give an existing agent a new task and trigger a turn, and \`send_message\` to pass a message to a running agent.
Child agents can also spawn their own sub-agents.

When you provide a response in the final channel, that content is immediately delivered back to your parent agent.

You will receive messages in the analysis channel in the form:
\`\`\`
Message Type: NEW_TASK | MESSAGE | FINAL_ANSWER
Task name: <recipient>
Sender: <author>
Payload:
<payload text>
\`\`\`
You may also see them addressed as to=/root/..., which indicates your identity is /root/...`

const SHARED_AGENT_USAGE_HINT = `Call \`spawn_agent\`, \`send_message\`, \`followup_task\`, \`wait_agent\`, \`interrupt_agent\`, and \`list_agents\` directly by their flat registered tool names. They are not commands inside another tool.

All agents share the same directory. In detail:
- All agents have access to the same container and filesystem as you.
- All agents use the same current working directory.
- As a result, edits made by one agent are immediately visible to all other agents.`

function concurrencyUsageHint(config: CollaborationConfig): string {
  const slots = config.maxConcurrentThreadsPerSession
  return `There are ${slots} available concurrency slots, meaning that up to ${slots} agents can be active at once, including you.`
}

export function codexRootAgentUsageHint(
  config: CollaborationConfig = DEFAULT_COLLABORATION_CONFIG,
): string {
  return `${ROOT_AGENT_USAGE_HINT}\n\n${SHARED_AGENT_USAGE_HINT}\n\n${concurrencyUsageHint(config)}`
}

export function codexSubagentUsageHint(
  config: CollaborationConfig = DEFAULT_COLLABORATION_CONFIG,
): string {
  return `${SUBAGENT_USAGE_HINT}\n\n${SHARED_AGENT_USAGE_HINT}\n\n${concurrencyUsageHint(config)}`
}
