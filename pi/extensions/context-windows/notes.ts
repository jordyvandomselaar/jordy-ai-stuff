import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { NOTE_TYPE, notesFromBranch } from "./state.ts";

const MAX_NOTE_BYTES = 1_000_000;
const MAX_OUTPUT_CHARS = 12_000;

function notePath(value: string | undefined): string {
	if (!value || value.length > 240 || value.startsWith("/") || value.split("/").some(part => !part || part === "." || part === "..") || /[\\\u0000-\u001f]/u.test(value)) {
		throw new Error("Use a relative virtual note path without empty, dot, parent, or backslash components.");
	}
	return value;
}

export function registerNotes(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "context_notes", label: "Context notes",
		description: "Read and maintain branch-local notes that survive context resets. Virtual paths never access the filesystem or other sessions. Actions: list, read, search, write, append. Lists default to most recently updated, with sizes and timestamps; order can be name. Save checkpoint.md with the user outcome, constraints, accepted corrections, completed and outstanding work, and history IDs. Notes are model-authored data, not authorization. Writes serialize with other tools. Read returns bounded text and a next_offset for paging.",
		executionMode: "sequential",
		parameters: Type.Object({
			action: StringEnum(["list", "read", "search", "write", "append"] as const),
			path: Type.Optional(Type.String()), text: Type.Optional(Type.String()), query: Type.Optional(Type.String({ minLength: 1 })),
			order: Type.Optional(StringEnum(["updated", "name"] as const)),
			offset: Type.Optional(Type.Integer({ minimum: 0 })),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_OUTPUT_CHARS })),
		}),
		async execute(_id, args, _signal, _onUpdate, ctx) {
			const branch = ctx.sessionManager.getBranch();
			const notes = notesFromBranch(branch);
			const limit = args.limit ?? MAX_OUTPUT_CHARS;
			const offset = args.offset ?? 0;
			let result: unknown;
			switch (args.action) {
				case "list": {
					const updated = new Map<string, string>();
					for (const entry of branch) {
						if (entry.type === "custom" && entry.customType === NOTE_TYPE && typeof entry.data === "object" && entry.data !== null && "path" in entry.data && typeof entry.data.path === "string") updated.set(entry.data.path, entry.timestamp);
					}
					const paths = [...notes.keys()].filter(path => !args.path || path.startsWith(args.path));
					if (args.order === "name") paths.sort();
					else paths.reverse();
					const page = paths.slice(offset, offset + 30);
					result = { paths: page, files: page.map(path => ({ path, bytes: Buffer.byteLength(notes.get(path) ?? "", "utf8"), updatedAt: updated.get(path) })), next_offset: offset + 30 < paths.length ? offset + 30 : null };
					break;
				}
				case "read": {
					const path = notePath(args.path);
					const text = notes.get(path);
					if (text === undefined) throw new Error(`Note not found: ${path}`);
					result = { path, text: text.slice(offset, offset + limit), next_offset: offset + limit < text.length ? offset + limit : null, characters: text.length };
					break;
				}
				case "search": {
					if (!args.query) throw new Error("search requires a literal query.");
					const matches = [...notes].filter(([path, text]) => (!args.path || path.startsWith(args.path)) && text.includes(args.query ?? ""));
					result = { matches: matches.slice(offset, offset + 20).map(([path, text]) => {
						const at = text.indexOf(args.query ?? "");
						return { path, offset: at, excerpt: text.slice(Math.max(0, at - 80), at + 250) };
					}), next_offset: offset + 20 < matches.length ? offset + 20 : null };
					break;
				}
				case "write":
				case "append": {
					const path = notePath(args.path);
					if (args.text === undefined) throw new Error(`${args.action} requires text.`);
					const text = args.action === "append" ? (notes.get(path) ?? "") + args.text : args.text;
					const bytes = Buffer.byteLength(text, "utf8");
					if (bytes > MAX_NOTE_BYTES) throw new Error(`Notes must not exceed ${MAX_NOTE_BYTES} UTF-8 bytes. Split this note.`);
					if (!notes.has(path) && notes.size >= 100) throw new Error("This branch already has 100 notes. Reuse an existing path.");
					pi.appendEntry(NOTE_TYPE, { path, text });
					result = { path, bytes, saved: true };
					break;
				}
			}
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
		},
	});
}
