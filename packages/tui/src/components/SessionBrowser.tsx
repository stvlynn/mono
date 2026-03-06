import type { ListDialog as ListDialogType } from "../types/ui.js";
import { ListDialog } from "./ListDialog.js";

export function SessionBrowser({ dialog }: { dialog: ListDialogType }) {
  return <ListDialog dialog={dialog} />;
}
