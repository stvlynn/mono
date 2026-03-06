import type { ApprovalRequest } from "@mono/shared";
import type { SelectList } from "@mono/pi-tui";

export type ModalState =
  | { type: "none" }
  | { type: "help" }
  | { type: "onboarding" }
  | { type: "approval"; request: ApprovalRequest }
  | { type: "select"; title: string; hint: string; list: SelectList };

export interface ToolRun {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  output: string;
}
