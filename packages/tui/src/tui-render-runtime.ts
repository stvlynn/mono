import {
  autoFixSpec,
  createSpecStreamCompiler,
  validateSpec,
  type Spec,
} from "@json-render/core";
import { taskInputToUserMessage, type ConversationMessage } from "@mono/shared";
import type { UnifiedModel } from "@mono/shared";
import { buildTuiRenderPrompt } from "./tui-render-prompt.js";
import { loadLlmModule } from "./load-llm.js";
import {
  createDeterministicTuiSpec,
  decorateTuiSpec,
  summarizeTuiSpecLayout,
  type TuiRenderOverlayState,
} from "./tui-render-spec.js";
import { tuiRenderCatalog } from "./tui-render-registry.js";
import type { TuiRenderRequest } from "./presentation.js";

const INTERACTIVE_COMPONENT_TYPES = new Set([
  "TextInput",
  "ConfirmInput",
  "Select",
  "MultiSelect",
  "Tabs",
]);

const CONTENT_COMPONENT_TYPES = new Set([
  "Markdown",
  "Text",
  "Card",
  "List",
  "ListItem",
  "StatusLine",
  "Table",
  "KeyValue",
  "Metric",
  "Callout",
  "Timeline",
  "Heading",
]);

export function hasMinimumTuiSurface(spec: Spec): boolean {
  const elements = Object.values(spec.elements);
  const hasContent = elements.some((element) => CONTENT_COMPONENT_TYPES.has(element.type));
  const hasHistoryBinding = elements.some((element) => {
    if (!element.repeat || element.repeat.statePath !== "/history/items") {
      return false;
    }
    return true;
  });
  const hasOptionalInteraction = elements.some((element) => INTERACTIVE_COMPONENT_TYPES.has(element.type));

  return hasContent && (hasHistoryBinding || hasOptionalInteraction);
}

function coerceValidSpec(candidate: unknown, onDebug?: (message: string) => void): Spec | null {
  if (!candidate || typeof candidate !== "object") {
    onDebug?.("ignored render candidate: not an object");
    return null;
  }
  const spec = candidate as Spec;
  if (!spec.root || !spec.elements || typeof spec.elements !== "object") {
    onDebug?.("ignored render candidate: missing root or elements");
    return null;
  }

  const fixed = autoFixSpec(spec).spec;
  if (!validateSpec(fixed).valid) {
    onDebug?.("rejected render spec: structural validation failed");
    return null;
  }
  const structural = tuiRenderCatalog.validate(fixed);
  if (!structural.success) {
    onDebug?.("rejected render spec: catalog validation failed");
    return null;
  }
  if (!hasMinimumTuiSurface(fixed)) {
    onDebug?.("rejected render spec: missing minimum local surface components");
    return null;
  }
  return fixed;
}

export async function streamTuiSpec(options: {
  model: UnifiedModel;
  request: TuiRenderRequest;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  signal?: AbortSignal;
  onSpec?: (spec: Spec) => void;
  onDebug?: (message: string) => void;
}): Promise<Spec | null> {
  const baselineSpec = createDeterministicTuiSpec();
  const compiler = createSpecStreamCompiler<Spec>(baselineSpec);
  let lastValidSpec: Spec | null = baselineSpec;
  const { streamConversationText } = await loadLlmModule();
  options.onDebug?.("starting UI render stream from baseline pane spec");

  await streamConversationText({
    model: options.model,
    systemPrompt: await buildTuiRenderPrompt(options.request),
    messages: [
      taskInputToUserMessage(
        "Generate the local mono terminal screen as json-render Ink SpecStream patches for the current presentation state.",
      ) as ConversationMessage,
    ],
    thinkingLevel: options.thinkingLevel ?? "off",
    signal: options.signal,
    onTextDelta: (delta) => {
      const { result } = compiler.push(delta);
      options.onDebug?.(`received render text delta (${delta.length} chars)`);
      const nextSpec = coerceValidSpec(result, options.onDebug);
      if (!nextSpec) {
        return;
      }
      lastValidSpec = nextSpec;
      options.onDebug?.("accepted intermediate render spec");
      options.onSpec?.(nextSpec);
    },
  });

  const finalSpec = coerceValidSpec(compiler.getResult(), options.onDebug);
  if (finalSpec) {
    options.onDebug?.("accepted final render spec");
  } else if (lastValidSpec) {
    options.onDebug?.("final render spec invalid; falling back to last accepted intermediate spec");
  } else {
    options.onDebug?.("render stream produced no usable spec");
  }
  return finalSpec ?? lastValidSpec;
}
