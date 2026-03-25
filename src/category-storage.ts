import { Notice, TFile, normalizePath, type App } from "obsidian";
import { DEFAULT_CATEGORIES, LEGACY_CATEGORY_PATH } from "./constants";
import { normalizeCategoryRecord } from "./parser";
import type { CategoryRecord, WeeklyRoutinePlannerSettings } from "./types";

interface CategoryFilePayload {
  version: number;
  categories: CategoryRecord[];
}

type SaveSettings = (settings: WeeklyRoutinePlannerSettings) => Promise<void>;

export class CategoryStorageAdapter {
  constructor(
    private readonly app: App,
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

  async importLegacyCategoriesIfAvailable(): Promise<CategoryRecord[] | null> {
    if (!this.shouldAutoImportLegacyCategories()) return null;

    const imported = await this.readCategoriesFile(LEGACY_CATEGORY_PATH);
    if (imported.length === 0) {
      return null;
    }

    await this.saveCategories(imported);
    return imported;
  }

  private async readCategoriesFile(path: string): Promise<CategoryRecord[]> {
    const normalizedPath = normalizePath(path);
    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!(file instanceof TFile)) return [];

    try {
      const content = await this.app.vault.read(file);
      const parsed = JSON.parse(content) as Partial<CategoryFilePayload>;
      return Array.isArray(parsed.categories)
        ? parsed.categories
            .map((record) => normalizeCategoryRecord(record))
            .filter((record): record is CategoryRecord => record !== null)
        : [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Weekly Routine Planner: Failed to read categories: ${message}`, 5000);
      return [];
    }
  }

  private shouldAutoImportLegacyCategories(): boolean {
    const currentCategories = this.getSettings().categories;
    if (currentCategories.length === 0) return true;
    return JSON.stringify(currentCategories) === JSON.stringify(DEFAULT_CATEGORIES);
  }
}
