import type { ActiveSelection } from "./models.ts";

/** Settings for the two background coaches (memory upkeep, idea finding). */
export interface CoachSettings {
	enabled: boolean;
	/** The coach runs only when a model is chosen. */
	model: ActiveSelection | null;
	/** Local HH:mm. Memory upkeep starts at quietStart; no daytime ideas inside the window. */
	quietStart: string;
	quietEnd: string;
	ideasPerDay: 0 | 1 | 2;
}

export const DEFAULT_COACH: CoachSettings = { enabled: false, model: null, quietStart: "02:00", quietEnd: "08:00", ideasPerDay: 1 };
