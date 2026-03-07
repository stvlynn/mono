import { Box, useApp } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent } from "@mono/agent-core";
import type { ConversationMessage, MemoryRecord } from "@mono/shared";
import { RootApp } from "./RootApp.js";
import { AppContext } from "./contexts/AppContext.js";
import { SettingsContext } from "./contexts/SettingsContext.js";
import { UIActionsContext, type UIActions } from "./contexts/UIActionsContext.js";
import { UIStateContext } from "./contexts/UIStateContext.js";
import { useAgentBridge } from "./hooks/useAgentBridge.js";
import { useAlternateBuffer } from "./hooks/useAlternateBuffer.js";
import { useComposerState } from "./hooks/useComposerState.js";
import { useInterruptController } from "./hooks/useInterruptController.js";
import { useSlashCommands } from "./hooks/useSlashCommands.js";
import { createMemoryItems, createModelItems, createProfileItems, createSessionItems, createTreeItems } from "./selector-items.js";
import type { DialogInstance, ListDialogItem, UISettings, UIState } from "./types/ui.js";

export interface InteractiveAppProps {
  agent: Agent;
  initialPrompt?: string;
}

const initialUiState: UIState = {
  initialized: false,
  running: false,
  status: "Starting...",
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

export function AppContainer({ agent, initialPrompt }: InteractiveAppProps) {
  const { exit } = useApp();
  const [uiState, setUiState] = useState<UIState>(initialUiState);
  const [settings, setSettings] = useState<UISettings>({
    cleanUiDetailsVisible: true,
    footerVisible: true,
    alternateBuffer: true,
    shortcutsHint: true
  });
  const uiStateRef = useRef(uiState);

  useEffect(() => {
    uiStateRef.current = uiState;
  }, [uiState]);

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

  const replaceConversation = useCallback(async (messages: ConversationMessage[], status: string) => {
    setUiState((current) => ({
      ...current,
      history: toHistory(messages),
      currentTask: agent.getCurrentTask(),
      currentTodoRecord: agent.getCurrentTodoRecord(),
      waitingCopy: undefined,
      interrupt: {},
      status,
      dialogs: current.dialogs.slice(0, -1)
    }));
  }, [agent]);

  const openListDialog = useCallback(
    (kind: "model" | "profile" | "session" | "memory" | "tree" | "settings" | "theme", title: string, items: ListDialogItem[], onSelect: (value: string) => void | Promise<void>, initialFilter?: string, hint?: string) => {
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

  const setInterruptState = useCallback((interrupt: UIState["interrupt"]) => {
    setUiState((current) => ({ ...current, interrupt }));
  }, []);

  const setStatus = useCallback((status: string) => {
    setUiState((current) => ({ ...current, status }));
  }, []);

  const { handleCtrlC, clearArming } = useInterruptController({
    getSnapshot: () => ({
      interrupt: uiStateRef.current.interrupt,
      isRunning: agent.isRunning(),
      topDialog: uiStateRef.current.dialogs.at(-1)
    }),
    setInterruptState,
    setStatus,
    abortRun: () => agent.abort(),
    closeTopDialog,
    exitApp: () => exit()
  });

  const actions = useMemo<UIActions>(() => ({
    submitPrompt: async (prompt: string) => {
      clearArming();
      setUiState((current) => ({
        ...current,
        currentPrompt: prompt,
        waitingCopy: undefined,
        interrupt: {},
        status: "Submitting prompt..."
      }));
      try {
        await agent.runTask(prompt);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setUiState((current) => ({
          ...current,
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
      }
    },
    handleInterrupt: async (context) => {
      await handleCtrlC(context);
    },
    clearInterruptArming: () => {
      clearArming();
    },
    openHelp: () => pushDialog({ id: `help-${Date.now()}`, type: "help", title: "Help" }),
    openSettings: () => pushDialog(infoDialog("Settings", ["UI settings are minimal in this build.", "Use /theme and /profile to change runtime behavior."])),
    openAuthInfo: () => pushDialog(infoDialog("Authentication", ["Use `mono auth login` to add or update a profile.", `Current config: ${agent.getConfigSummary().globalConfigPath}`])),
    openModelDialog: async (initialFilter) => {
      if (agent.isRunning()) {
        setUiState((current) => ({ ...current, status: "Cannot switch model while a run is active" }));
        return;
      }
      const items = createModelItems(await agent.listModels());
      openListDialog("model", "Models", items, async (value) => {
        await agent.setModel(value);
        closeTopDialog();
        setUiState((current) => ({ ...current, status: `Model set to ${value}` }));
      }, initialFilter, "Type to filter, Enter switch, Esc close");
    },
    openProfileDialog: async (initialFilter) => {
      if (agent.isRunning()) {
        setUiState((current) => ({ ...current, status: "Cannot switch profile while a run is active" }));
        return;
      }
      const items = createProfileItems(await agent.listProfiles());
      openListDialog("profile", "Profiles", items, async (value) => {
        await agent.setProfile(value);
        closeTopDialog();
        setUiState((current) => ({ ...current, status: `Profile set to ${value}` }));
      }, initialFilter, "Type to filter, Enter switch, Esc close");
    },
    openSessionDialog: async (initialFilter) => {
      if (agent.isRunning()) {
        setUiState((current) => ({ ...current, status: "Cannot switch session while a run is active" }));
        return;
      }
      const sessions = await agent.listSessions();
      const items = createSessionItems(sessions);
      openListDialog("session", "Session Browser", items, async (value) => {
        const selected = sessions.find((session) => session.sessionId === value);
        if (!selected) return;
        const messages = await agent.switchSession(selected.sessionId);
        await replaceConversation(messages, `Switched session ${selected.sessionId.slice(0, 8)}`);
      }, initialFilter, "Type to filter, Enter resume, Esc close");
    },
    openMemoryDialog: async (initialFilter) => {
      const records = initialFilter
        ? await Promise.all((await agent.searchMemories(initialFilter)).map((match) => agent.getMemoryRecord(match.id)))
        : await agent.listMemories(12);
      const filtered = records.filter((record): record is MemoryRecord => record !== null);
      const items = createMemoryItems(filtered);
      openListDialog("memory", initialFilter ? `Memory Search: ${initialFilter}` : "Memory", items, async (value) => {
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
    },
    openTreeDialog: async (initialFilter) => {
      if (agent.isRunning()) {
        setUiState((current) => ({ ...current, status: "Cannot switch branch while a run is active" }));
        return;
      }
      const nodes = await agent.listSessionNodes();
      const items = createTreeItems(nodes);
      openListDialog("tree", "Session Tree", items, async (value) => {
        const selected = nodes.find((node) => node.id === value);
        if (!selected) return;
        const messages = await agent.switchBranch(selected.id);
        await replaceConversation(messages, `Checked out node ${selected.id.slice(0, 8)}`);
      }, initialFilter, "Type to filter, Enter checkout, Esc close");
    },
    closeTopDialog,
    exitApp: () => exit(),
    setStatus,
    toggleCleanUi: () => setSettings((current) => ({ ...current, cleanUiDetailsVisible: !current.cleanUiDetailsVisible })),
  }), [agent, clearArming, closeTopDialog, exit, handleCtrlC, openListDialog, pushDialog, replaceConversation, setStatus]);

  const slash = useSlashCommands(actions);
  const composer = useComposerState(slash.registry);

  useAlternateBuffer(settings.alternateBuffer);
  useAgentBridge({ agent, setUiState, pushDialog });

  useEffect(() => {
    if (!initialPrompt) {
      return;
    }
    void actions.submitPrompt(initialPrompt);
  }, [actions, initialPrompt]);

  return (
    <AppContext.Provider value={{ agent, version: "0.1.0" }}>
      <SettingsContext.Provider value={{ settings, setSettings }}>
        <UIActionsContext.Provider value={actions}>
          <UIStateContext.Provider value={uiState}>
            <Box flexDirection="column">
              <RootApp composer={composer} slash={slash} />
            </Box>
          </UIStateContext.Provider>
        </UIActionsContext.Provider>
      </SettingsContext.Provider>
    </AppContext.Provider>
  );
}
