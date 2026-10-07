import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { getAgentDir, sessionEntryToContextMessages, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CHECKPOINT_GUIDANCE, contextBudget, RECOVERY_GUIDANCE, WARNING_TOKENS, WINDOW_GUIDANCE } from "./budget.ts";
import { CONFIG_NAME, loadConfig, modelKey, setModelEnabled, setWorkBudget, type Config } from "./config.ts";
import { registerHistory } from "./history.ts";
import { notifyReset, registerOwnership } from "./integration.ts";
import { registerManualReset } from "./manual-reset.ts";
import { currentGoal, restoreLiveContext } from "./live-context.ts";
import { registerNotes } from "./notes.ts";
import { createWindow, currentWindow, projectWindow, WINDOW_TYPE } from "./state.ts";

const TOOL_NAMES = ["context_notes", "context_history", "get_context_remaining", "new_context"];

export default function contextWindows(pi: ExtensionAPI): void {
	const agentDir = getAgentDir();
	let config: Config = { version: 1, enabledModels: [] };
	let sessionId = "";
	let enabled = false;
	let recoveryRequired = false;
	let resetPending = false;
	let resetThisTurn = false;
	let warned = "";
	let failure: string | undefined;
	let projected: AgentMessage[] = [];
	let projectionAnchor: { window: string; message: AgentMessage } | undefined;
	let toolCharacters = 0;

	const owns = (id: string) => id === sessionId && (enabled || recoveryRequired);
	const removeOwnership = registerOwnership(pi, owns);
	const manualReset = registerManualReset(pi);

	function sync(ctx: ExtensionContext): void {
		sessionId = ctx.sessionManager.getSessionId();
		enabled = !!ctx.model && config.enabledModels.includes(modelKey(ctx.model));
		const recovering = !!currentWindow(ctx.sessionManager.getBranch());
		recoveryRequired = recovering;
		const current = pi.getActiveTools();
		const active = current.filter(name => !TOOL_NAMES.includes(name));
		const desired = enabled ? [...active, ...TOOL_NAMES] : recovering ? [...active, ...TOOL_NAMES.slice(0, 2)] : active;
		if (JSON.stringify(current) !== JSON.stringify(desired)) pi.setActiveTools(desired);
		toolCharacters = JSON.stringify(pi.getAllTools().filter(tool => pi.getActiveTools().includes(tool.name)).map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters }))).length;
		ctx.ui.setStatus("context-windows", enabled ? "Context windows on" : recovering ? "Context windows off · recovery retained" : undefined);
	}

	function beginWindow(ctx: ExtensionContext, reason: string): void {
		const anchor = rawContext(ctx).at(-1);
		const window = createWindow(ctx, reason);
		projectionAnchor = anchor ? { window: window.id, message: anchor } : undefined;
		resetThisTurn = true;
		recoveryRequired = true;
		pi.sendMessage({ customType: WINDOW_TYPE, content: window.recovery, display: false, details: window }, { triggerTurn: false });
		notifyReset(pi, ctx, window);
		warned = "";
		projected = [];
	}

	function rawContext(ctx: ExtensionContext): AgentMessage[] {
		return ctx.sessionManager.buildContextEntries().flatMap(sessionEntryToContextMessages);
	}

	function getBudget(messages: AgentMessage[], ctx: ExtensionContext) {
		return contextBudget(messages, ctx, toolCharacters, ctx.model ? config.workBudgets?.[modelKey(ctx.model)] : undefined);
	}

	function fail(ctx: ExtensionContext, error: unknown): void {
		failure = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`Context windows stopped: ${failure}`, "error");
		ctx.abort();
	}

	registerNotes(pi);
	registerHistory(pi);
	pi.registerTool({
		name: "get_context_remaining", label: "Context budget", description: "Return the estimated remaining tokens before a context-window checkpoint is due. Includes output headroom and new tool-result estimates; it is not an exact tokenizer count.",
		parameters: Type.Object({}),
		async execute(_id, _args, _signal, _onUpdate, ctx) {
			const messages = projected.length ? projected : projectWindow(rawContext(ctx), currentWindow(ctx.sessionManager.getBranch()));
			return { content: [{ type: "text", text: JSON.stringify(getBudget(messages, ctx)) }], details: {} };
		},
	});
	pi.registerTool({
		name: "new_context", label: "New context window", executionMode: "sequential",
		description: "Start a fresh context window after this tool batch finishes, without a summarizer. Save checkpoint.md with context_notes first. Call this tool by itself. Original messages remain available through context_history. This does not change the user's task, authorization, or session.",
		parameters: Type.Object({}),
		async execute(_id, _args, _signal, _onUpdate, ctx) {
			if (!enabled) throw new Error("Context windows is off for this model. Enable it with /context-windows on.");
			if (failure) throw new Error(failure);
			resetPending = true;
			return { content: [{ type: "text", text: "A new window will begin after the current tools finish. Recover your checkpoint and continue the authorized task." }], details: {} };
		},
	});

	pi.registerCommand("context-windows", {
		description: "Enable/disable notes-based context windows for the current model, or show status/reset",
		getArgumentCompletions: prefix => ["on", "off", "status", "reset", "budget"].filter(value => value.startsWith(prefix)).map(value => ({ value, label: value })),
		async handler(args, ctx) {
			const [action = "status", value] = args.trim().split(/\s+/).filter(Boolean);
			if (!ctx.model) { ctx.ui.notify("Select a model first.", "error"); return; }
			if (action === "status") {
				const window = currentWindow(ctx.sessionManager.getBranch());
				ctx.ui.notify(`${modelKey(ctx.model)}: ${enabled ? "on" : "off"}. Window: ${window?.id ?? "initial"}. Config: ${agentDir}/${CONFIG_NAME}.${failure ? ` Error: ${failure}` : ""}`, "info");
				return;
			}
			if (!["on", "off", "reset", "budget"].includes(action)) { ctx.ui.notify("Usage: /context-windows on|off|status|reset|budget <tokens|default>", "warning"); return; }
			if (!ctx.isIdle()) { ctx.ui.notify("Wait until the current run finishes before changing context-window mode.", "warning"); return; }
			try {
				if (action === "budget") {
					if (!value) {
						ctx.ui.notify(`Work budget: ${config.workBudgets?.[modelKey(ctx.model)] ?? "model default"}. Use /context-windows budget <tokens|default>.`, "info");
						return;
					}
					const tokens = value === "default" ? undefined : Number(value);
					if (tokens !== undefined && (!Number.isSafeInteger(tokens) || tokens <= 0)) throw new Error("Use a positive whole token count or default.");
					config = await setWorkBudget(agentDir, modelKey(ctx.model), tokens);
					ctx.ui.notify(`Work budget saved: ${tokens ?? "model default"}. Model capacity still caps the limit.`, "info");
				} else if (action === "reset") {
					if (!enabled) throw new Error("Enable context windows for this model first.");
					if (await manualReset.save(ctx)) {
						beginWindow(ctx, "manual reset");
						ctx.ui.notify("Checkpoint saved. Fresh window ready; the next request will recover notes and history.", "info");
					}
				} else {
					config = await setModelEnabled(agentDir, modelKey(ctx.model), action === "on");
					failure = undefined;
					sync(ctx);
					ctx.ui.notify(`Context windows ${action} for ${modelKey(ctx.model)}. Saved to ${CONFIG_NAME}.${action === "off" && currentWindow(ctx.sessionManager.getBranch()) ? " This session retains its current window and recovery tools. New sessions use normal compaction; old history will not be resent." : ""}`, "info");
				}
			} catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); }
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		resetPending = false; projected = []; projectionAnchor = undefined; warned = ""; failure = undefined;
		try { config = await loadConfig(agentDir); sync(ctx); }
		catch (error) { fail(ctx, error); }
	});
	pi.on("model_select", async (_event, ctx) => {
		resetPending = false; projected = [];
		try { config = await loadConfig(agentDir); sync(ctx); }
		catch (error) { fail(ctx, error); }
	});
	pi.on("session_tree", (_event, ctx) => { resetPending = false; projected = []; projectionAnchor = undefined; warned = ""; sync(ctx); });
	pi.on("turn_start", () => { resetThisTurn = false; });
	pi.on("before_agent_start", async (event, ctx) => {
		try { config = await loadConfig(agentDir); failure = undefined; sync(ctx); }
		catch (error) { fail(ctx, error); }
		if (enabled) {
			if (!manualReset.isPending()) {
				const budget = getBudget(projectWindow(rawContext(ctx), currentWindow(ctx.sessionManager.getBranch())), ctx);
				if (budget.hard !== null && budget.used >= budget.hard) beginWindow(ctx, "pre-request capacity reached");
			}
			return { systemPrompt: `${event.systemPrompt}\n\n${WINDOW_GUIDANCE}` };
		}
		return currentWindow(ctx.sessionManager.getBranch()) ? { systemPrompt: `${event.systemPrompt}\n\n${RECOVERY_GUIDANCE}` } : undefined;
	});
	pi.on("turn_end", (event, ctx) => {
		if (!resetPending) return;
		resetPending = false;
		if (event.message.role !== "assistant" || event.message.stopReason === "aborted" || event.message.stopReason === "error" || !event.toolResults.some(result => result.toolName === "new_context" && !result.isError)) return;
		try { beginWindow(ctx, "model requested reset"); }
		catch (error) { fail(ctx, error); }
	});
	pi.on("context", (event, ctx) => {
		try {
			const branch = ctx.sessionManager.getBranch();
			const window = currentWindow(branch);
			projected = projectWindow(event.messages, window, projectionAnchor?.window === window?.id ? projectionAnchor?.message : undefined);
			if (window) projected = restoreLiveContext(projected, branch);
			if (enabled) {
				const budget = getBudget(projected, ctx);
				ctx.ui.setStatus("context-windows", `Window ${Math.round(budget.used / 1000)}k / ${budget.soft === null ? "unknown" : `${Math.round(budget.soft / 1000)}k`}`);
			}
			return { messages: projected };
		} catch (error) {
			fail(ctx, error);
			return { messages: [{ role: "user", content: "Context recovery failed. Stop and report the extension error; do not execute tools.", timestamp: 0 }] };
		}
	});
	pi.on("tool_call", () => failure ? { block: true, reason: failure, terminate: true } : undefined);
	pi.on("turn_end", (event, ctx) => {
		if (!enabled || failure || resetThisTurn || manualReset.isPending() || event.message.role !== "assistant" || event.message.stopReason === "aborted" || event.message.stopReason === "error") return;
		try {
			const messages = projectWindow(rawContext(ctx), currentWindow(ctx.sessionManager.getBranch()));
			const budget = getBudget(messages, ctx);
			if (budget.hard === null || budget.remaining === null) return;
			const window = currentWindow(ctx.sessionManager.getBranch())?.id ?? "initial";
			if (budget.used >= budget.hard && (event.toolResults.length || ctx.hasPendingMessages() || currentGoal(ctx.sessionManager.getBranch())?.status === "active")) { beginWindow(ctx, "window capacity reached"); return; }
			const level = budget.remaining === 0 ? "checkpoint" : budget.remaining <= WARNING_TOKENS ? "warning" : "";
			if (!level || warned === `${window}:${level}` || warned === `${window}:checkpoint`) return;
			warned = `${window}:${level}`;
			pi.sendMessage({ customType: "context-windows-budget", details: { window }, content: level === "checkpoint" ? CHECKPOINT_GUIDANCE : `About ${budget.remaining} tokens remain before checkpointing is due. Save concise progress notes with context_notes and call new_context before the window fills.`, display: false }, { deliverAs: event.toolResults.length ? "steer" : "nextTurn" });
		} catch (error) { fail(ctx, error); }
	});
	pi.on("session_before_compact", async (event, ctx) => {
		if (!enabled && !recoveryRequired) return;
		if (manualReset.isPending()) return { cancel: true };
		if (resetThisTurn && event.reason === "threshold") return { cancel: true };
		try {
			const messages = projectWindow(rawContext(ctx), currentWindow(ctx.sessionManager.getBranch()));
			const budget = getBudget(messages, ctx);
			const threshold = enabled ? budget.hard : (ctx.model?.contextWindow ?? 0) - 16384;
			if (event.reason === "threshold" && (threshold === null || budget.used < threshold)) return { cancel: true };
			if (event.reason === "manual" && !await manualReset.save(ctx, event.customInstructions, event.signal)) return { cancel: true };
			const window = createWindow(ctx, event.reason === "overflow" ? "provider overflow recovery" : "manual compaction");
			pi.appendEntry("context-windows-boundary", { window: window.id });
			const boundary = ctx.sessionManager.getLeafId();
			if (!boundary) throw new Error("Could not persist window boundary.");
			return { compaction: { summary: window.recovery, firstKeptEntryId: boundary, tokensBefore: event.preparation.tokensBefore, details: window } };
		} catch (error) { fail(ctx, error); return { cancel: true }; }
	});
	pi.on("session_compact", (_event, ctx) => { projected = []; projectionAnchor = undefined; warned = ""; notifyReset(pi, ctx); sync(ctx); });
	pi.on("session_shutdown", () => { removeOwnership(); });
}
