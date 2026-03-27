import { MarkdownRenderChild, Modal, Notice, TFile } from "obsidian";
import {
  CODE_BLOCK_LANGUAGE,
  COLOR_OPTIONS,
  DAY_ABBREV,
  DAYS,
  DEFAULT_TIMETABLE_CONFIG,
  EVENT_HEIGHT_PADDING_PX,
  MANAGED_REGION_END,
  MANAGED_REGION_START,
  MIN_EVENT_HEIGHT_PX,
  MINUTES_PER_HOUR,
} from "./constants";
import {
  createEventId,
  deleteRoutineFromManagedContent,
  formatTime,
  formatTitleCase,
  getManagedRegion,
  insertRoutineIntoManagedContent,
  parseTagList,
  rewriteCategoriesInManagedContent,
  slugifyCategoryId,
  updateRoutineInManagedContent,
} from "./parser";
import {
  fromTotalMinutes,
  getCreateRoutineRange,
  getSnappedDragPointFromOffset,
  moveRoutineWithinBounds,
  removeCategoryFromList,
  resizeRoutineWithinBounds,
} from "./routine-logic";
import { SerialTaskQueue } from "./serial-task-queue";
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

interface ConfirmationDialogOptions {
  title: string;
  message: string;
  confirmText: string;
}

export class WeeklyRoutineRenderChild extends MarkdownRenderChild {
  private routines: RoutineItem[] = [];
  private categories: CategoryRecord[] = [];
  private config: TimetableConfig = DEFAULT_TIMETABLE_CONFIG;
  private isInitialized = false;
  private isDragging = false;
  private dragMode: DragMode = null;
  private dragStart: DragPoint | null = null;
  private dragCurrent: DragPoint | null = null;
  private draggedEventId: string | null = null;
  private floatingElements = new Set<HTMLElement>();
  private readonly mutationQueue = new SerialTaskQueue();

  constructor(
    private readonly plugin: WeeklyRoutinePlannerPlugin,
    containerEl: HTMLElement,
    private readonly file: TFile,
    private readonly sourcePath: string,
  ) {
    super(containerEl);
  }

  onload(): void {
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
          this.requestRefresh();
        }
      }),
    );

    this.requestRefresh();
  }

  onunload(): void {
    this.hideContextMenu();
    this.floatingElements.forEach((element) => element.remove());
    this.floatingElements.clear();
    this.containerEl.empty();
  }

  private async refresh(): Promise<void> {
    this.categories = this.plugin.categoryStorage.loadCategories();
    this.config = this.plugin.settings.timetableConfig;

    const content = await this.plugin.app.vault.read(this.file);
    const lines = content.split("\n");
    const managedRegion = getManagedRegion(lines);
    this.isInitialized = managedRegion !== null;
    this.routines = managedRegion?.collection.routines ?? [];

    this.render();
  }

  private requestRefresh(): void {
    void this.refresh().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.showError(message);
    });
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
    emptyState.createEl("p", {
      text: `Add a fenced \`${CODE_BLOCK_LANGUAGE}\` block and the managed region markers ${MANAGED_REGION_START} / ${MANAGED_REGION_END} to this note.`,
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
    const escapedEventId =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(eventId)
        : eventId;
    return this.containerEl.querySelector(
      `.routine-event[data-event-id="${escapedEventId}"]`,
    );
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
    if (Number.isNaN(day)) return;

    const point = getSnappedDragPointFromOffset(day, event.clientY - rect.top, this.config);

    this.isDragging = true;
    this.dragMode = "create";
    this.dragStart = point;
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
    this.dragCurrent = getSnappedDragPointFromOffset(
      targetDay,
      event.clientY - rect.top,
      this.config,
    );

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

      const range = getCreateRoutineRange(
        this.dragStart,
        this.dragCurrent,
        this.config,
      );
      const top =
        ((range.startTotalMinutes / MINUTES_PER_HOUR) - this.config.startHour) *
        this.config.hourHeight;
      const height =
        ((range.endTotalMinutes - range.startTotalMinutes) / MINUTES_PER_HOUR) *
        this.config.hourHeight;
      preview.style.top = `${top}px`;
      preview.style.height = `${Math.max(height, this.config.hourHeight / 2)}px`;
      preview.replaceChildren();
      preview.appendChild(Object.assign(document.createElement("div"), { className: "event-title", textContent: "New event" }));
      return;
    }

    if (this.dragMode === "move") {
      const eventElement = this.getEventElementById(this.draggedEventId);
      const routine = this.getRoutineById(this.draggedEventId);
      if (!(eventElement instanceof HTMLElement) || !routine) return;
      const targetColumn = this.containerEl.querySelectorAll(".day-column")[this.dragCurrent.day];
      if (targetColumn instanceof HTMLElement && eventElement.parentElement !== targetColumn) {
        eventElement.remove();
        targetColumn.appendChild(eventElement);
      }
      const movedRoutine = moveRoutineWithinBounds(
        routine,
        this.dragCurrent,
        this.config,
      );
      const top =
        (movedRoutine.startHour -
          this.config.startHour +
          movedRoutine.startMin / MINUTES_PER_HOUR) *
        this.config.hourHeight;
      eventElement.style.top = `${Math.max(0, top)}px`;
      return;
    }

    if (this.dragMode === "resize") {
      const eventElement = this.getEventElementById(this.draggedEventId);
      const routine = this.getRoutineById(this.draggedEventId);
      if (!(eventElement instanceof HTMLElement) || !routine) return;
      const resizedRoutine = resizeRoutineWithinBounds(
        routine,
        this.dragCurrent,
        this.config,
      );
      const startOffset =
        (routine.startHour - this.config.startHour + routine.startMin / MINUTES_PER_HOUR) *
        this.config.hourHeight;
      const endOffset =
        (resizedRoutine.endHour -
          this.config.startHour +
          resizedRoutine.endMin / MINUTES_PER_HOUR) *
        this.config.hourHeight;
      eventElement.style.height = `${Math.max(endOffset - startOffset, this.config.hourHeight / 4)}px`;
    }
  }

  private async handleMouseUp(): Promise<void> {
    if (!this.isDragging || !this.dragStart || !this.dragCurrent) return;

    this.isDragging = false;

    if (this.dragMode === "create") {
      this.containerEl.querySelector("#weekly-routine-drag-preview")?.remove();

      const range = getCreateRoutineRange(this.dragStart, this.dragCurrent, this.config);
      const startPoint = fromTotalMinutes(range.startTotalMinutes);
      const endPoint = fromTotalMinutes(range.endTotalMinutes);

      this.showEventPopup({
        day: this.dragCurrent.day,
        startHour: startPoint.hour,
        startMin: startPoint.min,
        endHour: endPoint.hour,
        endMin: endPoint.min,
      });
    } else if (this.dragMode === "move" && this.draggedEventId) {
      const routine = this.getRoutineById(this.draggedEventId);
      this.getEventElementById(this.draggedEventId)?.classList.remove("dragging");

      if (routine) {
        const nextRoutine = moveRoutineWithinBounds(
          routine,
          this.dragCurrent,
          this.config,
        );
        await this.updateRoutine(nextRoutine);
      }
    } else if (this.dragMode === "resize" && this.draggedEventId) {
      const routine = this.getRoutineById(this.draggedEventId);
      if (routine) {
        const nextRoutine = resizeRoutineWithinBounds(
          routine,
          this.dragCurrent,
          this.config,
        );
        await this.updateRoutine(nextRoutine);
      }
    }

    this.dragMode = null;
    this.dragStart = null;
    this.dragCurrent = null;
    this.draggedEventId = null;
  }

  private showEventPopup(
    eventData: Omit<RoutineItem, "eventId" | "title" | "tags">,
    draft: EventPopupDraft = {},
  ): void {
    const overlay = this.createFloatingElement("div", "event-popup-overlay");
    const popup = overlay.createDiv({ cls: "event-popup" });
    popup.createEl("h3", { text: "New routine" });
    popup.createDiv({
      cls: "event-popup-meta",
      text: `${DAYS[eventData.day]} ${formatTime(eventData.startHour, eventData.startMin)} - ${formatTime(eventData.endHour, eventData.endMin)}`,
    });

    const input = popup.createEl("input", {
      type: "text",
      attr: { placeholder: "Routine title (e.g. Deep work)" },
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
      const title = (input.value.trim() || "New event").replace(/(#[a-zA-Z0-9_-]+)/g, "").trim();
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
      this.showCategoryManagerModal({ eventData, draft: popupDraft });
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

  private showCategoryManagerModal(
    returnToPopup?: {
      eventData: Omit<RoutineItem, "eventId" | "title" | "tags">;
      draft: EventPopupDraft;
    },
  ): void {
    let editingCategoryId: string | null = null;
    let categoryList = [...this.categories];

    const overlay = this.createFloatingElement("div", "event-popup-overlay category-manager-overlay");
    const popup = overlay.createDiv({ cls: "event-popup category-manager-popup" });

    popup.createEl("h3", { text: "Manage categories" });
    popup.createDiv({
      cls: "event-popup-meta",
      text: "Create categories here, then pick them from the timetable routine popup.",
    });

    const formGrid = popup.createDiv({ cls: "category-form-grid" });

    const nameField = formGrid.createEl("label", { cls: "category-field" });
    nameField.createEl("span", { text: "Category" });
    const nameInput = nameField.createEl("input", {
      type: "text",
      attr: { placeholder: "e.g. language learning" },
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

    popup.createDiv({ cls: "category-list-heading", text: "Existing categories" });
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
          void this.deleteCategory(category, usageCount, categoryList, (nextCategories) => {
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
          !(await this.confirmAction({
            title: "Rename category",
            message: `Rename "${currentCategory.label}" to "${label}"? This will update ${usageCount} routine${usageCount === 1 ? "" : "s"}.`,
            confirmText: "Rename",
          }))
        ) {
          return;
        }

        const nextCategories = categoryList.map((category) =>
          category.id === currentCategory.id ? { id: nextId, label, color } : category,
        );
        await this.plugin.categoryStorage.saveCategories(nextCategories);
        this.categories = nextCategories;
        if (currentCategory.id !== nextId) {
          await this.rewriteCategories(currentCategory.id, nextId);
        }
        categoryList = nextCategories;
        renderCategoryList();
        resetForm();
        return;
      }

      const nextCategories = [...categoryList, { id: nextId, label, color }];
      await this.plugin.categoryStorage.saveCategories(nextCategories);
      this.categories = nextCategories;
      categoryList = nextCategories;
      renderCategoryList();
      resetForm();
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
        this.showEventPopup(returnToPopup.eventData, returnToPopup.draft);
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
    categoryList: CategoryRecord[],
    onDone: (categories: CategoryRecord[]) => void,
  ): Promise<void> {
    const message =
      usageCount > 0
        ? `Delete "${category.label}"? This will remove the category from ${usageCount} routine${usageCount === 1 ? "" : "s"}.`
        : `Delete "${category.label}"?`;
    const shouldDelete = await this.confirmAction({
      title: "Delete category",
      message,
      confirmText: "Delete",
    });
    if (!shouldDelete) return;

    const nextCategories = removeCategoryFromList(categoryList, category.id);
    await this.plugin.categoryStorage.saveCategories(nextCategories);
    this.categories = nextCategories;
    if (usageCount > 0) {
      await this.rewriteCategories(category.id, "");
    }
    onDone(nextCategories);
  }

  private buildCategoryOptions(selectElement: HTMLSelectElement, selectedValue = ""): void {
    selectElement.empty();
    selectElement.appendChild(Object.assign(document.createElement("option"), { value: "", textContent: "No category" }));
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
      await this.mutationQueue.run(async () => {
        const content = await this.plugin.app.vault.read(this.file);
        const nextContent = transform(content);
        if (nextContent === content) return;
        await this.plugin.app.vault.modify(this.file, nextContent);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.showError(message);
    }
  }

  private showError(message: string): void {
    new Notice(`Weekly routine planner: ${message}`, 5000);
    console.error(`[WeeklyRoutinePlanner:${this.sourcePath}] ${message}`);
  }

  private async confirmAction(options: ConfirmationDialogOptions): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      const modal = new ConfirmationModal(this.plugin.app, options, resolve);
      modal.open();
    });
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

class ConfirmationModal extends Modal {
  private resolved = false;

  constructor(
    app: WeeklyRoutinePlannerPlugin["app"],
    private readonly options: ConfirmationDialogOptions,
    private readonly onResolve: (result: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: this.options.title });
    contentEl.createEl("p", { text: this.options.message });

    const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
    const cancelButton = buttonRow.createEl("button", { text: "Cancel" });
    const confirmButton = buttonRow.createEl("button", {
      cls: "mod-cta",
      text: this.options.confirmText,
    });

    cancelButton.addEventListener("click", () => {
      this.finish(false);
      this.close();
    });
    confirmButton.addEventListener("click", () => {
      this.finish(true);
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
    this.finish(false);
  }

  private finish(result: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.onResolve(result);
  }
}
