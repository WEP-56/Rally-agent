import * as bundledPiAgentCore from "@rally/agent-core";
import * as bundledPiAiModels from "@rally/ai/models";
import * as bundledPiAiOauth from "@rally/ai/oauth";
import * as bundledPiAiProviders from "@rally/ai/providers/all";
import * as bundledPiTui from "@rally/tui";
import * as bundledTypebox from "typebox";
import * as bundledTypeboxCompile from "typebox/compile";
import * as bundledTypeboxValue from "typebox/value";
// This import is safe because loader.ts exports are not re-exported from index.ts.
// Extensions can therefore import from @rally/coding-agent.
import * as bundledPiCodingAgent from "../../index.ts";
import * as bundledPiAiExtensionView from "./pi-ai-extension-view.ts";

/** Modules available to extensions in source and compiled binary runtimes. */
export const VIRTUAL_MODULES: Record<string, unknown> = {
	typebox: bundledTypebox,
	"typebox/compile": bundledTypeboxCompile,
	"typebox/value": bundledTypeboxValue,
	"@sinclair/typebox": bundledTypebox,
	"@sinclair/typebox/compile": bundledTypeboxCompile,
	"@sinclair/typebox/value": bundledTypeboxValue,
	"@rally/agent-core": bundledPiAgentCore,
	"@rally/tui": bundledPiTui,
	// Extensions resolve the pi-ai root to the compat entrypoint (a strict
	// superset of the core entrypoint) plus TypeBox's Type, Static and TSchema:
	// existing extensions using the old global API and pi-ai's former TypeBox
	// re-exports keep working.
	"@rally/ai": bundledPiAiExtensionView,
	"@rally/ai/compat": bundledPiAiExtensionView,
	"@rally/ai/models": bundledPiAiModels,
	"@rally/ai/oauth": bundledPiAiOauth,
	"@rally/ai/providers/all": bundledPiAiProviders,
	"@rally/coding-agent": bundledPiCodingAgent,
	// Pi-ecosystem extensions import the upstream package names; keep them as aliases.
	"@earendil-works/pi-agent-core": bundledPiAgentCore,
	"@earendil-works/pi-tui": bundledPiTui,
	"@earendil-works/pi-ai": bundledPiAiExtensionView,
	"@earendil-works/pi-ai/compat": bundledPiAiExtensionView,
	"@earendil-works/pi-ai/models": bundledPiAiModels,
	"@earendil-works/pi-ai/oauth": bundledPiAiOauth,
	"@earendil-works/pi-ai/providers/all": bundledPiAiProviders,
	"@earendil-works/pi-coding-agent": bundledPiCodingAgent,
	"@mariozechner/pi-agent-core": bundledPiAgentCore,
	"@mariozechner/pi-tui": bundledPiTui,
	"@mariozechner/pi-ai": bundledPiAiExtensionView,
	"@mariozechner/pi-ai/compat": bundledPiAiExtensionView,
	"@mariozechner/pi-ai/models": bundledPiAiModels,
	"@mariozechner/pi-ai/oauth": bundledPiAiOauth,
	"@mariozechner/pi-ai/providers/all": bundledPiAiProviders,
	"@mariozechner/pi-coding-agent": bundledPiCodingAgent,
};
