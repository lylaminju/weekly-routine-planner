import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTimetableConfig } from "../src/timetable-config";

void test("normalizeTimetableConfig parses and clamps settings values", () => {
  const config = normalizeTimetableConfig({
    startHour: "6",
    endHour: "25",
    hourHeight: "47",
  });

  assert.deepEqual(config, {
    startHour: 6,
    endHour: 24,
    hourHeight: 48,
  });
});

void test("normalizeTimetableConfig keeps end hour after start hour", () => {
  const config = normalizeTimetableConfig({
    startHour: 23,
    endHour: 20,
    hourHeight: 8,
  });

  assert.deepEqual(config, {
    startHour: 23,
    endHour: 24,
    hourHeight: 16,
  });
});
