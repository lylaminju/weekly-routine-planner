# Weekly Routine Planner

An Obsidian plugin for planning weekly routines with a timetable-style editor and a fenced `weekly-routine` block.

It is meant for recurring weekly structure, not dated calendar events or one-off schedules. The plugin is currently desktop-only.

Start hour, end hour, and hour height are configured in the plugin settings.

## Note Format

~~~md
```weekly-routine
```
<!-- weekly-routine:start -->
- [s-1] Monday 08:00-08:30 | Wake up | #daily-routine
-
<!-- weekly-routine:end -->
~~~

The fenced code block marks the note as a weekly routine planner note.
The plugin only writes inside the region between `<!-- weekly-routine:start -->` and `<!-- weekly-routine:end -->`, so the rest of the note stays untouched.

Each routine line is stored as:

~~~md
- [event-id] Day HH:MM-HH:MM | Title | #category-tag
~~~

## Category Management

Categories are managed by the user from the timetable UI:

1. Click `Manage categories` in the timetable toolbar.
2. Add, rename, recolor, or delete categories.

The same category manager is also available while creating or editing a routine.

Category definitions are saved in the plugin's data/settings, not directly in the note.
Inside the note, a routine only stores the selected category as a tag such as `#daily-routine`.

The category id is generated from the category name, so `Daily Routine` becomes `#daily-routine`.
If you rename a category, the plugin updates matching tags in the managed routine block.
If you delete a category, the plugin removes that category tag from affected routines.
