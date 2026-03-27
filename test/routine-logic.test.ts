import test from "node:test";
import assert from "node:assert/strict";
import {
  getCreateRoutineRange,
  getSnappedDragPointFromOffset,
  moveRoutineWithinBounds,
  removeCategoryFromList,
  resizeRoutineWithinBounds,
} from "../src/routine-logic";
import { SerialTaskQueue } from "../src/serial-task-queue";
import type { RoutineItem, TimetableConfig } from "../src/types";

const config: TimetableConfig = {
  startHour: 6,
  endHour: 24,
  hourHeight: 48,
};

const sampleRoutine: RoutineItem = {
  eventId: "s-a",
  day: 0,
  startHour: 22,
  startMin: 30,
  endHour: 23,
  endMin: 30,
  title: "Deep work",
  tags: "#study",
};

test("getSnappedDragPointFromOffset clamps and normalizes to timetable bounds", () => {
  assert.deepEqual(getSnappedDragPointFromOffset(2, -100, config), {
    day: 2,
    hour: 6,
    min: 0,
  });
  assert.deepEqual(getSnappedDragPointFromOffset(2, config.hourHeight * 18, config), {
    day: 2,
    hour: 24,
    min: 0,
  });
});

test("getCreateRoutineRange enforces minimum duration near the timetable end", () => {
  const range = getCreateRoutineRange(
    { day: 0, hour: 23, min: 45 },
    { day: 0, hour: 24, min: 0 },
    config,
  );

  assert.deepEqual(range, {
    startTotalMinutes: 1410,
    endTotalMinutes: 1440,
  });
});

test("moveRoutineWithinBounds preserves duration and clamps to the timetable end", () => {
  const moved = moveRoutineWithinBounds(
    sampleRoutine,
    { day: 1, hour: 23, min: 30 },
    config,
  );

  assert.deepEqual(
    {
      day: moved.day,
      startHour: moved.startHour,
      startMin: moved.startMin,
      endHour: moved.endHour,
      endMin: moved.endMin,
    },
    {
      day: 1,
      startHour: 23,
      startMin: 0,
      endHour: 24,
      endMin: 0,
    },
  );
});

test("resizeRoutineWithinBounds respects minimum duration and timetable bounds", () => {
  const resized = resizeRoutineWithinBounds(
    sampleRoutine,
    { day: 0, hour: 22, min: 35 },
    config,
  );
  assert.deepEqual(
    {
      endHour: resized.endHour,
      endMin: resized.endMin,
    },
    {
      endHour: 22,
      endMin: 45,
    },
  );

  const clamped = resizeRoutineWithinBounds(
    sampleRoutine,
    { day: 0, hour: 25, min: 0 },
    config,
  );
  assert.deepEqual(
    {
      endHour: clamped.endHour,
      endMin: clamped.endMin,
    },
    {
      endHour: 24,
      endMin: 0,
    },
  );
});

test("removeCategoryFromList preserves the current local modal state", () => {
  const categories = [
    { id: "daily-routine", label: "Daily Routine", color: "cyan" },
    { id: "study", label: "Study", color: "green" },
    { id: "new-category", label: "New Category", color: "blue" },
  ];

  assert.deepEqual(removeCategoryFromList(categories, "study"), [
    { id: "daily-routine", label: "Daily Routine", color: "cyan" },
    { id: "new-category", label: "New Category", color: "blue" },
  ]);
});

test("SerialTaskQueue runs mutations sequentially", async () => {
  const queue = new SerialTaskQueue();
  const order: string[] = [];
  let releaseFirst: () => void = () => {
    throw new Error("First task was not initialized");
  };

  const first = queue.run(
    async () =>
      await new Promise<void>((resolve) => {
        order.push("first:start");
        releaseFirst = () => {
          order.push("first:end");
          resolve();
        };
      }),
  );

  const second = queue.run(async () => {
    order.push("second:start");
    order.push("second:end");
  });

  await Promise.resolve();
  assert.deepEqual(order, ["first:start"]);

  releaseFirst();
  await first;
  await second;

  assert.deepEqual(order, [
    "first:start",
    "first:end",
    "second:start",
    "second:end",
  ]);
});
