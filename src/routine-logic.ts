import {
  MINUTES_PER_HOUR,
  MIN_EVENT_DURATION_MIN,
  SNAP_INTERVAL_MIN,
} from "./constants";
import type { CategoryRecord, RoutineItem, TimetableConfig } from "./types";

export interface RoutineDragPoint {
  day: number;
  hour: number;
  min: number;
}

export interface RoutineTimeRange {
  startTotalMinutes: number;
  endTotalMinutes: number;
}

export function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function toTotalMinutes(hour: number, minute: number): number {
  return hour * MINUTES_PER_HOUR + minute;
}

export function fromTotalMinutes(totalMinutes: number): Omit<RoutineDragPoint, "day"> {
  const bounded = Math.max(0, totalMinutes);
  return {
    hour: Math.floor(bounded / MINUTES_PER_HOUR),
    min: bounded % MINUTES_PER_HOUR,
  };
}

export function getTimetableBounds(config: TimetableConfig): RoutineTimeRange {
  return {
    startTotalMinutes: config.startHour * MINUTES_PER_HOUR,
    endTotalMinutes: config.endHour * MINUTES_PER_HOUR,
  };
}

export function getRoutineDurationMinutes(routine: RoutineItem): number {
  return (
    toTotalMinutes(routine.endHour, routine.endMin) -
    toTotalMinutes(routine.startHour, routine.startMin)
  );
}

export function getSnappedDragPointFromOffset(
  day: number,
  yOffset: number,
  config: TimetableConfig,
): RoutineDragPoint {
  const bounds = getTimetableBounds(config);
  const rawMinutes = bounds.startTotalMinutes + (yOffset / config.hourHeight) * MINUTES_PER_HOUR;
  const snappedMinutes =
    Math.round(rawMinutes / SNAP_INTERVAL_MIN) * SNAP_INTERVAL_MIN;
  const boundedMinutes = clampNumber(
    snappedMinutes,
    bounds.startTotalMinutes,
    bounds.endTotalMinutes,
  );

  return {
    day,
    ...fromTotalMinutes(boundedMinutes),
  };
}

export function getSnappedDragPointFromColumnClientY(
  day: number,
  clientY: number,
  columnTop: number,
  config: TimetableConfig,
): RoutineDragPoint {
  return getSnappedDragPointFromOffset(day, clientY - columnTop, config);
}

export function getCreateRoutineRange(
  start: RoutineDragPoint,
  current: RoutineDragPoint,
  config: TimetableConfig,
): RoutineTimeRange {
  const bounds = getTimetableBounds(config);
  let startTotal = Math.min(
    toTotalMinutes(start.hour, start.min),
    toTotalMinutes(current.hour, current.min),
  );
  let endTotal = Math.max(
    toTotalMinutes(start.hour, start.min),
    toTotalMinutes(current.hour, current.min),
  );

  startTotal = clampNumber(startTotal, bounds.startTotalMinutes, bounds.endTotalMinutes);
  endTotal = clampNumber(endTotal, bounds.startTotalMinutes, bounds.endTotalMinutes);

  if (endTotal - startTotal < MIN_EVENT_DURATION_MIN) {
    endTotal = Math.min(bounds.endTotalMinutes, startTotal + MIN_EVENT_DURATION_MIN);
  }

  if (endTotal - startTotal < MIN_EVENT_DURATION_MIN) {
    startTotal = Math.max(bounds.startTotalMinutes, endTotal - MIN_EVENT_DURATION_MIN);
  }

  return {
    startTotalMinutes: startTotal,
    endTotalMinutes: endTotal,
  };
}

export function moveRoutineWithinBounds(
  routine: RoutineItem,
  target: RoutineDragPoint,
  config: TimetableConfig,
): RoutineItem {
  const bounds = getTimetableBounds(config);
  const availableDuration = bounds.endTotalMinutes - bounds.startTotalMinutes;
  const duration = clampNumber(
    getRoutineDurationMinutes(routine),
    SNAP_INTERVAL_MIN,
    availableDuration,
  );
  const requestedStart = toTotalMinutes(target.hour, target.min);
  const startTotal = clampNumber(
    requestedStart,
    bounds.startTotalMinutes,
    bounds.endTotalMinutes - duration,
  );
  const endTotal = startTotal + duration;
  const startPoint = fromTotalMinutes(startTotal);
  const endPoint = fromTotalMinutes(endTotal);

  return {
    ...routine,
    day: target.day,
    startHour: startPoint.hour,
    startMin: startPoint.min,
    endHour: endPoint.hour,
    endMin: endPoint.min,
  };
}

export function resizeRoutineWithinBounds(
  routine: RoutineItem,
  target: RoutineDragPoint,
  config: TimetableConfig,
): RoutineItem {
  const bounds = getTimetableBounds(config);
  const startTotal = toTotalMinutes(routine.startHour, routine.startMin);
  const minEndTotal = Math.min(
    bounds.endTotalMinutes,
    startTotal + SNAP_INTERVAL_MIN,
  );
  const requestedEnd = toTotalMinutes(target.hour, target.min);
  const endTotal = clampNumber(
    requestedEnd,
    minEndTotal,
    bounds.endTotalMinutes,
  );
  const endPoint = fromTotalMinutes(endTotal);

  return {
    ...routine,
    endHour: endPoint.hour,
    endMin: endPoint.min,
  };
}

export function removeCategoryFromList(
  categories: CategoryRecord[],
  categoryId: string,
): CategoryRecord[] {
  return categories.filter((category) => category.id !== categoryId);
}
