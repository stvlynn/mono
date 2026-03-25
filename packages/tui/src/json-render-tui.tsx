import { JSONUIProvider, Renderer, createStateStore } from "@json-render/ink";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useFocusDisable } from "@json-render/ink";
import { useAppContext } from "./contexts/AppContext.js";
import { useUIActions } from "./contexts/UIActionsContext.js";
import { useUIState } from "./contexts/UIStateContext.js";
import { createTuiActionHandlers } from "./tui-render-registry.js";
import {
  createTuiRenderRequest,
  createTuiPaneStateModel,
  flattenTuiStateModel,
} from "./presentation.js";
import { streamTuiSpec } from "./tui-render-runtime.js";
import {
  createDeterministicTuiSpec,
  decorateTuiSpec,
  summarizeTuiSpecLayout,
  type TuiRenderOverlayState,
} from "./tui-render-spec.js";
import type { ReturnTypeUseComposerState } from "./hooks/useComposerState.types.js";
import type { ReturnTypeUseSlashCommands } from "./hooks/useSlashCommands.types.js";

export interface JsonRenderTuiProps {
  slash: ReturnTypeUseSlashCommands;
  dialogsOpen: boolean;
  paneGeneration: number;
  focusTarget: "shell" | "generated";
}

function resolveTuiRenderConfig(agent: ReturnType<typeof useAppContext>["agent"]) {
  try {
    return agent.getResolvedConfig().channels.tui;
  } catch {
    return {
      enabled: true,
      renderer: "json-render-ink" as const,
      specMode: "deterministic" as const,
      validateGeneratedSpec: true,
      streamGeneratedSpec: false,
      debugRender: false,
    };
  }
}

function createOverlay(kind: TuiRenderOverlayState["kind"], message?: string): TuiRenderOverlayState {
  return { kind, ...(message ? { message } : {}) };
}

function writeRenderDebug(enabled: boolean, message: string): void {
  if (!enabled) {
    return;
  }
  process.stderr.write(`[mono:tui] ${message}\n`);
}

function GeneratedPaneFocusGate({ disabled }: { disabled: boolean }) {
  useFocusDisable(disabled);
  return null;
}

export function JsonRenderTui({ slash, dialogsOpen, paneGeneration, focusTarget }: JsonRenderTuiProps) {
  const { agent } = useAppContext();
  const uiActions = useUIActions();
  const uiState = useUIState();
  const renderConfig = resolveTuiRenderConfig(agent);
  const deterministicSpec = useMemo(() => createDeterministicTuiSpec(), []);
  const initialStateModel = useMemo(() => createTuiPaneStateModel({
    agent,
    uiState,
    paneGeneration,
  }), []); // initialized once, live updates go through the controlled store

  const store = useMemo(() => createStateStore(initialStateModel as unknown as Record<string, unknown>), []);
  const [spec, setSpec] = useState(() => decorateTuiSpec(deterministicSpec, createOverlay("idle")));
  const lastKnownGoodSpecRef = useRef(deterministicSpec);
  const lastLayoutSummaryRef = useRef(summarizeTuiSpecLayout(deterministicSpec));
  const latestRequestIdRef = useRef(0);
  const latestUiStateRef = useRef(uiState);

  useEffect(() => {
    latestUiStateRef.current = uiState;
  }, [uiState]);

  const stateModel = useMemo(() => createTuiPaneStateModel({
    agent,
    uiState: {
      ...uiState,
      focusTarget,
    },
    paneGeneration,
  }), [agent, focusTarget, paneGeneration, uiState]);

  useEffect(() => {
    store.update(flattenTuiStateModel(stateModel));
  }, [stateModel, store]);

  const actionHandlers = useMemo(() => createTuiActionHandlers({
    uiActions,
    getUiState: () => uiState,
    slash,
    store,
  }), [slash, store, uiActions, uiState]);

  useEffect(() => {
    if (!uiState.initialized || renderConfig.specMode !== "generative" || paneGeneration <= 0) {
      lastKnownGoodSpecRef.current = deterministicSpec;
      lastLayoutSummaryRef.current = summarizeTuiSpecLayout(deterministicSpec);
      setSpec(decorateTuiSpec(deterministicSpec, createOverlay("idle")));
      writeRenderDebug(renderConfig.debugRender, `using deterministic pane (initialized=${uiState.initialized}, mode=${renderConfig.specMode}, paneGeneration=${paneGeneration})`);
      return;
    }

    const requestId = paneGeneration;
    latestRequestIdRef.current = requestId;
    const controller = new AbortController();
    const debounceMs = 0;
    writeRenderDebug(renderConfig.debugRender, `starting pane generation for query #${requestId}`);
    setSpec((current) => decorateTuiSpec(lastKnownGoodSpecRef.current ?? current, createOverlay("loading", "Rendering TUI layout...")));

    const timeout = setTimeout(() => {
      void (async () => {
        try {
          const request = createTuiRenderRequest({
            agent,
            uiState: latestUiStateRef.current,
            paneGeneration,
          });
          const finalSpec = await streamTuiSpec({
            model: agent.getCurrentModel(),
            request,
            signal: controller.signal,
            onDebug: (message) => writeRenderDebug(renderConfig.debugRender, `pane #${requestId}: ${message}`),
          });
          if (latestRequestIdRef.current !== requestId) {
            return;
          }
          if (!finalSpec) {
            writeRenderDebug(renderConfig.debugRender, `pane #${requestId}: no usable spec, keeping last-known-good layout`);
            setSpec((current) =>
              decorateTuiSpec(lastKnownGoodSpecRef.current ?? current, createOverlay("error", "UI render degraded. Using last stable layout.")),
            );
            return;
          }
          lastKnownGoodSpecRef.current = finalSpec;
          lastLayoutSummaryRef.current = summarizeTuiSpecLayout(finalSpec);
          setSpec(decorateTuiSpec(finalSpec, createOverlay("idle")));
        } catch (error) {
          if (controller.signal.aborted || latestRequestIdRef.current !== requestId) {
            writeRenderDebug(renderConfig.debugRender, `pane #${requestId}: aborted`);
            return;
          }
          const message = error instanceof Error ? error.message : "Unknown render failure";
          writeRenderDebug(renderConfig.debugRender, `pane #${requestId}: failed - ${message}`);
          setSpec((current) =>
            decorateTuiSpec(lastKnownGoodSpecRef.current ?? current, createOverlay("error", `UI render degraded: ${message}`)),
          );
        }
      })();
    }, debounceMs);

    return () => {
      clearTimeout(timeout);
      controller.abort();
      writeRenderDebug(renderConfig.debugRender, `cancelled pane generation for query #${requestId}`);
    };
  }, [agent, deterministicSpec, paneGeneration, renderConfig.debugRender, renderConfig.specMode, uiState.initialized]);

  return (
    <JSONUIProvider store={store} handlers={actionHandlers}>
      <GeneratedPaneFocusGate disabled={focusTarget !== "generated" || dialogsOpen} />
      <Renderer spec={spec} />
    </JSONUIProvider>
  );
}
