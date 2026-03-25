import { renderTuiPresentationAsJson, type TuiRenderRequest } from "./presentation.js";
import { loadPromptsModule } from "./load-prompts.js";
import { createDeterministicTuiSpec } from "./tui-render-spec.js";
import { tuiRenderCatalog } from "./tui-render-registry.js";

export async function buildTuiRenderPrompt(request: TuiRenderRequest): Promise<string> {
  const { defaultPromptRenderer } = await loadPromptsModule();
  return defaultPromptRenderer.render("ui/tui_render_spec", {
    catalog_prompt: tuiRenderCatalog.prompt({
      mode: "standalone",
      system: "You render only the generated output pane of mono's terminal UI.",
      customRules: [
        "Generate only the output pane. The shell composer, footer, attachments, and dialogs are outside this spec.",
        "Render from pane state using $state and repeat. Do not hardcode message text into static layout when state bindings are available.",
        "Always include at least one visible content region for history or live assistant/tool output.",
        "Pane-local interaction is allowed with built-in TextInput, Select, MultiSelect, ConfirmInput, and Tabs, but only for query-local generated interactions.",
        "Do not invent shell widgets or dialogs inside the pane.",
        "Do not invent new components, props, state paths, or actions beyond the catalog and current pane state model.",
      ],
    }),
    presentation_json: renderTuiPresentationAsJson(request),
    seed_spec_json: JSON.stringify(createDeterministicTuiSpec(), null, 2),
  });
}
