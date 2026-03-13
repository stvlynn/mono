import type { MemoryRecord, MonoOpenVikingConfig } from "@mono/shared";

export interface OpenVikingConnectionOptions {
  url: string;
  apiKey?: string;
  agentId?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface OpenVikingMatchedContext {
  uri: string;
  contextType: "memory" | "resource" | "skill";
  abstract: string;
  score?: number;
  matchReason?: string;
  isLeaf?: boolean;
}

export interface OpenVikingSearchResult {
  memories: OpenVikingMatchedContext[];
  resources: OpenVikingMatchedContext[];
  skills: OpenVikingMatchedContext[];
  total: number;
  queryPlan?: unknown;
}

export interface OpenVikingRetrievalOptions {
  config: MonoOpenVikingConfig;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface OpenVikingShadowExportResult {
  sessionId: string;
  extracted: unknown;
  recordId: MemoryRecord["id"];
}

export interface OpenVikingStructuredMemoryRecord {
  id: string;
  scope: "self" | "other" | "project" | "episodic";
  title: string;
  summary: string;
  detailLines?: string[];
}

export interface OpenVikingStructuredShadowExportResult {
  sessionId: string;
  extracted: unknown;
  recordId: string;
}
