import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getManagedRegion,
  insertRoutineIntoManagedContent,
  parseRoutineLine,
  updateRoutineInManagedContent,
} from "../src/parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routineFixturePath = path.resolve(__dirname, "fixtures/weekly-routine-note.md");
const routineFixtureContent = fs.readFileSync(routineFixturePath, "utf8");

test("managed note fixture satisfies the routine region contract", () => {
  const region = getManagedRegion(routineFixtureContent.split("\n"));
  assert.ok(region);
  assert.equal(region.collection.routines.length > 0, true);
});

test("parser handles existing multilingual titles in the managed fixture", () => {
  const region = getManagedRegion(routineFixtureContent.split("\n"));
  assert.ok(region);

  const workout = region.collection.routines.find(
    (routine) =>
      routine.day === 2 &&
      routine.startHour === 14 &&
      routine.startMin === 0,
  );

  assert.ok(workout);
  assert.match(workout.title, /상체 운동/);
});

test("managed inserts and updates stay within the marked region", () => {
  const region = getManagedRegion(routineFixtureContent.split("\n"));
  assert.ok(region);

  const inserted = insertRoutineIntoManagedContent(routineFixtureContent, {
    eventId: "s-zz",
    day: 6,
    startHour: 9,
    startMin: 0,
    endHour: 10,
    endMin: 0,
    title: "Sunday test",
    tags: "#study",
  });
  const insertedRegion = getManagedRegion(inserted.split("\n"));
  assert.ok(insertedRegion);
  assert.equal(insertedRegion.collection.routines.some((routine) => routine.eventId === "s-zz"), true);
  assert.match(inserted, /<!-- weekly-routine:start -->/);
  assert.match(inserted, /<!-- weekly-routine:end -->/);

  const existing = insertedRegion.collection.routines[0];
  assert.ok(existing);
  const updated = updateRoutineInManagedContent(inserted, {
    ...existing,
    title: "Updated title",
  });
  const updatedRegion = getManagedRegion(updated.split("\n"));
  assert.ok(updatedRegion);
  assert.equal(updatedRegion.collection.routines.some((routine) => routine.title === "Updated title"), true);
});

test("parseRoutineLine accepts the timetable line format", () => {
  const parsed = parseRoutineLine("- [s-a] Monday 08:00-09:30 | Deep work | #study");
  assert.deepEqual(parsed, {
    eventId: "s-a",
    day: 0,
    startHour: 8,
    startMin: 0,
    endHour: 9,
    endMin: 30,
    title: "Deep work",
    tags: "#study",
  });
});
