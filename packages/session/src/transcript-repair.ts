import { createId, resolveTranscriptPolicy, sanitizeConversationMessages, type ConversationMessage, type SessionEntry, type SessionEntryType, type UnifiedModel, type UserMessage, type AssistantMessage, type ToolResultMessage } from "@mono/shared";

const MESSAGE_ENTRY_TYPES = new Set<SessionEntryType>(["user", "autonomy_trigger", "assistant", "tool"]);

export interface SessionTranscriptRepairReport {
  modified: boolean;
  skippedReason?: string;
  addedSyntheticToolResults: number;
  droppedOrphanToolResults: number;
  droppedMalformedToolCalls: number;
  droppedAssistantMessages: number;
}

export function repairLinearSessionTranscript(
  entries: SessionEntry[],
  model: UnifiedModel
): { entries: SessionEntry[]; report: SessionTranscriptRepairReport } {
  if (!isLinearSession(entries)) {
    return {
      entries,
      report: {
        modified: false,
        skippedReason: "non-linear-session",
        addedSyntheticToolResults: 0,
        droppedOrphanToolResults: 0,
        droppedMalformedToolCalls: 0,
        droppedAssistantMessages: 0,
      },
    };
  }

  const repairedEntries: SessionEntry[] = [];
  let previousId: string | undefined;
  let modified = false;
  let addedSyntheticToolResults = 0;
  let droppedOrphanToolResults = 0;
  let droppedMalformedToolCalls = 0;
  let droppedAssistantMessages = 0;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) {
      continue;
    }

    if (!MESSAGE_ENTRY_TYPES.has(entry.entryType)) {
      const nextEntry = { ...entry, parentId: previousId };
      repairedEntries.push(nextEntry);
      previousId = nextEntry.id;
      continue;
    }

    const block: SessionEntry[] = [];
    while (index < entries.length) {
      const current = entries[index];
      if (!current || !MESSAGE_ENTRY_TYPES.has(current.entryType)) {
        break;
      }
      block.push(current);
      index += 1;
    }
    index -= 1;

    const messages = block.map((current) => current.payload as ConversationMessage);
    const repaired = sanitizeConversationMessages(messages, {
      policy: resolveTranscriptPolicy(model),
    });

    if (
      repaired.addedSyntheticToolResults > 0
      || repaired.droppedAssistantMessages > 0
      || repaired.droppedMalformedToolCalls > 0
      || repaired.droppedOrphanToolResults > 0
      || repaired.messages.length !== messages.length
    ) {
      modified = true;
    }

    addedSyntheticToolResults += repaired.addedSyntheticToolResults;
    droppedOrphanToolResults += repaired.droppedOrphanToolResults;
    droppedMalformedToolCalls += repaired.droppedMalformedToolCalls;
    droppedAssistantMessages += repaired.droppedAssistantMessages;

    const originalUserTypes = block
      .filter((current) => current.entryType === "user" || current.entryType === "autonomy_trigger")
      .map((current) => current.entryType);

    repaired.messages.forEach((message, offset) => {
      const source = block[offset];
      const nextEntry: SessionEntry = {
        id: source?.id ?? createId(),
        parentId: previousId,
        timestamp: message.timestamp ?? source?.timestamp ?? Date.now(),
        entryType: resolveEntryTypeForMessage(message, originalUserTypes),
        payload: message as never,
      };
      repairedEntries.push(nextEntry);
      previousId = nextEntry.id;
    });
  }

  return {
    entries: modified ? repairedEntries : entries,
    report: {
      modified,
      addedSyntheticToolResults,
      droppedOrphanToolResults,
      droppedMalformedToolCalls,
      droppedAssistantMessages,
    },
  };
}

function isLinearSession(entries: SessionEntry[]): boolean {
  let previousId: string | undefined;
  for (const entry of entries) {
    if (!entry) {
      continue;
    }
    if (entry.parentId !== previousId && previousId !== undefined) {
      return false;
    }
    previousId = entry.id;
  }
  return true;
}

function resolveEntryTypeForMessage(
  message: ConversationMessage,
  originalUserTypes: SessionEntryType[]
): SessionEntryType {
  if (message.role === "assistant") {
    return "assistant";
  }
  if (message.role === "tool") {
    return "tool";
  }
  const nextUserType = originalUserTypes.shift();
  if (nextUserType === "autonomy_trigger" || (message as UserMessage).origin && (message as UserMessage).origin !== "user") {
    return "autonomy_trigger";
  }
  return "user";
}
