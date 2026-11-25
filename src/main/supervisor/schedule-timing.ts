import type { ScheduleTiming, ScheduleWindow } from "../../shared/schedules.ts";

const MINUTE = 60000;
const DAY = 86400000;

function minutesOfDay(time: string): number {
	const [hours, minutes] = time.split(":").map(Number);
	return hours * 60 + minutes;
}

function validTime(time: string, allowEndOfDay = false): boolean {
	return typeof time === "string" && (/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || (allowEndOfDay && time === "24:00"));
}

function weekdays(days: number[] | undefined): number[] | undefined {
	if (days === undefined) return undefined;
	if (!Array.isArray(days) || !days.length || days.length > 7 || days.some(day => !Number.isInteger(day) || day < 1 || day > 7)) {
		throw new Error("星期须为 1–7 的非空列表，1 为周一，7 为周日");
	}
	const unique = [...new Set(days)].sort((a, b) => a - b);
	return unique.length === 7 ? undefined : unique;
}

function localClock(timezone: string): Intl.DateTimeFormat {
	if (typeof timezone !== "string" || !timezone.trim()) throw new Error("需要 IANA 时区");
	return new Intl.DateTimeFormat("en-GB", {
		timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
		hour: "2-digit", minute: "2-digit", hourCycle: "h23",
	});
}

/** Validate persisted/tool input and normalize field order and equivalent weekday lists. */
export function normalizeTiming(timing: ScheduleTiming): ScheduleTiming {
	if (!timing || typeof timing !== "object") throw new Error("需要有效的时间规则");
	if (timing.kind === "once") {
		if (!Number.isFinite(timing.at) || !Number.isFinite(new Date(timing.at).getTime())) throw new Error("执行时间必须是有效的未来时间");
		return { kind: "once", at: timing.at };
	}
	if (timing.kind === "daily") {
		if (!validTime(timing.time)) throw new Error("每日时间须为 HH:mm");
		localClock(timing.timezone);
		return { kind: "daily", time: timing.time, timezone: timing.timezone, weekdays: weekdays(timing.weekdays) };
	}
	if (timing.kind !== "interval") throw new Error("无效时间规则");
	if (!Number.isInteger(timing.minutes) || timing.minutes < 1 || timing.minutes > 525600) throw new Error("间隔必须为 1–525600 分钟");
	if (timing.window === undefined) return { kind: "interval", minutes: timing.minutes };
	const window = timing.window;
	if (!window || !validTime(window.start) || !validTime(window.end, true) || window.start === window.end) {
		throw new Error("运行时段须包含有效且不同的起止时间 HH:mm；结束时间可为 24:00");
	}
	const duration = (minutesOfDay(window.end) - minutesOfDay(window.start) + 1440) % 1440 || 1440;
	if (timing.minutes > duration) throw new Error("限定时段内的间隔不能超过时段长度；每个时段从开始时间重新计时");
	localClock(window.timezone);
	return { kind: "interval", minutes: timing.minutes, window: {
		start: window.start, end: window.end, timezone: window.timezone, weekdays: weekdays(window.weekdays),
	} };
}

function localTime(clock: Intl.DateTimeFormat, at: number): { date: number; minute: number; weekday: number } {
	const parts = Object.fromEntries(clock.formatToParts(at).map(part => [part.type, part.value]));
	const date = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
	return { date, minute: Number(parts.hour) * 60 + Number(parts.minute), weekday: new Date(date).getUTCDay() || 7 };
}

function windowOffset(window: ScheduleWindow, local: ReturnType<typeof localTime>): number | null {
	const start = minutesOfDay(window.start);
	const end = minutesOfDay(window.end);
	const overnight = end < start;
	const inside = overnight
		? local.minute >= start || local.minute < end
		: local.minute >= start && local.minute < end;
	if (!inside) return null;
	const openingDay = overnight && local.minute < end ? (local.weekday + 5) % 7 + 1 : local.weekday;
	if (window.weekdays && !window.weekdays.includes(openingDay)) return null;
	return (local.minute - start + 1440) % 1440;
}

/** Restrictions apply to catch-up dispatch and first start, even after approval/capacity waits. */
export function isScheduleTimeAllowed(timing: ScheduleTiming, at: number): boolean {
	if (timing.kind === "daily") {
		return !timing.weekdays || timing.weekdays.includes(localTime(localClock(timing.timezone), at).weekday);
	}
	if (timing.kind !== "interval" || !timing.window) return true;
	return windowOffset(timing.window, localTime(localClock(timing.window.timezone), at)) !== null;
}

/** Wall-clock schedules skip missing DST minutes and run a repeated local minute only once. */
export function nextOccurrence(input: ScheduleTiming, after: number, previousDueAt?: number): number {
	if (!Number.isFinite(new Date(after).getTime())) throw new Error("当前时间无效");
	const timing = normalizeTiming(input);
	if (timing.kind === "once") {
		if (timing.at <= after) throw new Error("执行时间必须是有效的未来时间");
		return timing.at;
	}
	if (timing.kind === "interval" && !timing.window) {
		const period = timing.minutes * MINUTE;
		const anchor = previousDueAt ?? after;
		return anchor + (Math.floor((after - anchor) / period) + 1) * period;
	}
	const zone = timing.kind === "daily" ? timing.timezone : timing.window!.timezone;
	const clock = localClock(zone);
	const before = localTime(clock, after);
	const previous = previousDueAt === undefined ? before : localTime(clock, previousDueAt);
	const lastWallMinute = Math.max(before.date + before.minute * MINUTE, previous.date + previous.minute * MINUTE);
	// Two weeks cover a weekly time skipped by a spring-forward transition.
	for (let at = Math.floor(after / MINUTE) * MINUTE + MINUTE; at <= after + 16 * DAY; at += MINUTE) {
		const local = localTime(clock, at);
		if (local.date + local.minute * MINUTE <= lastWallMinute) continue;
		if (timing.kind === "daily") {
			if (local.minute === minutesOfDay(timing.time) && (!timing.weekdays || timing.weekdays.includes(local.weekday))) return at;
		} else {
			const offset = windowOffset(timing.window!, local);
			if (offset !== null && offset % timing.minutes === 0) return at;
		}
	}
	throw new Error("无法计算下一次执行时间");
}
