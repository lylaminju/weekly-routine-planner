# Weekly Routine Planner

An Obsidian plugin for planning weekly routines with a timetable-style editor and a fenced `weekly-routine` block.

It is meant for repeatable weekly routine planning, not dated calendar events or one-off schedules.

Start hour, end hour, and hour height are configured in the plugin settings, not note frontmatter.

## Note Format

````md
```weekly-routine
```
<!-- weekly-routine:start -->
- [s-1] Monday 08:00-08:30 | Wake up | #daily-routine
-
<!-- weekly-routine:end -->
````

The plugin uses the marked region as the only writable routine block in the note.

## Commands

- `Weekly Routine Planner: Migrate note from Dataview timetable`

## Migration From Dataview

The migration command converts an existing DataviewJS timetable note into the fenced plugin block, wraps the routine lines with the managed markers above, and imports legacy categories from `5. Dev/weeklyTimetable/categories.json` when that file exists.

## Category Storage

Categories are stored automatically in plugin data. There is no storage mode to configure.
