import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const ConfigSchema = Type.Object({
	version: Type.Literal(1),
	enabledModels: Type.Array(Type.String()),
	workBudgets: Type.Optional(Type.Record(Type.String(), Type.Integer({ minimum: 1 }))),
}, { additionalProperties: false });
export type Config = Static<typeof ConfigSchema>;
export const CONFIG_NAME = "context-windows.json";

export function modelKey(model: { provider: string; id: string }): string {
	return `${model.provider}/${model.id}`;
}

export async function loadConfig(agentDir: string): Promise<Config> {
	let text: string;
	try {
		text = await readFile(join(agentDir, CONFIG_NAME), "utf8");
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
			return { version: 1, enabledModels: [] };
		}
		throw error;
	}
	const value: unknown = JSON.parse(text);
	if (!Value.Check(ConfigSchema, value)) throw new Error(`Invalid ${CONFIG_NAME}: expected version 1 and enabledModels.`);
	return value;
}

export async function setModelEnabled(agentDir: string, key: string, enabled: boolean): Promise<Config> {
	return updateConfig(agentDir, config => {
		const models = new Set(config.enabledModels);
		if (enabled) models.add(key);
		else models.delete(key);
		return { ...config, enabledModels: [...models].sort() };
	});
}

export async function setWorkBudget(agentDir: string, key: string, tokens: number | undefined): Promise<Config> {
	return updateConfig(agentDir, config => {
		const workBudgets = { ...config.workBudgets };
		if (tokens === undefined) delete workBudgets[key];
		else workBudgets[key] = tokens;
		return { ...config, workBudgets };
	});
}

async function updateConfig(agentDir: string, update: (config: Config) => Config): Promise<Config> {
	await mkdir(agentDir, { recursive: true });
	const path = join(agentDir, CONFIG_NAME);
	const lock = `${path}.lock`;
	// A cross-process lock prevents two Pi sessions from losing each other's model preferences.
	await mkdir(lock).catch(error => {
		throw new Error(`Cannot lock ${CONFIG_NAME}. Another session may be saving it. Retry after it finishes.`, { cause: error });
	});
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		const next = update(await loadConfig(agentDir));
		if (!Value.Check(ConfigSchema, next)) throw new Error("Work budgets must be positive whole tokens.");
		await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
		await rename(temporary, path);
		return next;
	} finally {
		await rm(temporary, { force: true });
		await rm(lock, { recursive: true, force: true });
	}
}
