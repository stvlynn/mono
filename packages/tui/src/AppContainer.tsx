import { Box, Text, useApp, useStdin } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent } from "@mono/agent-core";
import { catalogModelToUnifiedModel, listCatalogModels, listCatalogProviders, upsertProfile, type CatalogProvider, type CatalogTransportCandidate } from "@mono/config";
import type { ConversationMessage, MemoryRecord } from "@mono/shared";
import { RootApp } from "./RootApp.js";
import { AppContext } from "./contexts/AppContext.js";
import { ForegroundKeypressContext, type ForegroundKeypressHandler } from "./contexts/ForegroundKeypressContext.js";
import { SettingsContext } from "./contexts/SettingsContext.js";
import { UIActionsContext, type UIActions } from "./contexts/UIActionsContext.js";
import { UIStateContext } from "./contexts/UIStateContext.js";
import { useAgentBridge } from "./hooks/useAgentBridge.js";
import { useAlternateBuffer } from "./hooks/useAlternateBuffer.js";
import { useComposerState } from "./hooks/useComposerState.js";
import { useInterruptController } from "./hooks/useInterruptController.js";
import { useRawKeypress } from "./hooks/useRawKeypress.js";
import { useRepeatedKeyPress } from "./hooks/useRepeatedKeyPress.js";
import { useTuiShutdown } from "./hooks/useTuiShutdown.js";
import { useSlashCommands } from "./hooks/useSlashCommands.js";
import { createConfiguredProfileItems, createMemoryItems, createSessionItems, createTreeItems } from "./selector-items.js";
import { FatalScreen } from "./components/FatalScreen.js";
import { TuiErrorBoundary } from "./components/TuiErrorBoundary.js";
import { isRecoverableRuntimeError } from "./error-classification.js";
import { shouldSetConnectedProfileAsDefault } from "./connect-default.js";
import type { DialogInstance, ListDialogItem, UISettings, UIState } from "./types/ui.js";

export interface InteractiveAppProps {
  agent: Agent;
  initialPrompt?: string;
}

const initialUiState: UIState = {
  initialized: false,
  startupState: "idle",
  running: false,
  isExiting: false,
  status: "Starting...",
  fatalError: undefined,
  waitingCopy: undefined,
  interrupt: {},
  history: [],
  pendingAssistant: null,
  pendingTools: [],
  dialogs: [],
  toasts: []
};

function toHistory(messages: ConversationMessage[]) {
  return messages.map((message, index) => ({
    id: `message-${message.timestamp}-${index}`,
    type: "message" as const,
    message
  }));
}

function infoDialog(title: string, body: string[]): DialogInstance {
  return {
    id: `info-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: "info",
    title,
    body
  };
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}

function formatTransportCandidate(candidate: CatalogTransportCandidate): string {
  const parts: string[] = [candidate.kind];
  if (candidate.runtimeProviderKey) {
    parts.push(candidate.runtimeProviderKey);
  }
  if (candidate.api) {
    parts.push(candidate.api);
  }
  return parts.join(" · ");
}

function normalizeNameSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function createSuggestedProfileName(providerId: string, modelId: string, existingNames: string[]): string {
  const base = normalizeNameSegment(providerId) || "profile";
  const modelSegment = normalizeNameSegment(modelId);
  const candidates = [base, modelSegment ? `${base}-${modelSegment}` : base];

  for (const candidate of candidates) {
    if (candidate && !existingNames.includes(candidate)) {
      return candidate;
    }
  }

  let index = 2;
  const uniqueBase = candidates.at(-1) ?? base;
  while (existingNames.includes(`${uniqueBase}-${index}`)) {
    index += 1;
  }
  return `${uniqueBase}-${index}`;
}

export function AppContainer({ agent, initialPrompt }: InteractiveAppProps) {
  const { exit } = useApp();
  const { setRawMode } = useStdin();
  const [uiState, setUiState] = useState<UIState>(initialUiState);
  const [settings, setSettings] = useState<UISettings>({
    cleanUiDetailsVisible: true,
    footerVisible: true,
    alternateBuffer: true,
    shortcutsHint: true,
    assistantMarkdownEnabled: true,
    thinkingVisible: true,
    toolDetailsVisible: true
  });
  const uiStateRef = useRef(uiState);
  const initializationRef = useRef<Promise<void> | null>(null);
  const keypressHandlerStackRef = useRef<Array<{ id: number; handler: ForegroundKeypressHandler }>>([]);
  const nextKeypressHandlerIdRef = useRef(0);

  useEffect(() => {
    uiStateRef.current = uiState;
  }, [uiState]);

  const registerForegroundKeypressHandler = useCallback((handler: ForegroundKeypressHandler) => {
    const id = nextKeypressHandlerIdRef.current++;
    keypressHandlerStackRef.current = [...keypressHandlerStackRef.current, { id, handler }];

    return () => {
      keypressHandlerStackRef.current = keypressHandlerStackRef.current.filter((entry) => entry.id !== id);
    };
  }, []);

  const dispatchForegroundKeypress = useCallback((input: string, key: Parameters<ForegroundKeypressHandler>[1]) => {
    const current = keypressHandlerStackRef.current.at(-1);
    current?.handler(input, key);
  }, []);

  const pushDialog = useCallback((dialog: DialogInstance) => {
    setUiState((current) => ({ ...current, dialogs: [...current.dialogs, dialog], interrupt: {} }));
  }, []);

  const closeTopDialog = useCallback(() => {
    setUiState((current) => {
      const top = current.dialogs.at(-1);
      if (top?.type === "approval") {
        top.resolve(false);
      }
      return { ...current, dialogs: current.dialogs.slice(0, -1) };
    });
  }, []);

  const reportUiError = useCallback((error: unknown, fallback: string) => {
    const message = errorMessage(error, fallback);
    setUiState((current) => ({
      ...current,
      running: false,
      status: message,
      waitingCopy: undefined,
      pendingAssistant: null,
      pendingTools: [],
      toasts: [
        ...current.toasts,
        {
          id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          level: "error" as const,
          message
        }
      ].slice(-3)
    }));
  }, []);

  const reportFatalError = useCallback((error: unknown, fallback: string) => {
    const message = errorMessage(error, fallback);
    setUiState((current) => ({
      ...current,
      initialized: false,
      startupState: "init_failed",
      fatalError: message,
      waitingCopy: undefined,
      pendingAssistant: null,
      pendingTools: [],
      status: message,
      toasts: [
        ...current.toasts,
        {
          id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          level: "error" as const,
          message
        }
      ].slice(-3)
    }));
  }, []);

  const runUiAction = useCallback(async <T,>(action: () => Promise<T>, fallback: string): Promise<T | undefined> => {
    try {
      return await action();
    } catch (error) {
      reportUiError(error, fallback);
      return undefined;
    }
  }, [reportUiError]);

  const dismissFatalError = useCallback(() => {
    setUiState((current) => ({
      ...current,
      fatalError: undefined,
      status: current.status || "Ready"
    }));
  }, []);

  const replaceConversation = useCallback(async (messages: ConversationMessage[], status: string) => {
    setUiState((current) => ({
      ...current,
      initialized: true,
      startupState: "ready",
      history: toHistory(messages),
      currentTask: agent.getCurrentTask(),
      currentTodoRecord: agent.getCurrentTodoRecord(),
      waitingCopy: undefined,
      interrupt: {},
      status,
      dialogs: current.dialogs.slice(0, -1)
    }));
  }, [agent]);

  const syncInitializedState = useCallback(() => {
    const summary = agent.getConfigSummary();
    setUiState((current) => ({
      ...current,
      initialized: true,
      startupState: "ready",
      fatalError: undefined,
      history: agent.getMessages().map((message) => ({
        id: `message-${message.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
        type: "message",
        message
      })),
      currentTask: agent.getCurrentTask(),
      currentTodoRecord: agent.getCurrentTodoRecord(),
      status: summary.hasAnyProfiles ? "Ready" : "No configured profiles found. Run mono auth login."
    }));
  }, [agent]);

  const initializeAgent = useCallback(async (): Promise<void> => {
    if (uiStateRef.current.startupState === "ready" && uiStateRef.current.initialized) {
      return;
    }
    if (initializationRef.current) {
      return initializationRef.current;
    }

    setUiState((current) => ({
      ...current,
      startupState: "initializing",
      status: current.initialized ? current.status : "Starting..."
    }));

    initializationRef.current = agent.initialize()
      .then(() => {
        syncInitializedState();
      })
      .catch((error) => {
        const message = errorMessage(error, "Failed to initialize agent");
        setUiState((current) => ({
          ...current,
          initialized: false,
          startupState: "init_failed",
          waitingCopy: undefined,
          pendingAssistant: null,
          pendingTools: [],
          status: message,
          toasts: [
            ...current.toasts,
            {
              id: `toast-${Date.now()}`,
              level: "error" as const,
              message
            }
          ].slice(-3)
        }));
      })
      .finally(() => {
        initializationRef.current = null;
      });

    return initializationRef.current;
  }, [agent, syncInitializedState]);

  const openListDialog = useCallback(
    (
      kind:
        | "model"
        | "profile"
        | "session"
        | "memory"
        | "tree"
        | "settings"
        | "theme"
        | "connect-provider"
        | "connect-model"
        | "connect-interface",
      title: string,
      items: ListDialogItem[],
      onSelect: (value: string) => void | Promise<void>,
      initialFilter?: string,
      hint?: string
    ) => {
      pushDialog({
        id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: "list",
        kind,
        title,
        items,
        onSelect,
        initialFilter,
        hint
      });
    },
    [pushDialog]
  );

  const openSafeListDialog = useCallback(
    (
      kind:
        | "model"
        | "profile"
        | "session"
        | "memory"
        | "tree"
        | "settings"
        | "theme"
        | "connect-provider"
        | "connect-model"
        | "connect-interface",
      title: string,
      items: ListDialogItem[],
      onSelect: (value: string) => void | Promise<void>,
      initialFilter?: string,
      hint?: string
    ) => {
      openListDialog(
        kind,
        title,
        items,
        async (value) => {
          await runUiAction(() => Promise.resolve(onSelect(value)), `Failed to apply ${kind} selection`);
        },
        initialFilter,
        hint
      );
    },
    [openListDialog, runUiAction]
  );

  const openInputDialog = useCallback(
    (
      title: string,
      label: string,
      onSubmit: (value: string) => void | Promise<void>,
      options: {
        initialValue?: string;
        placeholder?: string;
        hint?: string;
        secret?: boolean;
      } = {}
    ) => {
      pushDialog({
        id: `connect-key-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: "input",
        kind: "connect-key",
        title,
        label,
        onSubmit,
        initialValue: options.initialValue,
        placeholder: options.placeholder,
        hint: options.hint,
        secret: options.secret
      });
    },
    [pushDialog]
  );

  const openSafeInputDialog = useCallback(
    (
      title: string,
      label: string,
      onSubmit: (value: string) => void | Promise<void>,
      options: {
        initialValue?: string;
        placeholder?: string;
        hint?: string;
        secret?: boolean;
      } = {},
      fallback = "Failed to submit dialog input"
    ) => {
      openInputDialog(title, label, async (value) => {
        await runUiAction(() => Promise.resolve(onSubmit(value)), fallback);
      }, options);
    },
    [openInputDialog, runUiAction]
  );

  const setInterruptState = useCallback((interrupt: UIState["interrupt"]) => {
    setUiState((current) => ({ ...current, interrupt }));
  }, []);

  const setStatus = useCallback((status: string) => {
    setUiState((current) => ({ ...current, status }));
  }, []);

  const openConfiguredProfileSelector = useCallback(async (
    kind: "model" | "profile",
    initialFilter?: string
  ) => {
    if (agent.isRunning()) {
      setUiState((current) => ({
        ...current,
        status: kind === "model"
          ? "Cannot switch model while a run is active"
          : "Cannot switch profile while a run is active"
      }));
      return;
    }

    await runUiAction(async () => {
      const profiles = await agent.listConfiguredProfiles();
      if (profiles.length === 0) {
        setUiState((current) => ({
          ...current,
          status: "No configured profiles found. Use /connect to add one."
        }));
        return;
      }

      const items = createConfiguredProfileItems(profiles);
      openSafeListDialog(
        kind,
        kind === "model" ? "Configured Models" : "Profiles",
        items,
        async (value) => {
          const resolved = await agent.setProfile(value);
          closeTopDialog();
          setUiState((current) => ({
            ...current,
            initialized: true,
            startupState: "ready",
            fatalError: undefined,
            status:
              kind === "model"
                ? `Model set to ${resolved.model.provider}/${resolved.model.modelId} (${resolved.profileName})`
                : `Profile set to ${resolved.profileName}`
          }));
        },
        initialFilter,
        kind === "model"
          ? "Type to filter configured models, Enter switch, Esc close"
          : "Type to filter profiles, Enter switch, Esc close"
      );
    }, kind === "model" ? "Failed to open configured models" : "Failed to open profile list");
  }, [agent, closeTopDialog, openSafeListDialog, runUiAction]);

  const finishConnectFlow = useCallback(async (
    provider: CatalogProvider,
    modelId: string,
    runtimeProviderKey: string | undefined,
    preferredFamily: "openai-compatible" | "anthropic" | "gemini" | undefined,
    apiKey: string
  ) => {
    const models = await listCatalogModels(process.cwd(), provider.id);
    const model = models.find((item) => item.id === modelId);
    if (!model) {
      throw new Error(`Model not found for provider ${provider.id}: ${modelId}`);
    }
    const normalized = catalogModelToUnifiedModel(provider, model, {
      runtimeProviderKey,
      preferredFamily
    });
    const configSummary = agent.getConfigSummary();
    const configuredProfiles = await agent.listConfiguredProfiles();
    const existingProfile = configuredProfiles.find((profile) =>
      profile.model.provider === normalized.provider
      && profile.model.modelId === normalized.modelId
      && profile.model.runtimeProviderKey === normalized.runtimeProviderKey
      && profile.model.baseURL === normalized.baseURL
    );
    const profileName = existingProfile?.name
      ?? createSuggestedProfileName(provider.id, modelId, configuredProfiles.map((profile) => profile.name));

    await upsertProfile({
      cwd: process.cwd(),
      profile: profileName,
      provider: provider.id,
      model: modelId,
      baseURL: normalized.baseURL,
      runtimeProviderKey: normalized.runtimeProviderKey,
      apiKey,
      setDefault: shouldSetConnectedProfileAsDefault(configSummary.hasAnyProfiles)
    });

    await agent.refreshRegistry();
    const resolved = await agent.setProfile(profileName);
    setUiState((current) => ({
      ...current,
      initialized: true,
      startupState: "ready",
      fatalError: undefined,
      status: `Connected ${resolved.model.provider}/${resolved.model.modelId} as ${profileName}`
    }));
  }, [agent]);

  const openConnectKeyDialog = useCallback((
    provider: CatalogProvider,
    modelId: string,
    runtimeProviderKey: string | undefined,
    preferredFamily: "openai-compatible" | "anthropic" | "gemini" | undefined
  ) => {
    openSafeInputDialog(
      "Connect: API Key",
      `API key for ${provider.id}/${modelId}`,
      async (value) => {
        const apiKey = value.trim();
        if (!apiKey) {
          throw new Error("API key cannot be empty");
        }
        closeTopDialog();
        await finishConnectFlow(provider, modelId, runtimeProviderKey, preferredFamily, apiKey);
      },
      {
        hint: "Paste the API key, then press Enter to save. Esc closes this dialog.",
        placeholder: "sk-...",
        secret: true
      },
      "Failed to save provider connection"
    );
  }, [closeTopDialog, finishConnectFlow, openSafeInputDialog]);

  const openConnectInterfaceDialog = useCallback((
    provider: CatalogProvider,
    modelId: string,
    candidates: CatalogTransportCandidate[]
  ) => {
    if (candidates.length <= 1) {
      const candidate = candidates[0];
      openConnectKeyDialog(provider, modelId, candidate?.runtimeProviderKey, candidate?.kind);
      return;
    }

    const items = candidates.map((candidate, index) => ({
      value: String(index),
      label: `${provider.id}/${modelId}`,
      description: formatTransportCandidate(candidate)
    }));

    openSafeListDialog(
      "connect-interface",
      `Connect: Interface for ${provider.id}/${modelId}`,
      items,
      async (value) => {
        const candidate = candidates[Number(value)];
        if (!candidate) {
          throw new Error("Selected interface was not found");
        }
        closeTopDialog();
        openConnectKeyDialog(provider, modelId, candidate.runtimeProviderKey, candidate.kind);
      },
      undefined,
      "Type to filter, Enter continue, Esc close"
    );
  }, [closeTopDialog, openConnectKeyDialog, openSafeListDialog]);

  const openConnectModelDialog = useCallback(async (provider: CatalogProvider, initialFilter?: string) => {
    const models = await listCatalogModels(process.cwd(), provider.id);
    const supportedModels = models.filter((model) => model.supported);
    if (supportedModels.length === 0) {
      throw new Error(`No runnable models found for provider ${provider.id}`);
    }

    openSafeListDialog(
      "connect-model",
      `Connect: Models for ${provider.id}`,
      supportedModels.map((model) => ({
        value: model.id,
        label: `${provider.id}/${model.id}`,
        description: model.api ?? provider.api ?? provider.name
      })),
      async (value) => {
        const model = supportedModels.find((item) => item.id === value);
        if (!model) {
          throw new Error(`Model not found for provider ${provider.id}: ${value}`);
        }
        closeTopDialog();
        const candidates = (model.transportCandidates ?? provider.transportCandidates ?? [])
          .filter((candidate) => candidate.supportedByMono);
        openConnectInterfaceDialog(provider, model.id, candidates);
      },
      initialFilter,
      "Type to filter, Enter continue, Esc close"
    );
  }, [closeTopDialog, openConnectInterfaceDialog, openSafeListDialog]);

  const openConnectProviderDialog = useCallback(async (initialFilter?: string) => {
    if (agent.isRunning()) {
      setUiState((current) => ({ ...current, status: "Cannot connect a provider while a run is active" }));
      return;
    }

    await runUiAction(async () => {
      const providers = (await listCatalogProviders(process.cwd())).filter((provider) => provider.supported);
      if (providers.length === 0) {
        throw new Error("No runnable providers are available from the catalog");
      }
      openSafeListDialog(
        "connect-provider",
        "Connect: Provider",
        providers.map((provider) => ({
          value: provider.id,
          label: provider.id,
          description: provider.name
        })),
        async (value) => {
          const provider = providers.find((item) => item.id === value);
          if (!provider) {
            throw new Error(`Provider not found: ${value}`);
          }
          closeTopDialog();
          await openConnectModelDialog(provider);
        },
        initialFilter,
        "Type to filter, Enter continue, Esc close"
      );
    }, "Failed to open provider catalog");
  }, [agent, closeTopDialog, openConnectModelDialog, openSafeListDialog, runUiAction]);

  const { requestShutdown, forceExit } = useTuiShutdown({
    agent,
    setRawMode,
    exit,
    uiStateRef,
    setUiState,
    setInterruptState
  });

  const { handlePress: handleCtrlCPress, resetCount: resetCtrlCPress } = useRepeatedKeyPress({
    windowMs: 600,
    onRepeat: (count) => {
      if (count > 1) {
        void requestShutdown();
      }
    },
    onReset: () => {
      setInterruptState({});
    }
  });

  const { handleCtrlC, clearArming } = useInterruptController({
    getSnapshot: () => ({
      interrupt: uiStateRef.current.interrupt,
      isRunning: agent.isRunning(),
      isExiting: uiStateRef.current.isExiting,
      topDialog: uiStateRef.current.dialogs.at(-1)
    }),
    setInterruptState,
    setStatus,
    abortRun: () => agent.abort(),
    closeTopDialog,
    registerCtrlCPress: handleCtrlCPress,
    resetCtrlCPress,
    forceExit
  });

  const actions = useMemo<UIActions>(() => ({
    submitPrompt: async (prompt: string) => {
      clearArming();
      setUiState((current) => ({
        ...current,
        isExiting: false,
        currentPrompt: prompt,
        waitingCopy: undefined,
        interrupt: {},
        status: "Submitting prompt..."
      }));
      try {
        await agent.runTask(prompt);
      } catch (error) {
        reportUiError(error, "Failed to run task");
      }
    },
    handleInterrupt: async () => {
      await handleCtrlC();
    },
    clearInterruptArming: () => {
      clearArming();
    },
    openHelp: () => pushDialog({ id: `help-${Date.now()}`, type: "help", title: "Help" }),
    openSettings: () => {
      const items: ListDialogItem[] = [
        {
          value: "assistant-markdown",
          label: `Assistant markdown: ${settings.assistantMarkdownEnabled ? "on" : "off"}`,
          description: "Render assistant text with Markdown formatting."
        },
        {
          value: "thinking-visible",
          label: `Thinking visible: ${settings.thinkingVisible ? "on" : "off"}`,
          description: "Show or hide assistant reasoning blocks."
        },
        {
          value: "tool-details",
          label: `Tool details: ${settings.toolDetailsVisible ? "on" : "off"}`,
          description: "Show or hide detailed tool arguments and outputs."
        }
      ];

      openSafeListDialog(
        "settings",
        "Settings",
        items,
        async (value) => {
          switch (value) {
            case "assistant-markdown":
              setSettings((current) => ({
                ...current,
                assistantMarkdownEnabled: !current.assistantMarkdownEnabled
              }));
              setStatus(`Assistant markdown ${settings.assistantMarkdownEnabled ? "disabled" : "enabled"}`);
              break;
            case "thinking-visible":
              setSettings((current) => ({
                ...current,
                thinkingVisible: !current.thinkingVisible
              }));
              setStatus(`Thinking ${settings.thinkingVisible ? "hidden" : "visible"}`);
              break;
            case "tool-details":
              setSettings((current) => ({
                ...current,
                toolDetailsVisible: !current.toolDetailsVisible
              }));
              setStatus(`Tool details ${settings.toolDetailsVisible ? "hidden" : "visible"}`);
              break;
            default:
              break;
          }
          closeTopDialog();
        },
        undefined,
        "Enter toggles a setting, Esc closes"
      );
    },
    openAuthInfo: () => pushDialog(infoDialog("Authentication", ["Use `/connect` in the TUI or `mono auth login` in the shell to add or update a profile.", `Current config: ${agent.getConfigSummary().globalConfigPath}`])),
    openConnectDialog: async (initialFilter) => {
      await openConnectProviderDialog(initialFilter);
    },
    openModelDialog: async (initialFilter) => {
      await openConfiguredProfileSelector("model", initialFilter);
    },
    openProfileDialog: async (initialFilter) => {
      await openConfiguredProfileSelector("profile", initialFilter);
    },
    openSessionDialog: async (initialFilter) => {
      if (agent.isRunning()) {
        setUiState((current) => ({ ...current, status: "Cannot switch session while a run is active" }));
        return;
      }
      await runUiAction(async () => {
        await initializeAgent();
        const sessions = await agent.listSessions();
        const items = createSessionItems(sessions);
        openSafeListDialog("session", "Session Browser", items, async (value) => {
          const selected = sessions.find((session) => session.sessionId === value);
          if (!selected) return;
          const messages = await agent.switchSession(selected.sessionId);
          await replaceConversation(messages, `Switched session ${selected.sessionId.slice(0, 8)}`);
        }, initialFilter, "Type to filter, Enter resume, Esc close");
      }, "Failed to open session browser");
    },
    openMemoryDialog: async (initialFilter) => {
      await runUiAction(async () => {
        await initializeAgent();
        const records = initialFilter
          ? await Promise.all((await agent.searchMemories(initialFilter)).map((match) => agent.getMemoryRecord(match.id)))
          : await agent.listMemories(12);
        const filtered = records.filter((record): record is MemoryRecord => record !== null);
        const items = createMemoryItems(filtered);
        openSafeListDialog("memory", initialFilter ? `Memory Search: ${initialFilter}` : "Memory", items, async (value) => {
          const record = await agent.getMemoryRecord(value);
          if (!record) {
            setUiState((current) => ({ ...current, status: `Memory not found: ${value}` }));
            return;
          }
          closeTopDialog();
          pushDialog(infoDialog(`Memory ${record.id}`, [
            `Files: ${record.files.join(", ") || "<none>"}`,
            `Tools: ${record.tools.join(", ") || "<none>"}`,
            `Input: ${record.input}`,
            `Output: ${record.output}`,
            ...(record.compacted.length > 0 ? record.compacted.map((line) => `- ${line}`) : ["- <none>"])
          ]));
        }, initialFilter, "Type to filter, Enter inspect, Esc close");
      }, "Failed to open memory list");
    },
    openTreeDialog: async (initialFilter) => {
      if (agent.isRunning()) {
        setUiState((current) => ({ ...current, status: "Cannot switch branch while a run is active" }));
        return;
      }
      await runUiAction(async () => {
        await initializeAgent();
        const nodes = await agent.listSessionNodes();
        const items = createTreeItems(nodes);
        openSafeListDialog("tree", "Session Tree", items, async (value) => {
          const selected = nodes.find((node) => node.id === value);
          if (!selected) return;
          const messages = await agent.switchBranch(selected.id);
          await replaceConversation(messages, `Checked out node ${selected.id.slice(0, 8)}`);
        }, initialFilter, "Type to filter, Enter checkout, Esc close");
      }, "Failed to open session tree");
    },
    closeTopDialog,
    dismissFatalError,
    requestShutdown,
    setStatus,
    toggleCleanUi: () => setSettings((current) => ({ ...current, cleanUiDetailsVisible: !current.cleanUiDetailsVisible })),
    toggleAssistantMarkdown: () => {
      setSettings((current) => ({ ...current, assistantMarkdownEnabled: !current.assistantMarkdownEnabled }));
      setStatus(`Assistant markdown ${settings.assistantMarkdownEnabled ? "disabled" : "enabled"}`);
    },
    toggleThinkingVisibility: () => {
      setSettings((current) => ({ ...current, thinkingVisible: !current.thinkingVisible }));
      setStatus(`Thinking ${settings.thinkingVisible ? "hidden" : "visible"}`);
    },
    toggleToolDetails: () => {
      setSettings((current) => ({ ...current, toolDetailsVisible: !current.toolDetailsVisible }));
      setStatus(`Tool details ${settings.toolDetailsVisible ? "hidden" : "visible"}`);
    }
  }), [agent, clearArming, closeTopDialog, dismissFatalError, handleCtrlC, initializeAgent, openSafeListDialog, pushDialog, replaceConversation, reportUiError, requestShutdown, runUiAction, setStatus, settings.assistantMarkdownEnabled, settings.thinkingVisible, settings.toolDetailsVisible]);

  const slash = useSlashCommands(actions);
  const composer = useComposerState(slash.registry);

  useAlternateBuffer(settings.alternateBuffer);
  useRawKeypress(dispatchForegroundKeypress, { isActive: true });
  useAgentBridge({ agent, setUiState, pushDialog });

  useEffect(() => {
    void initializeAgent();
  }, [initializeAgent]);

  useEffect(() => {
    const handleUnhandledRejection = (reason: unknown) => {
      const state = uiStateRef.current;
      if (isRecoverableRuntimeError(reason, state)) {
        reportUiError(reason, "Unhandled runtime error");
        return;
      }
      reportFatalError(reason, "Unhandled rejection in TUI");
    };
    const handleUncaughtException = (error: Error) => {
      const state = uiStateRef.current;
      if (isRecoverableRuntimeError(error, state)) {
        reportUiError(error, "Uncaught runtime error");
        return;
      }
      reportFatalError(error, "Uncaught exception in TUI");
    };

    process.on("unhandledRejection", handleUnhandledRejection);
    process.on("uncaughtException", handleUncaughtException);

    return () => {
      process.off("unhandledRejection", handleUnhandledRejection);
      process.off("uncaughtException", handleUncaughtException);
    };
  }, [reportFatalError, reportUiError]);

  useEffect(() => {
    if (!initialPrompt) {
      return;
    }
    void actions.submitPrompt(initialPrompt);
  }, [actions, initialPrompt]);

  return (
    <AppContext.Provider value={{ agent, version: "0.1.0" }}>
      <SettingsContext.Provider value={{ settings, setSettings }}>
        <ForegroundKeypressContext.Provider value={{ registerForegroundKeypressHandler }}>
          <UIActionsContext.Provider value={actions}>
            <UIStateContext.Provider value={uiState}>
              <Box flexDirection="column">
                {uiState.fatalError ? (
                  <FatalScreen />
                ) : (
                  <TuiErrorBoundary onError={(error) => reportFatalError(error, "Render failure in TUI")}>
                    <RootApp composer={composer} slash={slash} />
                  </TuiErrorBoundary>
                )}
              </Box>
            </UIStateContext.Provider>
          </UIActionsContext.Provider>
        </ForegroundKeypressContext.Provider>
      </SettingsContext.Provider>
    </AppContext.Provider>
  );
}
