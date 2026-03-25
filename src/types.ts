export interface RoutineItem {
  eventId: string;
  day: number;
  startHour: number;
  startMin: number;
  endHour: number;
  endMin: number;
  title: string;
  tags: string;
}

export interface CategoryRecord {
  id: string;
  label: string;
  color: string;
}

export interface TimetableConfig {
  startHour: number;
  endHour: number;
  hourHeight: number;
}

export interface WeeklyRoutinePlannerSettings {
  categories: CategoryRecord[];
  timetableConfig: TimetableConfig;
}

export interface RoutineCollection {
  routines: RoutineItem[];
  routineLineIndices: number[];
  separatorLineIndices: number[];
  managedLineIndices: number[];
}

export interface ManagedRegion {
  startMarkerIndex: number;
  endMarkerIndex: number;
  collection: RoutineCollection;
}

export interface MigrationResult {
  changed: boolean;
  content: string;
}
