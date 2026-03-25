import type { CategoryRecord, TimetableConfig, WeeklyRoutinePlannerSettings } from "./types";

export const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const DAY_ABBREV = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const MINUTES_PER_HOUR = 60;
export const SNAP_INTERVAL_MIN = 15;
export const MIN_EVENT_DURATION_MIN = 30;
export const MIN_EVENT_HEIGHT_PX = 20;
export const EVENT_HEIGHT_PADDING_PX = 2;
export const MIN_START_HOUR = 0;
export const MAX_START_HOUR = 23;
export const MIN_END_HOUR = 1;
export const MAX_END_HOUR = 24;
export const MIN_HOUR_HEIGHT = 16;
export const MAX_HOUR_HEIGHT = 96;
export const HOUR_HEIGHT_STEP = 4;
export const EVENT_ID_PREFIX = "s-";
export const EVENT_ID_REGEX = /^s-([0-9a-z]+)$/;
export const ROUTINE_REGEX =
  /^-\s*\[(s-[0-9a-z]+)\]\s*(\w+)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*\|\s*([^|]+)(?:\s*\|\s*(.+))?$/;

export const COLOR_OPTIONS = [
  "blue",
  "purple",
  "green",
  "orange",
  "yellow",
  "red",
  "pink",
  "cyan",
  "gray",
] as const;

export const CODE_BLOCK_LANGUAGE = "weekly-routine";
export const MANAGED_REGION_START = "<!-- weekly-routine:start -->";
export const MANAGED_REGION_END = "<!-- weekly-routine:end -->";

export const DEFAULT_TIMETABLE_CONFIG: TimetableConfig = {
  startHour: 6,
  endHour: 24,
  hourHeight: 48,
};

export const DEFAULT_CATEGORIES: CategoryRecord[] = [
  { id: "part-time-work", label: "Part Time Work", color: "purple" },
  { id: "study", label: "Study", color: "green" },
  { id: "workout", label: "Workout", color: "red" },
  { id: "side-project", label: "Side Project", color: "pink" },
  { id: "work", label: "Work", color: "purple" },
  { id: "job-apply", label: "Job Apply", color: "blue" },
  { id: "meetup", label: "Meetup", color: "orange" },
  { id: "daily-routine", label: "Daily Routine", color: "cyan" },
];

export const DEFAULT_SETTINGS: WeeklyRoutinePlannerSettings = {
  categories: DEFAULT_CATEGORIES,
  timetableConfig: DEFAULT_TIMETABLE_CONFIG,
};
