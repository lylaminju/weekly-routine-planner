import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getManagedRegion,
  insertRoutineIntoManagedContent,
  migrateLegacyNoteContent,
  parseRoutineLine,
  updateRoutineInManagedContent,
} from "../src/parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const legacyFixturePath = path.resolve(__dirname, "fixtures/weekly-routine-legacy.md");
const legacyFixtureContent = fs.readFileSync(legacyFixturePath, "utf8");
const migratedNotePath = path.resolve(__dirname, "../../../../📅 Weekly Routine Planner.md");
const migratedNoteContent = fs.readFileSync(migratedNotePath, "utf8");

test("migrateLegacyNoteContent replaces dataview block and wraps routine region", () => {
  const migrated = migrateLegacyNoteContent(legacyFixtureContent);

  assert.equal(migrated.changed, true);
  assert.match(migrated.content, /```weekly-routine/);
  assert.match(migrated.content, /<!-- weekly-routine:start -->/);
  assert.match(migrated.content, /<!-- weekly-routine:end -->/);
  assert.doesNotMatch(migrated.content, /startHour:/);
  assert.doesNotMatch(migrated.content, /endHour:/);
  assert.doesNotMatch(migrated.content, /hourHeight:/);

  const region = getManagedRegion(migrated.content.split("\n"));
  assert.ok(region);
  assert.equal(region.collection.routines.length > 0, true);
});

test("parser handles existing multilingual titles in the fixture", () => {
  const migrated = migrateLegacyNoteContent(legacyFixtureContent);
  const region = getManagedRegion(migrated.content.split("\n"));
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
  const migrated = migrateLegacyNoteContent(legacyFixtureContent);
  const region = getManagedRegion(migrated.content.split("\n"));
  assert.ok(region);

  const inserted = insertRoutineIntoManagedContent(migrated.content, {
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

test("live migrated note already satisfies the managed-region contract", () => {
  const region = getManagedRegion(migratedNoteContent.split("\n"));
  assert.ok(region);
  assert.equal(region.collection.routines.length > 0, true);
  assert.equal(migrateLegacyNoteContent(migratedNoteContent).changed, false);
});
