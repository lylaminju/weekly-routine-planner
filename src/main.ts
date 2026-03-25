import { MarkdownView, Plugin, TFile } from "obsidian";
import { CategoryStorageAdapter } from "./category-storage";
import { CODE_BLOCK_LANGUAGE, DEFAULT_SETTINGS } from "./constants";
import { WeeklyRoutinePlannerSettingTab } from "./settings-tab";
import { normalizeTimetableConfig } from "./timetable-config";
import { WeeklyRoutineRenderChild } from "./timetable-renderer";
import type { TimetableConfig, WeeklyRoutinePlannerSettings } from "./types";

export default class WeeklyRoutinePlannerPlugin extends Plugin {
  settings: WeeklyRoutinePlannerSettings = DEFAULT_SETTINGS;
  categoryStorage!: CategoryStorageAdapter;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.categoryStorage = new CategoryStorageAdapter(
      () => this.settings,
      async (settings) => {
        this.settings = settings;
        await this.saveSettings();
      },
    );

    this.registerMarkdownCodeBlockProcessor(CODE_BLOCK_LANGUAGE, (_source, el, ctx) => {
      const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      if (!(file instanceof TFile)) {
        el.setText("Weekly Routine Planner: source note not found.");
        return;
      }

      const child = new WeeklyRoutineRenderChild(this, el, file, ctx.sourcePath);
      ctx.addChild(child);
    });

    this.addSettingTab(new WeeklyRoutinePlannerSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<WeeklyRoutinePlannerSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...stored,
      categories: stored?.categories?.length ? stored.categories : DEFAULT_SETTINGS.categories,
      timetableConfig: normalizeTimetableConfig(stored?.timetableConfig),
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async updateTimetableConfig(config: Partial<TimetableConfig>): Promise<void> {
    this.settings = {
      ...this.settings,
      timetableConfig: normalizeTimetableConfig({
        ...this.settings.timetableConfig,
        ...config,
      }),
    };
    await this.saveSettings();
    this.refreshOpenTimetables();
  }

  private refreshOpenTimetables(): void {
    this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
      if (leaf.view instanceof MarkdownView) {
        leaf.view.previewMode?.rerender(true);
      }
    });
  }
}
