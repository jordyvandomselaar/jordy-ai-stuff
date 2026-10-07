import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { currentWindow, notesFromBranch } from "./state.ts";
import { currentGoal } from "./live-context.ts";

type PendingCheckpoint = {
	sessionId: string;
	windowId: string;
	leafId: string | null;
	successful: boolean;
	finish: (saved: boolean) => void;
};

/** Manual resets use the active agent and its tools before changing the window. */
export function registerManualReset(pi: ExtensionAPI) {
	let pending: PendingCheckpoint | undefined;

	pi.on("tool_call", event => {
		if (pending && !["context_notes", "context_history"].includes(event.toolName)) {
			return { block: true, reason: "Manual reset is saving checkpoint.md. Use context_notes or context_history, then stop; the extension will reset the window.", terminate: true };
		}
		return undefined;
	});
	pi.on("turn_end", event => {
		if (pending) pending.successful = event.message.role === "assistant" && event.message.stopReason === "stop";
	});
	function finish(ctx: ExtensionContext): void {
		if (!pending) return;
		const checkpoint = pending;
		const branch = ctx.sessionManager.getBranch();
		const sameWindow = checkpoint.sessionId === ctx.sessionManager.getSessionId() &&
			checkpoint.windowId === (currentWindow(branch)?.id ?? "initial");
		const startIndex = checkpoint.leafId === null ? -1 : branch.findIndex(entry => entry.id === checkpoint.leafId);
		const fresh = notesFromBranch(branch.slice(startIndex + 1)).get("checkpoint.md");
		checkpoint.finish(sameWindow && (checkpoint.leafId === null || startIndex >= 0) && checkpoint.successful && !!fresh?.trim());
	}
	pi.on("agent_settled", (_event, ctx) => { finish(ctx); });
	const cancel = () => { pending?.finish(false); };
	pi.on("input", (_event, ctx) => {
		if (pending) {
			cancel();
			ctx.ui.notify("Reset cancelled by new user input. The current context and your new message are retained.", "info");
		}
	});
	pi.on("session_start", cancel);
	pi.on("model_select", cancel);
	pi.on("session_tree", cancel);
	pi.on("session_shutdown", cancel);

	return {
		isPending: () => pending !== undefined,
		async save(ctx: ExtensionContext, instructions = "", signal?: AbortSignal): Promise<boolean> {
			if (pending || signal?.aborted) return false;
			if (currentGoal(ctx.sessionManager.getBranch())?.status === "active") {
				ctx.ui.notify("Reset not started. Run /goal pause, then retry /compact. Active goal continuations cannot settle during a manual checkpoint.", "warning");
				return false;
			}
			const abort = () => { ctx.abort(); };
			signal?.addEventListener("abort", abort, { once: true });
			try {
				const completed = new Promise<boolean>(resolve => {
					pending = {
						sessionId: ctx.sessionManager.getSessionId(),
						windowId: currentWindow(ctx.sessionManager.getBranch())?.id ?? "initial",
						leafId: ctx.sessionManager.getLeafId(),
						successful: false,
						finish(saved) { pending = undefined; resolve(saved); },
					};
				});
				ctx.ui.notify("Saving checkpoint.md before resetting the context window. Cancel to keep the current window.", "info");
				pi.sendMessage({
					customType: "context-windows-checkpoint", display: false,
					content: "The user requested a manual context reset. Before resetting, use context_notes to write a fresh, nonempty checkpoint.md. " +
						"Preserve the user's outcome, constraints, accepted corrections, completed work, outstanding work, blockers, and useful history IDs. " +
						"Record the underlying task and next action, not checkpointing as the task. " +
						"Do not carry this checkpoint run's temporary stop/tool restrictions into the saved task instructions. " +
						"Use the current conversation and any existing notes; read context_history if needed. Do not perform task work or use other tools. " +
						"After the write succeeds, respond briefly and stop. Do not call new_context; the extension resets only after this checkpoint run finishes successfully. " +
						"This request does not change the user's task or grant new authorization." +
						(instructions ? `\nAdditional checkpoint instructions from the user:\n${instructions}` : ""),
				}, { triggerTurn: true, deliverAs: "followUp" });
				const saved = await completed && !signal?.aborted;
				if (!saved) ctx.ui.notify("Reset cancelled. No context was cleared. The checkpoint run did not finish with a saved checkpoint.md. Retry /compact or /context-windows reset.", "warning");
				return saved;
			} finally {
				signal?.removeEventListener("abort", abort);
			}
		},
	};
}
