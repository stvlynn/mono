export type KeyId =
  | "up"
  | "down"
  | "left"
  | "right"
  | "enter"
  | "escape"
  | "backspace"
  | "delete"
  | "tab"
  | "home"
  | "end"
  | `ctrl+${string}`
  | `alt+${string}`
  | string;

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

export function parseKey(data: string): KeyId {
  switch (data) {
    case "\u001b[A":
      return "up";
    case "\u001b[B":
      return "down";
    case "\u001b[C":
      return "right";
    case "\u001b[D":
      return "left";
    case "\u001b[3~":
      return "delete";
    case "\u001b[H":
    case "\u001bOH":
      return "home";
    case "\u001b[F":
    case "\u001bOF":
      return "end";
    case "\r":
    case "\n":
      return "enter";
    case "\u007f":
    case "\b":
      return "backspace";
    case "\t":
      return "tab";
    case "\u001b":
      return "escape";
    default:
      break;
  }

  if (data.length === 1) {
    const code = data.charCodeAt(0);
    if (code >= 1 && code <= 26) {
      return `ctrl+${String.fromCharCode(code + 96)}`;
    }
    return data;
  }

  if (data.startsWith("\u001b") && data.length === 2) {
    return `alt+${data[1]}`;
  }

  return data;
}

function matchesKey(data: string, key: KeyId): boolean {
  return parseKey(data) === key;
}

export function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

export function visibleWidth(value: string): number {
  return stripAnsi(value).length;
}

export function padRight(value: string, width: number): string {
  const diff = Math.max(0, width - visibleWidth(value));
  return `${value}${" ".repeat(diff)}`;
}

export function truncateToWidth(value: string, width: number): string {
  if (visibleWidth(value) <= width) {
    return value;
  }
  return `${stripAnsi(value).slice(0, Math.max(0, width - 1))}…`;
}

export function wrapText(value: string, width: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [""];
  }

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (visibleWidth(next) <= width || current.length === 0) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

export class SelectList {
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
