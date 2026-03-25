import {
  DEFAULT_TIMETABLE_CONFIG,
  HOUR_HEIGHT_STEP,
  MAX_END_HOUR,
  MAX_HOUR_HEIGHT,
  MAX_START_HOUR,
  MIN_END_HOUR,
  MIN_HOUR_HEIGHT,
  MIN_START_HOUR,
} from "./constants";
import type { TimetableConfig } from "./types";

type NumericLike = string | number | boolean | null | undefined;
type ConfigLike = Partial<Record<keyof TimetableConfig, NumericLike>> | null | undefined;

function parseNumber(value: NumericLike, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalizeTimetableConfig(config?: ConfigLike): TimetableConfig {
  const startHour = clamp(
    parseNumber(config?.startHour, DEFAULT_TIMETABLE_CONFIG.startHour),
    MIN_START_HOUR,
    MAX_START_HOUR,
  );

  const endHour = clamp(
    parseNumber(config?.endHour, DEFAULT_TIMETABLE_CONFIG.endHour),
    Math.max(MIN_END_HOUR, startHour + 1),
    MAX_END_HOUR,
  );

  const rawHourHeight = parseNumber(config?.hourHeight, DEFAULT_TIMETABLE_CONFIG.hourHeight);
  const steppedHourHeight = Math.round(rawHourHeight / HOUR_HEIGHT_STEP) * HOUR_HEIGHT_STEP;
  const hourHeight = clamp(steppedHourHeight, MIN_HOUR_HEIGHT, MAX_HOUR_HEIGHT);

  return {
    startHour,
    endHour,
    hourHeight,
  };
}
