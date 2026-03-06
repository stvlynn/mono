import { truncateToWidth } from "@mono/pi-tui";
import type { SessionNodeSummary, SessionSummary, UnifiedModel } from "@mono/shared";
import { formatTime } from "./ui-format.js";

export interface SelectOptionItem {
  value: string;
  label: string;
  description?: string;
}

export function createProfileItems(profiles: string[]): SelectOptionItem[] {
  return profiles.map((profile) => ({ value: profile, label: profile }));
}

export function createModelItems(models: UnifiedModel[]): SelectOptionItem[] {
  return models.map((model) => ({
    value: `${model.provider}/${model.modelId}`,
    label: `${model.provider}/${model.modelId}`,
    description: model.baseURL
  }));
}

export function createSessionItems(sessions: SessionSummary[]): SelectOptionItem[] {
  return sessions.map((session) => ({
    value: session.sessionId,
    label: `${session.sessionId.slice(0, 8)}  ${formatTime(session.updatedAt)}`,
    description: session.cwd
  }));
}

export function createTreeItems(nodes: SessionNodeSummary[]): SelectOptionItem[] {
  return nodes.map((node) => ({
    value: node.id,
    label: `[${node.entryType}] ${truncateToWidth(node.label, 60)}`,
    description: new Date(node.timestamp).toLocaleString()
  }));
}
