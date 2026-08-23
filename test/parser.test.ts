import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getManagedRegion,
  insertRoutineIntoManagedContent,
  parseFilterDirective,
  parseRoutineLine,
  slugifyEventIdSuffix,
  updateRoutineInManagedContent,
} from "../src/parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routineFixturePath = path.resolve(__dirname, "fixtures/weekly-routine-note.md");
const routineFixtureContent = fs.readFileSync(routineFixturePath, "utf8");

void test("managed note fixture satisfies the routine region contract", () => {
  const region = getManagedRegion(routineFixtureContent.split("\n"));
  assert.ok(region);
  assert.equal(region.collection.routines.length > 0, true);
});

void test("parser handles existing multilingual titles in the managed fixture", () => {
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

void test("managed inserts and updates stay within the marked region", () => {
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

void test("parseRoutineLine accepts the timetable line format", () => {
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

void test("parseRoutineLine rejects invalid time values and impossible ranges", () => {
  assert.equal(
    parseRoutineLine("- [s-a] Monday 25:99-30:00 | Invalid hours"),
    null,
  );
  assert.equal(
    parseRoutineLine("- [s-a] Monday 23:30-23:15 | Ends before start"),
    null,
  );
  assert.equal(
    parseRoutineLine("- [s-a] Monday 23:30-24:15 | Past midnight minute"),
    null,
  );
  assert.deepEqual(
    parseRoutineLine("- [s-a] Monday 23:30-24:00 | Late work"),
    {
      eventId: "s-a",
      day: 0,
      startHour: 23,
      startMin: 30,
      endHour: 24,
      endMin: 0,
      title: "Late work",
      tags: "",
    },
  );
});

void test("slugifyEventIdSuffix normalizes user-typed routine IDs", () => {
  assert.equal(slugifyEventIdSuffix("Gym Day!"), "gymday");
  assert.equal(slugifyEventIdSuffix("s-work"), "work");
  assert.equal(slugifyEventIdSuffix("  Work-1  "), "work1");
  assert.equal(slugifyEventIdSuffix("---"), "");
});

void test("parseFilterDirective extracts category ids from the filter directive", () => {
  assert.deepEqual(parseFilterDirective("filter: [study, part-time-work]"), [
    "study",
    "part-time-work",
  ]);
  assert.deepEqual(parseFilterDirective("filter:[Study,  Part Time Work ]"), [
    "study",
    "part-time-work",
  ]);
  assert.deepEqual(parseFilterDirective(""), []);
  assert.deepEqual(parseFilterDirective("filter: []"), []);
});
