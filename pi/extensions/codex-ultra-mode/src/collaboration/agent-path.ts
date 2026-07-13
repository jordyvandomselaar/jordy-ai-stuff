import { ROOT_AGENT_PATH } from "../ultra-contract.ts"

const TASK_NAME_PATTERN = /^[a-z0-9_]+$/

export function validateTaskName(taskName: string): void {
  if (taskName.length === 0) throw new Error("task_name must not be empty")
  if (taskName === "root") throw new Error("task_name `root` is reserved")
  if (taskName === "." || taskName === "..") {
    throw new Error(`task_name \`${taskName}\` is reserved`)
  }
  if (!TASK_NAME_PATTERN.test(taskName)) {
    throw new Error("task_name must use only lowercase letters, digits, and underscores")
  }
}

export function validateAgentPath(path: string): void {
  if (path === ROOT_AGENT_PATH) return
  if (!path.startsWith(`${ROOT_AGENT_PATH}/`)) {
    throw new Error("absolute agent paths must start with `/root`")
  }
  if (path.endsWith("/")) throw new Error("absolute agent path must not end with `/`")

  for (const segment of path.slice(ROOT_AGENT_PATH.length + 1).split("/")) {
    validateTaskName(segment)
  }
}

export function joinAgentPath(parentPath: string, taskName: string): string {
  validateAgentPath(parentPath)
  validateTaskName(taskName)
  return `${parentPath}/${taskName}`
}

export function resolveAgentPath(actorPath: string, target: string): string {
  validateAgentPath(actorPath)
  if (target.length === 0) throw new Error("agent path must not be empty")
  if (target.startsWith("/")) {
    validateAgentPath(target)
    return target
  }
  if (target.endsWith("/")) throw new Error("relative agent path must not end with `/`")

  let resolved = actorPath
  for (const segment of target.split("/")) resolved = joinAgentPath(resolved, segment)
  return resolved
}
