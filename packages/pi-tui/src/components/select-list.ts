import { matchesKey } from "../keys.js";
import type { Component } from "../tui.js";
import { padRight, truncateToWidth } from "../utils.js";

export interface SelectItem {
  value: string;
  label: string;
  description?: string;
}

export interface SelectListTheme {
  selectedPrefix: (text: string) => string;
  selectedText: (text: string) => string;
  description: (text: string) => string;
  scrollInfo: (text: string) => string;
  noMatch: (text: string) => string;
}

export class SelectList implements Component {
  private items: SelectItem[];
  private filteredItems: SelectItem[];
  private selectedIndex = 0;
  private emptyMessage = "  No matching items";

  onSelect?: (item: SelectItem) => void;
  onCancel?: () => void;
  onSelectionChange?: (item: SelectItem) => void;

  constructor(
    items: SelectItem[],
    private readonly maxVisible: number,
    private readonly theme: SelectListTheme
  ) {
    this.items = [...items];
    this.filteredItems = [...items];
  }

  setItems(items: SelectItem[]): void {
    this.items = [...items];
    this.filteredItems = [...items];
    this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, this.filteredItems.length - 1));
    this.notifySelectionChange();
  }

  setEmptyMessage(message: string): void {
    this.emptyMessage = message;
  }

  setFilter(filter: string): void {
    const value = filter.trim().toLowerCase();
    this.filteredItems = value
      ? this.items.filter((item) => item.value.toLowerCase().includes(value) || item.label.toLowerCase().includes(value))
      : this.items;
    this.selectedIndex = 0;
    this.notifySelectionChange();
  }

  setSelectedIndex(index: number): void {
    this.selectedIndex = Math.max(0, Math.min(index, this.filteredItems.length - 1));
    this.notifySelectionChange();
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (this.filteredItems.length === 0) {
      return [this.theme.noMatch(padRight(this.emptyMessage, width))];
    }

    const startIndex = Math.max(0, Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredItems.length - this.maxVisible));
    const endIndex = Math.min(this.filteredItems.length, startIndex + this.maxVisible);
    const lines: string[] = [];

    for (let index = startIndex; index < endIndex; index += 1) {
      const item = this.filteredItems[index];
      const prefix = index === this.selectedIndex ? this.theme.selectedPrefix("> ") : "  ";
      const label = truncateToWidth(item.label || item.value, Math.max(1, width - 2));
      const line = index === this.selectedIndex ? this.theme.selectedText(prefix + label) : prefix + label;
      lines.push(padRight(line, width));
      if (item.description) {
        lines.push(this.theme.description(padRight(`   ${truncateToWidth(item.description, Math.max(1, width - 3))}`, width)));
      }
    }

    if (this.filteredItems.length > this.maxVisible) {
      lines.push(this.theme.scrollInfo(padRight(`  (${this.selectedIndex + 1}/${this.filteredItems.length})`, width)));
    }

    return lines;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "up")) {
      this.selectedIndex = this.selectedIndex === 0 ? this.filteredItems.length - 1 : this.selectedIndex - 1;
      this.notifySelectionChange();
      return;
    }
    if (matchesKey(data, "down")) {
      this.selectedIndex = this.selectedIndex >= this.filteredItems.length - 1 ? 0 : this.selectedIndex + 1;
      this.notifySelectionChange();
      return;
    }
    if (matchesKey(data, "enter")) {
      const item = this.filteredItems[this.selectedIndex];
      if (item) {
        this.onSelect?.(item);
      }
      return;
    }
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.onCancel?.();
    }
  }

  getSelectedItem(): SelectItem | null {
    return this.filteredItems[this.selectedIndex] ?? null;
  }

  private notifySelectionChange(): void {
    const item = this.filteredItems[this.selectedIndex];
    if (item) {
      this.onSelectionChange?.(item);
    }
  }
}
