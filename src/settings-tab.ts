import { App, PluginSettingTab, Setting } from "obsidian";
import {
  HOUR_HEIGHT_STEP,
  MAX_END_HOUR,
  MAX_HOUR_HEIGHT,
  MAX_START_HOUR,
  MIN_END_HOUR,
  MIN_HOUR_HEIGHT,
  MIN_START_HOUR,
} from "./constants";
import type WeeklyRoutinePlannerPlugin from "./main";

export class WeeklyRoutinePlannerSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: WeeklyRoutinePlannerPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const { timetableConfig } = this.plugin.settings;

    new Setting(containerEl)
      .setName("Start hour")
      .setDesc("First hour shown in the timetable.")
      .addSlider((slider) => {
        slider
          .setLimits(MIN_START_HOUR, Math.min(MAX_START_HOUR, timetableConfig.endHour - 1), 1)
          .setValue(timetableConfig.startHour)
          .setDynamicTooltip()
          .setInstant(false)
          .onChange(async (value) => {
            await this.plugin.updateTimetableConfig({ startHour: value });
            this.display();
          });
      });

    new Setting(containerEl)
      .setName("End hour")
      .setDesc("Last hour shown in the timetable.")
      .addSlider((slider) => {
        slider
          .setLimits(Math.max(MIN_END_HOUR, timetableConfig.startHour + 1), MAX_END_HOUR, 1)
          .setValue(timetableConfig.endHour)
          .setDynamicTooltip()
          .setInstant(false)
          .onChange(async (value) => {
            await this.plugin.updateTimetableConfig({ endHour: value });
            this.display();
          });
      });

    new Setting(containerEl)
      .setName("Hour height")
      .setDesc("Height of each hour row in pixels.")
      .addSlider((slider) => {
        slider
          .setLimits(MIN_HOUR_HEIGHT, MAX_HOUR_HEIGHT, HOUR_HEIGHT_STEP)
          .setValue(timetableConfig.hourHeight)
          .setDynamicTooltip()
          .setInstant(false)
          .onChange(async (value) => {
            await this.plugin.updateTimetableConfig({ hourHeight: value });
          });
      });
  }
}
