import policy from "./git-risk.json" with { type: "json" };

export type GitTier = "reversible" | "external" | "irreversible";
export interface GitArguments {
	command: string;
	flags: Map<string, string | boolean>;
	enabled: Set<string>;
	operands: string[];
	paths: string[];
	separator: boolean;
}
interface Option { name: string; short?: string; value: "none" | "required" | "optional" }

/** Only control-sensitive commands need an option grammar. Unknown syntax never defaults to safe. */
export function parseGitArguments(args: readonly string[]): GitArguments {
	if (!Array.isArray(args) || !args.length || args.some((arg) => typeof arg !== "string" || arg.includes("\0")) || !/^[a-z][a-z0-9-]*$/.test(args[0])) {
		throw new Error("GIT_ARGUMENT_INVALID: args 首项必须是 Git 子命令；目录通过 cwd 指定，不支持全局参数或 shell 字符串");
	}
	const result: GitArguments = { command: args[0], flags: new Map(), enabled: new Set(), operands: [], paths: [], separator: false };
	const grammar = (policy.options as Record<string, string[]>)[result.command];
	if (!grammar) return result;
	const options: Option[] = grammar.map((spec) => {
		const value = spec.endsWith("=") ? "required" : spec.endsWith("?") ? "optional" : "none";
		const [name, short] = (value === "none" ? spec : spec.slice(0, -1)).split("|"); return { name, short, value };
	});
	function set(option: Option, value: string | boolean) {
		result.flags.set(option.name, value);
		if (value !== false) result.enabled.add(option.name);
	}
	for (let i = 1; i < args.length; i++) {
		const arg = args[i];
		if (result.separator) { result.paths.push(arg); continue; }
		if (arg === "--") { result.separator = true; continue; }
		if (!arg.startsWith("-") || arg === "-") { result.operands.push(arg); continue; }
		const long = arg.startsWith("--");
		const tokens = long ? [arg.slice(2)] : [...arg.slice(1)];
		for (let j = 0; j < tokens.length; j++) {
			const token = tokens[j]; const equals = token.indexOf("=");
			const rawName = equals < 0 ? token : token.slice(0, equals);
			const negated = long && rawName.startsWith("no-"); const name = negated ? rawName.slice(3) : rawName;
			const option = options.find((item) => long ? item.name === name : item.short === name);
			if (!option || (negated && option.value === "required")) throw unsupported(arg);
			let attached = long ? equals < 0 ? undefined : token.slice(equals + 1) : option.value !== "none" && j + 1 < tokens.length ? tokens.slice(j + 1).join("") : undefined;
			if (negated || option.value === "none") {
				if (attached !== undefined) throw unsupported(arg);
				set(option, !negated); continue;
			}
			if (attached === undefined && option.value === "required") {
				if (i + 1 >= args.length || args[i + 1].startsWith("-")) throw unsupported(`${arg}（值以 - 开头时请使用附加值写法）`);
				attached = args[++i];
			}
			set(option, attached ?? true);
			if (!long) break;
		}
	}
	return result;
}

export function argumentTier(args: readonly string[], parsed = parseGitArguments(args)): GitTier {
	const { command, enabled, flags } = parsed;
	const rules = policy.irreversible as Record<string, string[]>;
	if (rules.always.includes(command)) return "irreversible";
	if (["stash", "reflog"].includes(command)) {
		// Check all tokens conservatively: these subcommands also accept options before the action.
		if (args.slice(1).some((arg) => rules[command].includes(arg))) return "irreversible";
	} else if ((rules[command] ?? []).some((flag) => enabled.has(flag))) return "irreversible";
	// gc prunes by default; only an explicit --no-prune removes that risk.
	if (command === "gc" && flags.get("prune") !== false) return "irreversible";
	if (command === "branch" && enabled.has("delete") && enabled.has("force")) return "irreversible";
	if (command === "restore" && (flags.get("staged") !== true || enabled.has("worktree"))) return "irreversible";
	if (command === "checkout" && (parsed.paths.length > 0 || parsed.operands.length > 1)) return "irreversible";
	if (command === "push" && [...parsed.operands, ...parsed.paths].some(destructiveRefspec)) return "irreversible";
	return policy.external.includes(command) ? "external" : "reversible";
}

export function destructiveRefspec(value: string): boolean { return value.startsWith("+") || (value.startsWith(":") && value.length > 1); }
function unsupported(arg: string): Error { return new Error(`GIT_ARGUMENT_UNSUPPORTED: 无法可靠分档的 Git 参数 ${arg}；请使用完整选项名和明确参数，不能通过 shell 绕过受控动作`); }
