import type { ApprovalRequest } from "@mono/shared";
import type { SelectList } from "./legacy-compat.js";

export type ModalState =
  | { type: "none" }
  | { type: "help" }
  | { type: "onboarding" }
  | { type: "approval"; request: ApprovalRequest }
  | { type: "details"; title: string; lines: string[] }
  | { type: "select"; title: string; hint: string; list: SelectList };

export interface ToolRun {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  output: string;
}
