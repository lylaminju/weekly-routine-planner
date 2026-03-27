import {
  DAYS,
  EVENT_ID_PREFIX,
  EVENT_ID_REGEX,
  MANAGED_REGION_END,
  MANAGED_REGION_START,
  MINUTES_PER_HOUR,
  ROUTINE_REGEX,
} from "./constants";
import { toTotalMinutes } from "./routine-logic";
import type {
  CategoryRecord,
  ManagedRegion,
  RoutineCollection,
  RoutineItem,
} from "./types";

export function formatTime(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

export function formatTitleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function slugifyCategoryId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeCategoryRecord(record: Partial<CategoryRecord> | null | undefined): CategoryRecord | null {
  if (!record) return null;

  const label = typeof record.label === "string" ? record.label.trim() : "";
  const id = slugifyCategoryId(typeof record.id === "string" ? record.id : label);
  const color = typeof record.color === "string" ? record.color.trim().toLowerCase() : "";

  if (!id || !color) return null;

  return {
    id,
    label: label || formatTitleCase(id),
    color,
  };
}

export function parseTagList(tags: string): string[] {
  return tags
    .split(/\s+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function serializeTagList(tags: string[]): string {
  return tags.filter(Boolean).join(" ");
}

export function replaceCategoryTag(
  tags: string,
  oldCategoryId: string,
  nextCategoryId = "",
): { changed: boolean; tags: string } {
  const targetTag = `#${oldCategoryId}`;
  const nextTag = nextCategoryId ? `#${nextCategoryId}` : "";
  const result: string[] = [];
  let changed = false;

  parseTagList(tags).forEach((tag) => {
    if (tag === targetTag) {
      changed = true;
      if (nextTag && !result.includes(nextTag)) result.push(nextTag);
      return;
    }

    if (!result.includes(tag)) result.push(tag);
  });

  return {
    changed,
    tags: serializeTagList(result),
  };
}

export function getEventIdNumber(eventId: string): number | null {
  const match = eventId.toLowerCase().match(EVENT_ID_REGEX);
  if (!match) return null;
  const parsed = Number.parseInt(match[1]!, 36);
  return Number.isNaN(parsed) ? null : parsed;
}

export function createEventId(existingRoutines: Array<RoutineItem | string>, usedIds?: Set<string>): string {
  let maxNumber = 0;

  existingRoutines.forEach((item) => {
    const eventId = typeof item === "string" ? item : item.eventId;
    const idNumber = getEventIdNumber(eventId);
    if (idNumber !== null && idNumber > maxNumber) maxNumber = idNumber;
  });

  usedIds?.forEach((eventId) => {
    const idNumber = getEventIdNumber(eventId);
    if (idNumber !== null && idNumber > maxNumber) maxNumber = idNumber;
  });

  let nextNumber = maxNumber + 1;
  let candidate = `${EVENT_ID_PREFIX}${nextNumber.toString(36)}`;
  while (usedIds?.has(candidate)) {
    nextNumber += 1;
    candidate = `${EVENT_ID_PREFIX}${nextNumber.toString(36)}`;
  }
  return candidate;
}

export function ensureValidEventId(
  routine: RoutineItem,
  usedIds?: Set<string>,
  existingRoutines: RoutineItem[] = [],
): string {
  const normalized = routine.eventId.toLowerCase();
  const isValid = EVENT_ID_REGEX.test(normalized);
  const isDuplicate = usedIds?.has(normalized) ?? false;

  routine.eventId = isValid && !isDuplicate ? normalized : createEventId(existingRoutines, usedIds);
  usedIds?.add(routine.eventId);
  return routine.eventId;
}

export function routineToText(routine: RoutineItem): string {
  const day = DAYS[routine.day] ?? DAYS[0];
  const startTime = formatTime(routine.startHour, routine.startMin);
  const endTime = formatTime(routine.endHour, routine.endMin);
  const text = `- [${routine.eventId}] ${day} ${startTime}-${endTime} | ${routine.title}`;
  return routine.tags ? `${text} | ${routine.tags}` : text;
}

export function parseRoutineLine(line: string): RoutineItem | null {
  const match = line.trim().match(ROUTINE_REGEX);
  if (!match) return null;

  const dayToken = match[2]!;
  const dayIndex = DAYS.findIndex((day) => day.toLowerCase().startsWith(dayToken.toLowerCase()));
  if (dayIndex === -1) return null;

  const startHour = Number.parseInt(match[3]!, 10);
  const startMin = Number.parseInt(match[4]!, 10);
  const endHour = Number.parseInt(match[5]!, 10);
  const endMin = Number.parseInt(match[6]!, 10);
  const startTotal = toTotalMinutes(startHour, startMin);
  const endTotal = toTotalMinutes(endHour, endMin);

  const hasInvalidHour =
    startHour < 0 ||
    startHour > 23 ||
    endHour < 0 ||
    endHour > 24;
  const hasInvalidMinute =
    startMin < 0 ||
    startMin > 59 ||
    endMin < 0 ||
    endMin > 59;
  const endsAfterMidnight = endHour === 24 && endMin !== 0;
  const hasInvalidRange = endTotal <= startTotal || endTotal > toTotalMinutes(24, 0);

  if (hasInvalidHour || hasInvalidMinute || endsAfterMidnight || hasInvalidRange) {
    return null;
  }

  return {
    eventId: match[1]!.toLowerCase(),
    day: dayIndex,
    startHour,
    startMin,
    endHour,
    endMin,
    title: match[7]!.trim(),
    tags: match[8]?.trim() ?? "",
  };
}

function collectRoutinesInRange(lines: string[], startIndex: number, endIndex: number): RoutineCollection {
  const routines: RoutineItem[] = [];
  const routineLineIndices: number[] = [];

  for (let index = startIndex; index < endIndex; index += 1) {
    const parsed = parseRoutineLine(lines[index] ?? "");
    if (!parsed) continue;
    routineLineIndices.push(index);
    routines.push(parsed);
  }

  const separatorLineIndices: number[] = [];
  const hasRoutineAround = (fromIndex: number, step: number): boolean => {
    for (let index = fromIndex; index >= startIndex && index < endIndex; index += step) {
      const line = lines[index] ?? "";
      const trimmed = line.trim();
      if (!trimmed || trimmed === "-") continue;
      return parseRoutineLine(line) !== null;
    }
    return false;
  };

  if (routineLineIndices.length > 0) {
    const firstRoutineLine = routineLineIndices[0]!;
    const lastRoutineLine = routineLineIndices[routineLineIndices.length - 1]!;

    for (let index = firstRoutineLine; index <= lastRoutineLine; index += 1) {
      if (
        (lines[index] ?? "").trim() === "-" &&
        hasRoutineAround(index - 1, -1) &&
        hasRoutineAround(index + 1, 1)
      ) {
        separatorLineIndices.push(index);
      }
    }
  }

  return {
    routines,
    routineLineIndices,
    separatorLineIndices,
    managedLineIndices: [...routineLineIndices, ...separatorLineIndices].sort((a, b) => a - b),
  };
}

export function getManagedRegion(lines: string[]): ManagedRegion | null {
  const startMarkerIndex = lines.findIndex((line) => line.trim() === MANAGED_REGION_START);
  const endMarkerIndex = lines.findIndex(
    (line, index) => index > startMarkerIndex && line.trim() === MANAGED_REGION_END,
  );

  if (startMarkerIndex === -1 || endMarkerIndex === -1) return null;

  return {
    startMarkerIndex,
    endMarkerIndex,
    collection: collectRoutinesInRange(lines, startMarkerIndex + 1, endMarkerIndex),
  };
}

export function compareRoutines(left: RoutineItem, right: RoutineItem): number {
  if (left.day !== right.day) return left.day - right.day;

  const leftStart = left.startHour * MINUTES_PER_HOUR + left.startMin;
  const rightStart = right.startHour * MINUTES_PER_HOUR + right.startMin;
  if (leftStart !== rightStart) return leftStart - rightStart;

  const leftEnd = left.endHour * MINUTES_PER_HOUR + left.endMin;
  const rightEnd = right.endHour * MINUTES_PER_HOUR + right.endMin;
  if (leftEnd !== rightEnd) return leftEnd - rightEnd;

  const titleComparison = left.title.localeCompare(right.title);
  if (titleComparison !== 0) return titleComparison;

  return left.eventId.localeCompare(right.eventId);
}

export function buildSortedRoutineLines(routines: RoutineItem[]): string[] {
  if (routines.length === 0) return [];

  const cloned = routines.map((routine) => ({ ...routine }));
  const usedIds = new Set<string>();
  cloned.forEach((routine) => ensureValidEventId(routine, usedIds, cloned));

  const sorted = cloned.sort(compareRoutines);
  const sortedLines: string[] = [];
  let previousDay: number | null = null;

  sorted.forEach((routine) => {
    if (previousDay !== null && previousDay !== routine.day) {
      sortedLines.push("-");
    }
    sortedLines.push(routineToText(routine));
    previousDay = routine.day;
  });

  return sortedLines;
}

export function rewriteManagedRoutines(content: string, routines: RoutineItem[]): string {
  const lines = content.split("\n");
  const region = getManagedRegion(lines);
  if (!region) {
    throw new Error("Managed timetable region not found");
  }

  const sortedRoutineLines = buildSortedRoutineLines(routines);
  const nextLines = [...lines];
  nextLines.splice(
    region.startMarkerIndex + 1,
    region.endMarkerIndex - region.startMarkerIndex - 1,
    ...sortedRoutineLines,
  );
  return nextLines.join("\n");
}

export function insertRoutineIntoManagedContent(content: string, routine: RoutineItem): string {
  const region = getManagedRegion(content.split("\n"));
  if (!region) throw new Error("Managed timetable region not found");
  const nextRoutines = [...region.collection.routines, routine];
  return rewriteManagedRoutines(content, nextRoutines);
}

export function updateRoutineInManagedContent(content: string, routine: RoutineItem): string {
  const region = getManagedRegion(content.split("\n"));
  if (!region) throw new Error("Managed timetable region not found");

  const nextRoutines = region.collection.routines.map((current) =>
    current.eventId === routine.eventId ? routine : current,
  );
  if (!nextRoutines.some((current) => current.eventId === routine.eventId)) {
    throw new Error("Event not found by ID");
  }

  return rewriteManagedRoutines(content, nextRoutines);
}

export function deleteRoutineFromManagedContent(content: string, eventId: string): string {
  const region = getManagedRegion(content.split("\n"));
  if (!region) throw new Error("Managed timetable region not found");

  const nextRoutines = region.collection.routines.filter((routine) => routine.eventId !== eventId);
  if (nextRoutines.length === region.collection.routines.length) {
    throw new Error("Event not found by ID");
  }

  return rewriteManagedRoutines(content, nextRoutines);
}

export function rewriteCategoriesInManagedContent(
  content: string,
  oldCategoryId: string,
  nextCategoryId = "",
): string {
  const region = getManagedRegion(content.split("\n"));
  if (!region) throw new Error("Managed timetable region not found");

  const nextRoutines = region.collection.routines.map((routine) => {
    const update = replaceCategoryTag(routine.tags, oldCategoryId, nextCategoryId);
    return update.changed ? { ...routine, tags: update.tags } : routine;
  });

  return rewriteManagedRoutines(content, nextRoutines);
}
