export const HISTORY_PAGE_SIZE = 6;

export interface HistoryWindow {
  start: number;
  end: number;
  hiddenAbove: number;
  hiddenBelow: number;
}

export function getMaxHistoryScrollOffset(totalItems: number, pageSize = HISTORY_PAGE_SIZE): number {
  return Math.max(0, totalItems - pageSize);
}

export function clampHistoryScrollOffset(offset: number, totalItems: number, pageSize = HISTORY_PAGE_SIZE): number {
  return Math.max(0, Math.min(offset, getMaxHistoryScrollOffset(totalItems, pageSize)));
}

export function getHistoryWindow(totalItems: number, offsetFromBottom: number, pageSize = HISTORY_PAGE_SIZE): HistoryWindow {
  const clampedOffset = clampHistoryScrollOffset(offsetFromBottom, totalItems, pageSize);
  const end = Math.max(0, totalItems - clampedOffset);
  const start = Math.max(0, end - pageSize);

  return {
    start,
    end,
    hiddenAbove: start,
    hiddenBelow: Math.max(0, totalItems - end)
  };
}
