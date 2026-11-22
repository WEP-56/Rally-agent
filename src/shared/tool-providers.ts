export const SEARCH_PROVIDERS = { tavily: "Tavily", exa: "Exa", brave: "Brave Search" } as const;
export type SearchProviderId = keyof typeof SEARCH_PROVIDERS;

export type ImageResponseFormat = "b64_json" | "url";

export interface ImageProvider {
	id: string;
	name: string;
	baseUrl: string;
	models: string[];
	responseFormat?: ImageResponseFormat;
}

export interface ImageSelection {
	providerId: string;
	model: string;
}

export interface ToolProviderPreferences {
	preferredImage: ImageSelection | null;
	preferredSearch: SearchProviderId | null;
}

/** Keys are write-only on both transports. An omitted key retains the existing one. */
export interface ToolProviderUpdate extends ToolProviderPreferences {
	revision: string;
	images: (ImageProvider & { apiKey?: string })[];
	search: { id: SearchProviderId; apiKey?: string }[];
}

export interface ToolProviderState extends ToolProviderPreferences {
	revision: string;
	images: ImageProvider[];
	search: SearchProviderId[];
	error?: string;
}
