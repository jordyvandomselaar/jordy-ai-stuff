import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { currentWindow, type Window } from "./state.ts";

export const OWNERSHIP_EVENT = "context-windows:compaction-owner";
export const RESET_EVENT = "context-windows:reset";

export interface OwnershipRequest {
	sessionId: string;
	claim(owner: string): void;
}

export function registerOwnership(pi: ExtensionAPI, owns: (sessionId: string) => boolean): () => void {
	return pi.events.on(OWNERSHIP_EVENT, (value: unknown) => {
		if (typeof value !== "object" || value === null || !("sessionId" in value) || typeof value.sessionId !== "string" || !("claim" in value) || typeof value.claim !== "function") return;
		if (owns(value.sessionId)) value.claim("context-windows");
	});
}

export function notifyReset(pi: ExtensionAPI, ctx: ExtensionContext, window: Window | undefined = currentWindow(ctx.sessionManager.getBranch())): void {
	if (!window) return;
	pi.events.emit(RESET_EVENT, { sessionId: ctx.sessionManager.getSessionId(), window: window.id, previous: window.previous, reason: window.reason });
	ctx.ui.notify(`Context reset complete. Window ${window.id.slice(0, 8)}. Notes and history remain available.`, "info");
}
