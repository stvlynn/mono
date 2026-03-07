import { normalize as normalizePath } from "node:path";
import type { AgentTool, ToolExecutionResult, ToolResultPart } from "@mono/shared";
import type { LlmRunOptions } from "./types.js";

interface ToolResultRecord {
  toolName: string;
  input: unknown;
  inputSignature: string;
  content: string | ToolResultPart[];
  isError: boolean;
}

interface ScheduledToolRequest {
  order: number;
  tool: AgentTool;
  input: unknown;
  parsedArgs: unknown;
  parseError?: unknown;
  toolCallId: string;
  resolve: (value: string | Array<Record<string, unknown>>) => void;
  reject: (reason?: unknown) => void;
}

interface ToolBatchSchedulerOptions {
  llmOptions: LlmRunOptions;
  toolResultMap: Map<string, ToolResultRecord>;
  toXsaiContent: (parts: ToolResultPart[]) => Array<Record<string, unknown>>;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function normalizeString(value: string, key?: string): string {
  const collapsed = value.trim().replace(/\s+/gu, " ");
  if (key?.toLowerCase().includes("path")) {
    return normalizePath(collapsed).replace(/\\/gu, "/");
  }
  return collapsed;
}

function normalizeValue(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    return normalizeString(value, key);
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, currentKey) => {
        result[currentKey] = normalizeValue((value as Record<string, unknown>)[currentKey], currentKey);
        return result;
      }, {});
  }

  return value;
}

function createInputSignature(tool: AgentTool, args: unknown): string {
  try {
    const explicit = tool.conflictKey?.(args as never);
    if (explicit) {
      return `${tool.name}:${normalizeString(explicit)}`;
    }
  } catch {
    // Fall back to a generic normalized signature when conflictKey expects validated args.
  }

  try {
    return `${tool.name}:${JSON.stringify(normalizeValue(args))}`;
  } catch {
    return `${tool.name}:<unserializable>`;
  }
}

export class ToolBatchScheduler {
  private readonly options: ToolBatchSchedulerOptions;
  private pending: ScheduledToolRequest[] = [];
  private flushScheduled = false;
  private nextOrder = 0;

  constructor(options: ToolBatchSchedulerOptions) {
    this.options = options;
  }

  schedule(tool: AgentTool, input: unknown, toolCallId: string): Promise<string | Array<Record<string, unknown>>> {
    let parsedArgs: unknown = input;
    let parseError: unknown;

    try {
      parsedArgs = tool.parseArgs ? tool.parseArgs(input) : input;
    } catch (error) {
      parseError = error;
    }

    return new Promise((resolve, reject) => {
      this.pending.push({
        order: this.nextOrder++,
        tool,
        input,
        parsedArgs,
        parseError,
        toolCallId,
        resolve,
        reject
      });

      if (!this.flushScheduled) {
        this.flushScheduled = true;
        queueMicrotask(() => {
          void this.flush();
        });
      }
    });
  }

  private async flush(): Promise<void> {
    const batch = [...this.pending].sort((left, right) => left.order - right.order);
    this.pending = [];
    this.flushScheduled = false;

    if (batch.length === 0) {
      return;
    }

    if (this.canRunInParallel(batch)) {
      const results = await Promise.allSettled(batch.map((request) => this.executeRequest(request)));
      results.forEach((result, index) => {
        const request = batch[index];
        if (result.status === "fulfilled") {
          request.resolve(result.value);
        } else {
          request.reject(result.reason);
        }
      });
    } else {
      for (const request of batch) {
        try {
          request.resolve(await this.executeRequest(request));
        } catch (error) {
          request.reject(error);
        }
      }
    }

    if (this.pending.length > 0 && !this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => {
        void this.flush();
      });
    }
  }

  private canRunInParallel(batch: ScheduledToolRequest[]): boolean {
    if (batch.length <= 1) {
      return false;
    }

    const seenConflictKeys = new Set<string>();
    for (const request of batch) {
      if (request.parseError) {
        return false;
      }

      if ((request.tool.executionMode ?? "serial") !== "parallel_readonly") {
        return false;
      }

      if (request.tool.needsConfirmation) {
        return false;
      }

      const key = request.tool.conflictKey?.(request.parsedArgs as never) ?? null;
      if (key && seenConflictKeys.has(key)) {
        return false;
      }
      if (key) {
        seenConflictKeys.add(key);
      }
    }

    return true;
  }

  private async executeRequest(request: ScheduledToolRequest): Promise<string | Array<Record<string, unknown>>> {
    const { llmOptions, toolResultMap, toXsaiContent } = this.options;
    const inputSignature = request.parseError
      ? createInputSignature(request.tool, request.input)
      : createInputSignature(request.tool, request.parsedArgs);

    llmOptions.emit({
      type: "tool-start",
      toolCallId: request.toolCallId,
      toolName: request.tool.name,
      input: request.input
    });

    try {
      if (request.parseError) {
        throw request.parseError;
      }

      const result = await request.tool.execute(request.parsedArgs, {
        toolCallId: request.toolCallId,
        signal: llmOptions.signal,
        onUpdate: (update) => {
          llmOptions.emit({
            type: "tool-update",
            toolCallId: request.toolCallId,
            toolName: request.tool.name,
            update
          });
        }
      });

      if (llmOptions.signal?.aborted) {
        throw llmOptions.signal.reason instanceof Error ? llmOptions.signal.reason : new DOMException("Aborted", "AbortError");
      }

      toolResultMap.set(request.toolCallId, {
        toolName: request.tool.name,
        input: request.input,
        inputSignature,
        content: result.content,
        isError: false
      });

      llmOptions.emit({
        type: "tool-end",
        toolCallId: request.toolCallId,
        toolName: request.tool.name,
        result,
        isError: false
      });

      return typeof result.content === "string" ? result.content : toXsaiContent(result.content);
    } catch (error) {
      if (llmOptions.signal?.aborted || isAbortError(error)) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      const result: ToolExecutionResult = { content: message };
      toolResultMap.set(request.toolCallId, {
        toolName: request.tool.name,
        input: request.input,
        inputSignature,
        content: message,
        isError: true
      });
      llmOptions.emit({
        type: "tool-end",
        toolCallId: request.toolCallId,
        toolName: request.tool.name,
        result,
        isError: true
      });
      return message;
    }
  }
}

export function normalizeToolInputForSignature(value: unknown): unknown {
  return normalizeValue(value);
}
