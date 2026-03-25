import { MarkdownRenderChild, Notice, TFile } from "obsidian";
import {
  CODE_BLOCK_LANGUAGE,
  COLOR_OPTIONS,
  DAY_ABBREV,
  DAYS,
  DEFAULT_TIMETABLE_CONFIG,
  EVENT_HEIGHT_PADDING_PX,
  MANAGED_REGION_END,
  MANAGED_REGION_START,
  MIN_EVENT_DURATION_MIN,
  MIN_EVENT_HEIGHT_PX,
  MINUTES_PER_HOUR,
  SNAP_INTERVAL_MIN,
} from "./constants";
import {
  collectLegacyRoutines,
  createEventId,
  deleteRoutineFromManagedContent,
  formatTime,
  formatTitleCase,
  getManagedRegion,
  insertRoutineIntoManagedContent,
  parseTagList,
  replaceCategoryTag,
  rewriteCategoriesInManagedContent,
  slugifyCategoryId,
  updateRoutineInManagedContent,
} from "./parser";
import type WeeklyRoutinePlannerPlugin from "./main";
import type { CategoryRecord, RoutineItem, TimetableConfig } from "./types";

type DragMode = "create" | "move" | "resize" | null;

interface DragPoint {
  day: number;
  hour: number;
  min: number;
}

interface EventPopupDraft {
  title?: string;
  selectedCategory?: string;
}

export class WeeklyRoutineRenderChild extends MarkdownRenderChild {
  private routines: RoutineItem[] = [];
  private categories: CategoryRecord[] = [];
  private config: TimetableConfig = DEFAULT_TIMETABLE_CONFIG;
  private isInitialized = false;
  private legacyRoutineCount = 0;
  private isDragging = false;
  private dragMode: DragMode = null;
  private dragStart: DragPoint | null = null;
  private dragCurrent: DragPoint | null = null;
  private draggedEventId: string | null = null;
  private floatingElements = new Set<HTMLElement>();

  constructor(
    private readonly plugin: WeeklyRoutinePlannerPlugin,
    containerEl: HTMLElement,
    private readonly file: TFile,
    private readonly sourcePath: string,
  ) {
    super(containerEl);
  }

  async onload(): Promise<void> {
    this.containerEl.empty();
    this.containerEl.addClass("weekly-routine-host");

    this.registerDomEvent(this.containerEl, "mousedown", (event) => this.handleMouseDown(event));
    this.registerDomEvent(this.containerEl, "contextmenu", (event) => this.handleContextMenu(event));
    this.registerDomEvent(document, "mousemove", (event) => this.handleMouseMove(event));
    this.registerDomEvent(document, "mouseup", () => {
      void this.handleMouseUp();
    });
    this.registerDomEvent(document, "click", () => this.hideContextMenu());

    this.registerEvent(
      this.plugin.app.vault.on("modify", (file) => {
        if (file.path === this.file.path) {
          void this.refresh();
        }
      }),
    );
    this.registerEvent(
      this.plugin.app.metadataCache.on("changed", (file) => {
        if (file.path === this.file.path) {
          void this.refresh();
        }
      }),
    );

    await this.refresh();
  }

  onunload(): void {
    this.hideContextMenu();
    this.floatingElements.forEach((element) => element.remove());
    this.floatingElements.clear();
    this.containerEl.empty();
  }

  private async refresh(): Promise<void> {
    this.categories = await this.plugin.categoryStorage.loadCategories();
    this.config = this.plugin.settings.timetableConfig;

    const content = await this.plugin.app.vault.read(this.file);
    const lines = content.split("\n");
    const managedRegion = getManagedRegion(lines);
    this.isInitialized = managedRegion !== null;
    this.legacyRoutineCount = this.isInitialized ? 0 : collectLegacyRoutines(lines).routines.length;
    this.routines = managedRegion?.collection.routines ?? [];

    this.render();
  }

  private render(): void {
    this.containerEl.empty();
    this.hideContextMenu();

    const root = this.containerEl.createDiv({ cls: "weekly-routine" });
    root.style.setProperty("--hour-height", `${this.config.hourHeight}px`);

    if (!this.isInitialized) {
      this.renderUninitializedState(root);
      return;
    }

    const container = root.createDiv({ cls: "timetable-container" });
    const toolbar = container.createDiv({ cls: "timetable-toolbar" });
    toolbar.createDiv({ cls: "timetable-toolbar-spacer" });

    const manageCategoriesButton = toolbar.createEl("button", {
      cls: "timetable-toolbar-button",
      text: "Manage categories",
    });
    manageCategoriesButton.addEventListener("click", () => {
      void this.showCategoryManagerModal();
    });

    const header = container.createDiv({ cls: "timetable-header" });
    header.createDiv({ cls: "time-gutter" });
    DAY_ABBREV.forEach((day, index) => {
      const dayCell = header.createDiv({ cls: "day-header", text: day });
      dayCell.dataset.day = String(index);
    });

    const body = container.createDiv({ cls: "timetable-body" });
    const timeGutter = body.createDiv({ cls: "time-gutter" });
    for (let hour = this.config.startHour; hour < this.config.endHour; hour += 1) {
      const timeLabel = timeGutter.createDiv({ cls: "time-label", text: formatTime(hour, 0) });
      timeLabel.style.height = `${this.config.hourHeight}px`;
    }

    for (let dayIndex = 0; dayIndex < DAYS.length; dayIndex += 1) {
      const dayColumn = body.createDiv({ cls: "day-column" });
      dayColumn.dataset.day = String(dayIndex);

      for (let hour = this.config.startHour; hour < this.config.endHour; hour += 1) {
        const hourCell = dayColumn.createDiv({ cls: "hour-cell" });
        hourCell.style.height = `${this.config.hourHeight}px`;
        hourCell.dataset.day = String(dayIndex);
        hourCell.dataset.hour = String(hour);
      }

      this.routines
        .filter((routine) => routine.day === dayIndex)
        .forEach((routine) => dayColumn.appendChild(this.createEventElement(routine)));
    }
  }

  private renderUninitializedState(root: HTMLElement): void {
    const emptyState = root.createDiv({ cls: "weekly-routine-empty" });
    emptyState.createEl("h3", { text: "Weekly routine not initialized for this note" });

    const bodyText =
      this.legacyRoutineCount > 0
        ? `Found ${this.legacyRoutineCount} legacy routine entries. Run migration to convert this note to the plugin format.`
        : `Add a fenced \`${CODE_BLOCK_LANGUAGE}\` block and the managed region markers ${MANAGED_REGION_START} / ${MANAGED_REGION_END}, or run the migration command on a legacy note.`;
    emptyState.createEl("p", { text: bodyText });

    const actions = emptyState.createDiv({ cls: "weekly-routine-empty-actions" });
    const migrateButton = actions.createEl("button", {
      cls: "timetable-toolbar-button",
      text: "Migrate This Note",
    });
    migrateButton.addEventListener("click", () => {
      void this.plugin.migrateNote(this.file);
    });
  }

  private createEventElement(routine: RoutineItem): HTMLElement {
    const element = document.createElement("div");
    element.className = "routine-event";
    element.dataset.eventId = routine.eventId;

    const startOffset =
      (routine.startHour - this.config.startHour) * this.config.hourHeight +
      (routine.startMin / MINUTES_PER_HOUR) * this.config.hourHeight;
    const duration =
      routine.endHour -
      routine.startHour +
      (routine.endMin - routine.startMin) / MINUTES_PER_HOUR;
    const height = duration * this.config.hourHeight;

    element.style.top = `${startOffset}px`;
    element.style.height = `${Math.max(height - EVENT_HEIGHT_PADDING_PX, MIN_EVENT_HEIGHT_PX)}px`;

    const title = document.createElement("div");
    title.className = "event-title";
    title.textContent = routine.title;

    const time = document.createElement("div");
    time.className = "event-time";
    time.textContent = `${formatTime(routine.startHour, routine.startMin)} - ${formatTime(routine.endHour, routine.endMin)}`;

    const resizeHandle = document.createElement("div");
    resizeHandle.className = "event-resize-handle";

    element.append(title, time, resizeHandle);
    this.applyCategoryStyle(element, routine.tags);
    return element;
  }

  private applyCategoryStyle(element: HTMLElement, tags: string): void {
    delete element.dataset.category;
    const categoryId = this.getCategoryIdFromTags(tags);
    const category = this.getCategoryById(categoryId);
    if (category) {
      element.dataset.category = category.color;
    }
  }

  private getCategoryById(categoryId: string | null): CategoryRecord | null {
    if (!categoryId) return null;
    return this.categories.find((category) => category.id === categoryId) ?? null;
  }

  private getCategoryIdFromTags(tags: string): string | null {
    for (const tag of parseTagList(tags)) {
      if (!tag.startsWith("#")) continue;
      const categoryId = slugifyCategoryId(tag.slice(1));
      if (this.getCategoryById(categoryId)) return categoryId;
    }
    return null;
  }

  private countRoutinesWithCategory(categoryId: string): number {
    const targetTag = `#${categoryId}`;
    return this.routines.filter((routine) => parseTagList(routine.tags).includes(targetTag)).length;
  }

  private getRoutineById(eventId: string | null): RoutineItem | null {
    if (!eventId) return null;
    return this.routines.find((routine) => routine.eventId === eventId) ?? null;
  }

  private getEventElementById(eventId: string | null): HTMLElement | null {
    if (!eventId) return null;
    return this.containerEl.querySelector(`.routine-event[data-event-id="${eventId}"]`);
  }

  private hideContextMenu(): void {
    this.floatingElements.forEach((element) => {
      if (element.classList.contains("event-context-menu")) {
        element.remove();
        this.floatingElements.delete(element);
      }
    });
  }

  private handleMouseDown(event: MouseEvent): void {
    if (!(event.target instanceof HTMLElement) || !this.isInitialized) return;

    const resizeHandle = event.target.closest(".event-resize-handle");
    if (resizeHandle instanceof HTMLElement) {
      const eventElement = resizeHandle.closest(".routine-event");
      const routine = this.getRoutineById(eventElement instanceof HTMLElement ? eventElement.dataset.eventId ?? null : null);
      if (!routine) return;

      this.isDragging = true;
      this.dragMode = "resize";
      this.dragStart = {
        day: routine.day,
        hour: routine.endHour,
        min: routine.endMin,
      };
      this.dragCurrent = { ...this.dragStart };
      this.draggedEventId = routine.eventId;
      event.preventDefault();
      return;
    }

    const eventElement = event.target.closest(".routine-event");
    if (eventElement instanceof HTMLElement) {
      const routine = this.getRoutineById(eventElement.dataset.eventId ?? null);
      if (!routine) return;

      this.isDragging = true;
      this.dragMode = "move";
      this.dragStart = {
        day: routine.day,
        hour: routine.startHour,
        min: routine.startMin,
      };
      this.dragCurrent = { ...this.dragStart };
      this.draggedEventId = routine.eventId;
      eventElement.classList.add("dragging");
      event.preventDefault();
      return;
    }

    const cell = event.target.closest(".hour-cell");
    if (!(cell instanceof HTMLElement)) return;

    const rect = cell.getBoundingClientRect();
    const day = Number.parseInt(cell.dataset.day ?? "", 10);
    const hour = Number.parseInt(cell.dataset.hour ?? "", 10);
    const minOffset = ((event.clientY - rect.top) / this.config.hourHeight) * MINUTES_PER_HOUR;
    const min = Math.round(minOffset / SNAP_INTERVAL_MIN) * SNAP_INTERVAL_MIN;

    if (Number.isNaN(day) || Number.isNaN(hour)) return;

    this.isDragging = true;
    this.dragMode = "create";
    this.dragStart = { day, hour, min: min % MINUTES_PER_HOUR };
    this.dragCurrent = { ...this.dragStart };
    this.draggedEventId = null;

    const preview = document.createElement("div");
    preview.className = "routine-event creating";
    preview.id = "weekly-routine-drag-preview";
    cell.closest(".day-column")?.appendChild(preview);
    this.updateDragPreview();
    event.preventDefault();
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.isDragging || !this.dragStart) return;

    const body = this.containerEl.querySelector(".timetable-body");
    if (!(body instanceof HTMLElement)) return;

    const columns = Array.from(body.querySelectorAll<HTMLElement>(".day-column"));
    let targetDay = -1;
    let targetColumn: HTMLElement | null = null;

    for (const [index, column] of columns.entries()) {
      const rect = column.getBoundingClientRect();
      if (event.clientX >= rect.left && event.clientX <= rect.right) {
        targetDay = index;
        targetColumn = column;
        break;
      }
    }

    if (targetDay === -1 || targetColumn === null) return;

    const rect = targetColumn.getBoundingClientRect();
    const yOffset = event.clientY - rect.top;
    const rawHour = this.config.startHour + yOffset / this.config.hourHeight;
    const hour = Math.floor(rawHour);
    const minute =
      Math.round(((rawHour - hour) * MINUTES_PER_HOUR) / SNAP_INTERVAL_MIN) * SNAP_INTERVAL_MIN;

    this.dragCurrent = {
      day: targetDay,
      hour: Math.max(this.config.startHour, Math.min(this.config.endHour, hour)),
      min: minute % MINUTES_PER_HOUR,
    };

    this.updateDragPreview();
  }

  private updateDragPreview(): void {
    if (!this.dragCurrent || !this.dragStart) return;

    if (this.dragMode === "create") {
      const preview = this.containerEl.querySelector("#weekly-routine-drag-preview");
      if (!(preview instanceof HTMLElement)) return;

      const targetColumn = this.containerEl.querySelectorAll(".day-column")[this.dragCurrent.day];
      if (targetColumn instanceof HTMLElement && preview.parentElement !== targetColumn) {
        preview.remove();
        targetColumn.appendChild(preview);
      }

      const startHour = Math.min(
        this.dragStart.hour + this.dragStart.min / MINUTES_PER_HOUR,
        this.dragCurrent.hour + this.dragCurrent.min / MINUTES_PER_HOUR,
      );
      const endHour = Math.max(
        this.dragStart.hour + this.dragStart.min / MINUTES_PER_HOUR,
        this.dragCurrent.hour + this.dragCurrent.min / MINUTES_PER_HOUR,
      );
      preview.style.top = `${(startHour - this.config.startHour) * this.config.hourHeight}px`;
      preview.style.height = `${Math.max((endHour - startHour) * this.config.hourHeight, this.config.hourHeight / 2)}px`;
      preview.replaceChildren();
      preview.appendChild(Object.assign(document.createElement("div"), { className: "event-title", textContent: "New Event" }));
      return;
    }

    if (this.dragMode === "move") {
      const eventElement = this.getEventElementById(this.draggedEventId);
      if (!(eventElement instanceof HTMLElement)) return;
      const targetColumn = this.containerEl.querySelectorAll(".day-column")[this.dragCurrent.day];
      if (targetColumn instanceof HTMLElement && eventElement.parentElement !== targetColumn) {
        eventElement.remove();
        targetColumn.appendChild(eventElement);
      }
      const top =
        (this.dragCurrent.hour - this.config.startHour + this.dragCurrent.min / MINUTES_PER_HOUR) *
        this.config.hourHeight;
      eventElement.style.top = `${Math.max(0, top)}px`;
      return;
    }

    if (this.dragMode === "resize") {
      const eventElement = this.getEventElementById(this.draggedEventId);
      const routine = this.getRoutineById(this.draggedEventId);
      if (!(eventElement instanceof HTMLElement) || !routine) return;
      const startOffset =
        (routine.startHour - this.config.startHour + routine.startMin / MINUTES_PER_HOUR) *
        this.config.hourHeight;
      const endOffset =
        (this.dragCurrent.hour - this.config.startHour + this.dragCurrent.min / MINUTES_PER_HOUR) *
        this.config.hourHeight;
      eventElement.style.height = `${Math.max(endOffset - startOffset, this.config.hourHeight / 4)}px`;
    }
  }

  private async handleMouseUp(): Promise<void> {
    if (!this.isDragging || !this.dragStart || !this.dragCurrent) return;

    this.isDragging = false;

    if (this.dragMode === "create") {
      this.containerEl.querySelector("#weekly-routine-drag-preview")?.remove();

      let startHour = this.dragStart.hour;
      let startMin = this.dragStart.min;
      let endHour = this.dragCurrent.hour;
      let endMin = this.dragCurrent.min;

      if (startHour > endHour || (startHour === endHour && startMin > endMin)) {
        [startHour, endHour] = [endHour, startHour];
        [startMin, endMin] = [endMin, startMin];
      }

      if (endHour === startHour && endMin - startMin < MIN_EVENT_DURATION_MIN) {
        endMin = startMin + MIN_EVENT_DURATION_MIN;
        if (endMin >= MINUTES_PER_HOUR) {
          endHour += 1;
          endMin -= MINUTES_PER_HOUR;
        }
      }

      await this.showEventPopup({
        day: this.dragCurrent.day,
        startHour,
        startMin,
        endHour,
        endMin,
      });
    } else if (this.dragMode === "move" && this.draggedEventId) {
      const routine = this.getRoutineById(this.draggedEventId);
      this.getEventElementById(this.draggedEventId)?.classList.remove("dragging");

      if (routine) {
        const duration =
          routine.endHour -
          routine.startHour +
          (routine.endMin - routine.startMin) / MINUTES_PER_HOUR;

        const nextRoutine: RoutineItem = {
          ...routine,
          day: this.dragCurrent.day,
          startHour: this.dragCurrent.hour,
          startMin: this.dragCurrent.min,
          endHour: this.dragCurrent.hour + Math.floor(duration),
          endMin: this.dragCurrent.min + Math.round((duration % 1) * MINUTES_PER_HOUR),
        };

        if (nextRoutine.endMin >= MINUTES_PER_HOUR) {
          nextRoutine.endHour += 1;
          nextRoutine.endMin -= MINUTES_PER_HOUR;
        }

        await this.updateRoutine(nextRoutine);
      }
    } else if (this.dragMode === "resize" && this.draggedEventId) {
      const routine = this.getRoutineById(this.draggedEventId);
      if (routine) {
        const nextRoutine: RoutineItem = {
          ...routine,
          endHour: this.dragCurrent.hour,
          endMin: this.dragCurrent.min,
        };

        const duration =
          nextRoutine.endHour -
          nextRoutine.startHour +
          (nextRoutine.endMin - nextRoutine.startMin) / MINUTES_PER_HOUR;
        if (duration < SNAP_INTERVAL_MIN / MINUTES_PER_HOUR) {
          nextRoutine.endHour = nextRoutine.startHour;
          nextRoutine.endMin = nextRoutine.startMin + SNAP_INTERVAL_MIN;
          if (nextRoutine.endMin >= MINUTES_PER_HOUR) {
            nextRoutine.endHour += 1;
            nextRoutine.endMin -= MINUTES_PER_HOUR;
          }
        }

        await this.updateRoutine(nextRoutine);
      }
    }

    this.dragMode = null;
    this.dragStart = null;
    this.dragCurrent = null;
    this.draggedEventId = null;
  }

  private async showEventPopup(
    eventData: Omit<RoutineItem, "eventId" | "title" | "tags">,
    draft: EventPopupDraft = {},
  ): Promise<void> {
    const overlay = this.createFloatingElement("div", "event-popup-overlay");
    const popup = overlay.createDiv({ cls: "event-popup" });
    popup.createEl("h3", { text: "New Routine" });
    popup.createDiv({
      cls: "event-popup-meta",
      text: `${DAYS[eventData.day]} ${formatTime(eventData.startHour, eventData.startMin)} - ${formatTime(eventData.endHour, eventData.endMin)}`,
    });

    const input = popup.createEl("input", {
      type: "text",
      attr: { placeholder: "Routine Title (e.g. Deep Work)" },
      value: draft.title ?? "",
    });
    const categorySelect = popup.createEl("select", { attr: { title: "Category" } });
    this.buildCategoryOptions(categorySelect, draft.selectedCategory ?? "");

    const buttons = popup.createDiv({ cls: "event-popup-buttons" });
    const manageButton = buttons.createEl("button", { cls: "secondary", text: "Manage categories" });
    const rightButtons = buttons.createDiv({ cls: "event-popup-buttons-right" });
    const cancelButton = rightButtons.createEl("button", { cls: "cancel", text: "Cancel" });
    const saveButton = rightButtons.createEl("button", { cls: "save", text: "Save" });

    const save = async (): Promise<void> => {
      const title = (input.value.trim() || "New Event").replace(/(#[a-zA-Z0-9_-]+)/g, "").trim();
      const categoryId = categorySelect.value;
      const routine: RoutineItem = {
        eventId: createEventId(this.routines),
        title,
        tags: categoryId ? `#${categoryId}` : "",
        ...eventData,
      };

      overlay.remove();
      this.floatingElements.delete(overlay);
      await this.insertRoutine(routine);
    };

    manageButton.addEventListener("click", () => {
      const popupDraft = {
        title: input.value,
        selectedCategory: categorySelect.value,
      };
      overlay.remove();
      this.floatingElements.delete(overlay);
      void this.showCategoryManagerModal({ eventData, draft: popupDraft });
    });
    cancelButton.addEventListener("click", () => {
      overlay.remove();
      this.floatingElements.delete(overlay);
    });
    saveButton.addEventListener("click", () => {
      void save();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void save();
      if (event.key === "Escape") {
        overlay.remove();
        this.floatingElements.delete(overlay);
      }
    });
    categorySelect.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void save();
      if (event.key === "Escape") {
        overlay.remove();
        this.floatingElements.delete(overlay);
      }
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        overlay.remove();
        this.floatingElements.delete(overlay);
      }
    });

    window.setTimeout(() => input.focus(), 0);
  }

  private async showCategoryManagerModal(
    returnToPopup?: {
      eventData: Omit<RoutineItem, "eventId" | "title" | "tags">;
      draft: EventPopupDraft;
    },
  ): Promise<void> {
    let editingCategoryId: string | null = null;
    let categoryList = [...this.categories];

    const overlay = this.createFloatingElement("div", "event-popup-overlay category-manager-overlay");
    const popup = overlay.createDiv({ cls: "event-popup category-manager-popup" });

    popup.createEl("h3", { text: "Manage Categories" });
    popup.createDiv({
      cls: "event-popup-meta",
      text: "Create categories here, then pick them from the timetable routine popup.",
    });

    const formGrid = popup.createDiv({ cls: "category-form-grid" });

    const nameField = formGrid.createEl("label", { cls: "category-field" });
    nameField.createEl("span", { text: "Category" });
    const nameInput = nameField.createEl("input", {
      type: "text",
      attr: { placeholder: "e.g. Language Learning" },
    });

    const colorField = formGrid.createEl("label", { cls: "category-field" });
    colorField.createEl("span", { text: "Color" });
    const colorRow = colorField.createDiv({ cls: "color-select-row" });
    const colorPreview = colorRow.createEl("span", { cls: "category-swatch color-preview" });
    const colorSelect = colorRow.createEl("select");
    this.buildColorOptions(colorSelect);
    this.syncColorPreview(colorPreview, colorSelect.value);

    const formButtons = popup.createDiv({ cls: "event-popup-buttons" });
    const cancelEditButton = formButtons.createEl("button", {
      cls: "cancel",
      text: "Cancel edit",
    });
    cancelEditButton.hidden = true;
    const formActionGroup = formButtons.createDiv({ cls: "event-popup-buttons-right" });
    const saveCategoryButton = formActionGroup.createEl("button", { cls: "save", text: "Add category" });

    popup.createDiv({ cls: "category-list-heading", text: "Existing Categories" });
    const listElement = popup.createDiv({ cls: "category-list" });

    const footer = popup.createDiv({ cls: "event-popup-buttons" });
    footer.createDiv();
    const footerActions = footer.createDiv({ cls: "event-popup-buttons-right" });
    const closeButton = footerActions.createEl("button", { cls: "cancel", text: "Close" });

    const resetForm = (): void => {
      editingCategoryId = null;
      nameInput.value = "";
      this.buildColorOptions(colorSelect);
      this.syncColorPreview(colorPreview, colorSelect.value);
      saveCategoryButton.textContent = "Add category";
      cancelEditButton.hidden = true;
    };

    const renderCategoryList = (): void => {
      listElement.empty();
      if (categoryList.length === 0) {
        listElement.createDiv({ cls: "category-empty-state", text: "No categories yet." });
        return;
      }

      categoryList.forEach((category) => {
        const usageCount = this.countRoutinesWithCategory(category.id);
        const row = listElement.createDiv({ cls: "category-row" });
        const info = row.createDiv({ cls: "category-row-info" });
        info.createDiv({ cls: "category-row-label", text: category.label });
        info.createDiv({
          cls: "category-row-meta",
          text: `#${category.id} • ${formatTitleCase(category.color)} • ${usageCount} routine${usageCount === 1 ? "" : "s"}`,
        });

        const actions = row.createDiv({ cls: "category-row-actions" });
        actions.createEl("span", { cls: `category-swatch is-${category.color}` });

        const editButton = actions.createEl("button", { cls: "secondary", text: "Edit" });
        editButton.addEventListener("click", () => {
          editingCategoryId = category.id;
          nameInput.value = category.label;
          this.buildColorOptions(colorSelect, category.color);
          this.syncColorPreview(colorPreview, colorSelect.value);
          saveCategoryButton.textContent = "Save category";
          cancelEditButton.hidden = false;
          nameInput.focus();
          nameInput.select();
        });

        const deleteButton = actions.createEl("button", { cls: "cancel", text: "Delete" });
        deleteButton.addEventListener("click", () => {
          void this.deleteCategory(category, usageCount, async (nextCategories) => {
            categoryList = nextCategories;
            if (editingCategoryId === category.id) resetForm();
            renderCategoryList();
          });
        });
      });
    };

    const saveCategory = async (): Promise<void> => {
      const label = nameInput.value.trim();
      const nextId = slugifyCategoryId(label);
      const color = colorSelect.value;

      if (!label) {
        this.showError("Category name is required");
        nameInput.focus();
        return;
      }

      if (!nextId) {
        this.showError("Category name must include letters or numbers");
        nameInput.focus();
        return;
      }

      const duplicate = categoryList.find(
        (category) => category.id === nextId && category.id !== editingCategoryId,
      );
      if (duplicate) {
        this.showError(`Category "${duplicate.label}" already exists`);
        nameInput.focus();
        return;
      }

      if (editingCategoryId) {
        const currentCategory = categoryList.find((category) => category.id === editingCategoryId);
        if (!currentCategory) return;
        const usageCount = this.countRoutinesWithCategory(currentCategory.id);
        if (
          currentCategory.id !== nextId &&
          usageCount > 0 &&
          !window.confirm(
            `Rename "${currentCategory.label}" to "${label}"? This will update ${usageCount} routine${usageCount === 1 ? "" : "s"}.`,
          )
        ) {
          return;
        }

        const nextCategories = categoryList.map((category) =>
          category.id === currentCategory.id ? { id: nextId, label, color } : category,
        );
        await this.plugin.categoryStorage.saveCategories(nextCategories);
        if (currentCategory.id !== nextId) {
          await this.rewriteCategories(currentCategory.id, nextId);
        }
        categoryList = nextCategories;
        renderCategoryList();
        resetForm();
        await this.refresh();
        return;
      }

      const nextCategories = [...categoryList, { id: nextId, label, color }];
      await this.plugin.categoryStorage.saveCategories(nextCategories);
      categoryList = nextCategories;
      renderCategoryList();
      resetForm();
      await this.refresh();
    };

    cancelEditButton.addEventListener("click", () => {
      resetForm();
      nameInput.focus();
    });
    saveCategoryButton.addEventListener("click", () => {
      void saveCategory();
    });
    closeButton.addEventListener("click", () => {
      overlay.remove();
      this.floatingElements.delete(overlay);
      if (returnToPopup) {
        void this.showEventPopup(returnToPopup.eventData, returnToPopup.draft);
      }
    });
    colorSelect.addEventListener("change", () => this.syncColorPreview(colorPreview, colorSelect.value));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        overlay.remove();
        this.floatingElements.delete(overlay);
      }
    });
    nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void saveCategory();
      if (event.key === "Escape") closeButton.click();
    });
    colorSelect.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void saveCategory();
      if (event.key === "Escape") closeButton.click();
    });

    renderCategoryList();
    window.setTimeout(() => nameInput.focus(), 0);
  }

  private async deleteCategory(
    category: CategoryRecord,
    usageCount: number,
    onDone: (categories: CategoryRecord[]) => Promise<void>,
  ): Promise<void> {
    const message =
      usageCount > 0
        ? `Delete "${category.label}"? This will remove the category from ${usageCount} routine${usageCount === 1 ? "" : "s"}.`
        : `Delete "${category.label}"?`;
    if (!window.confirm(message)) return;

    const nextCategories = this.categories.filter((item) => item.id !== category.id);
    await this.plugin.categoryStorage.saveCategories(nextCategories);
    if (usageCount > 0) {
      await this.rewriteCategories(category.id, "");
    }
    await this.refresh();
    await onDone(nextCategories);
  }

  private buildCategoryOptions(selectElement: HTMLSelectElement, selectedValue = ""): void {
    selectElement.empty();
    selectElement.appendChild(Object.assign(document.createElement("option"), { value: "", textContent: "No Category" }));
    this.categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = category.label;
      selectElement.appendChild(option);
    });
    selectElement.value = this.getCategoryById(selectedValue) ? selectedValue : "";
  }

  private buildColorOptions(selectElement: HTMLSelectElement, selectedValue = COLOR_OPTIONS[0] as string): void {
    selectElement.empty();
    COLOR_OPTIONS.forEach((color) => {
      const option = document.createElement("option");
      option.value = color;
      option.textContent = formatTitleCase(color);
      selectElement.appendChild(option);
    });
    selectElement.value = COLOR_OPTIONS.includes(selectedValue as (typeof COLOR_OPTIONS)[number])
      ? selectedValue
      : COLOR_OPTIONS[0];
  }

  private syncColorPreview(previewElement: HTMLElement, color: string): void {
    COLOR_OPTIONS.forEach((option) => previewElement.classList.remove(`is-${option}`));
    const resolvedColor = COLOR_OPTIONS.includes(color as (typeof COLOR_OPTIONS)[number]) ? color : COLOR_OPTIONS[0];
    previewElement.classList.add(`is-${resolvedColor}`);
    previewElement.title = formatTitleCase(resolvedColor);
  }

  private handleContextMenu(event: MouseEvent): void {
    if (!(event.target instanceof HTMLElement)) return;
    const eventElement = event.target.closest(".routine-event");
    if (!(eventElement instanceof HTMLElement)) return;

    event.preventDefault();
    const routine = this.getRoutineById(eventElement.dataset.eventId ?? null);
    if (!routine) return;
    this.showContextMenu(event.clientX, event.clientY, routine);
  }

  private showContextMenu(x: number, y: number, routine: RoutineItem): void {
    this.hideContextMenu();

    const menu = this.createFloatingElement("div", "event-context-menu");
    const copyItem = menu.createDiv({ cls: "context-menu-item", text: "Copy" });
    const deleteItem = menu.createDiv({ cls: "context-menu-item delete", text: "Delete" });

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    copyItem.addEventListener("click", () => {
      void this.copyRoutine(routine);
    });
    deleteItem.addEventListener("click", () => {
      void this.deleteRoutine(routine.eventId);
    });

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  }

  private async copyRoutine(routine: RoutineItem): Promise<void> {
    this.hideContextMenu();
    const copiedRoutine: RoutineItem = {
      ...routine,
      eventId: createEventId(this.routines),
      day: (routine.day + 1) % DAYS.length,
    };
    await this.insertRoutine(copiedRoutine);
  }

  private async insertRoutine(routine: RoutineItem): Promise<void> {
    await this.mutateFile((content) => insertRoutineIntoManagedContent(content, routine));
  }

  private async updateRoutine(routine: RoutineItem): Promise<void> {
    await this.mutateFile((content) => updateRoutineInManagedContent(content, routine));
  }

  private async deleteRoutine(eventId: string): Promise<void> {
    this.hideContextMenu();
    await this.mutateFile((content) => deleteRoutineFromManagedContent(content, eventId));
  }

  private async rewriteCategories(oldCategoryId: string, nextCategoryId = ""): Promise<void> {
    await this.mutateFile((content) => rewriteCategoriesInManagedContent(content, oldCategoryId, nextCategoryId));
  }

  private async mutateFile(transform: (content: string) => string): Promise<void> {
    try {
      const content = await this.plugin.app.vault.read(this.file);
      const nextContent = transform(content);
      await this.plugin.app.vault.modify(this.file, nextContent);
      await this.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.showError(message);
    }
  }

  private showError(message: string): void {
    new Notice(`Weekly Routine Planner: ${message}`, 5000);
    console.error(`[WeeklyRoutinePlanner:${this.sourcePath}] ${message}`);
  }

  private createFloatingElement<K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    className: string,
  ): HTMLElementTagNameMap[K] {
    const element = document.createElement(tagName);
    element.className = className;
    document.body.appendChild(element);
    this.floatingElements.add(element);
    return element;
  }
}
