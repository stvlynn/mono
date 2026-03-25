import { defineCatalog } from "@json-render/core";
import { standardActionDefinitions, standardComponentDefinitions, schema } from "@json-render/ink";
import { z } from "zod";
import type { UIActions } from "./contexts/UIActionsContext.js";
import type { UIState } from "./types/ui.js";
import type { ReturnTypeUseSlashCommands } from "./hooks/useSlashCommands.types.js";

export const tuiRenderCatalog = defineCatalog(schema, {
  components: {
    ...standardComponentDefinitions,
  },
  actions: {
    pane_submit: {
      params: z.object({
        text: z.string().optional(),
      }),
      description: "Submit a pane-local interactive text value if the generated pane needs to hand it back to the host.",
    },
    pane_select: {
      params: z.object({
        value: z.string().optional(),
      }),
      description: "Handle a pane-local selection from generated UI.",
    },
    pane_confirm: {
      params: z.object({}),
      description: "Confirm a pane-local generated interaction.",
    },
    pane_cancel: {
      params: z.object({}),
      description: "Cancel a pane-local generated interaction.",
    },
    request_shell_focus: {
      params: z.object({}),
      description: "Return focus from the generated pane to the deterministic shell.",
    },
    request_generated_focus: {
      params: z.object({}),
      description: "Move focus from the deterministic shell into the generated pane.",
    },
  },
});

export interface TuiActionHandlerOptions {
  uiActions: UIActions;
  getUiState: () => UIState;
  slash: ReturnTypeUseSlashCommands;
  store: {
    getSnapshot(): Record<string, unknown>;
    set(path: string, value: unknown): void;
  };
}

export function createTuiActionHandlers(options: TuiActionHandlerOptions): Record<string, (params: Record<string, unknown>) => Promise<void>> {
  return {
    pane_submit: async (params) => {
      const text = typeof params.text === "string"
        ? params.text
        : "";
      if (!text.trim()) {
        return;
      }
      const handled = await options.slash.execute(text);
      if (!handled) {
        await options.uiActions.submitPrompt(text);
      }
      options.uiActions.setShellFocus();
    },
    pane_select: async (params) => {
      const value = typeof params.value === "string" ? params.value : "";
      if (value.startsWith("/")) {
        options.store.set("/pane/lastSelection", value);
      }
    },
    pane_confirm: async () => {
      options.uiActions.setShellFocus();
    },
    pane_cancel: async () => {
      options.uiActions.setShellFocus();
    },
    request_shell_focus: async () => {
      options.uiActions.setShellFocus();
    },
    request_generated_focus: async () => {
      options.uiActions.setGeneratedFocus();
    },
  };
}
