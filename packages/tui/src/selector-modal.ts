import type { SelectItem } from "@mono/pi-tui";
import { createSelectList } from "./ui-format.js";
import type { ModalState } from "./ui-types.js";

interface SelectorModalOptions {
  title: string;
  hint: string;
  items: SelectItem[];
  onSelect: (item: SelectItem) => void;
  onCancel: () => void;
  initialFilter?: string;
  emptyMessage?: string;
  initialSelectedIndex?: number;
}

export function createSelectorModal(options: SelectorModalOptions): ModalState {
  const list = createSelectList(options.items, options.emptyMessage ?? "  No matching items");
  list.onCancel = options.onCancel;
  list.onSelect = options.onSelect;

  if (options.initialFilter) {
    list.setFilter(options.initialFilter);
  } else if (options.initialSelectedIndex !== undefined) {
    list.setSelectedIndex(options.initialSelectedIndex);
  }

  return {
    type: "select",
    title: options.title,
    hint: options.hint,
    list
  };
}
