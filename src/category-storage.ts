import { DEFAULT_CATEGORIES } from "./constants";
import { normalizeCategoryRecord } from "./parser";
import type { CategoryRecord, WeeklyRoutinePlannerSettings } from "./types";

type SaveSettings = (settings: WeeklyRoutinePlannerSettings) => Promise<void>;

export class CategoryStorageAdapter {
  constructor(
    private readonly getSettings: () => WeeklyRoutinePlannerSettings,
    private readonly saveSettings: SaveSettings,
  ) {}

  async loadCategories(): Promise<CategoryRecord[]> {
    const settings = this.getSettings();
    return settings.categories.length > 0 ? settings.categories : DEFAULT_CATEGORIES;
  }

  async saveCategories(categories: CategoryRecord[]): Promise<void> {
    const normalizedCategories = categories
      .map((record) => normalizeCategoryRecord(record))
      .filter((record): record is CategoryRecord => record !== null);

    const settings = {
      ...this.getSettings(),
      categories: normalizedCategories,
    };
    await this.saveSettings(settings);
  }
}
