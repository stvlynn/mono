import { defaultPromptRenderer, type PromptRenderer } from "@mono/prompts";
import type { MemoryDetailedTrace, MemoryRecord } from "@mono/shared";
import { extractFileHints, extractToolNames, summarizeText } from "./entities.js";

export interface CompactMemoryInput {
  userRequest: string;
  assistantOutput: string;
  trace: MemoryDetailedTrace[];
  referencedMemoryIds: string[];
}

export interface MemoryCompactorResult {
  compacted: string[];
  rawInput: string;
  rawOutput: string;
}

export interface MemoryCompactor {
  compact(input: CompactMemoryInput): Promise<MemoryCompactorResult>;
}

export class DeterministicMemoryCompactor implements MemoryCompactor {
  constructor(private readonly renderer: PromptRenderer = defaultPromptRenderer) {}

  async compact(input: CompactMemoryInput): Promise<MemoryCompactorResult> {
    const compacted: string[] = [];
    if (input.userRequest.trim()) {
      compacted.push(
        this.renderer.render("memory/compacted_step_received", {
          text: summarizeText(input.userRequest, 220)
        })
      );
    }

    for (const item of input.trace) {
      if (item.type === "tool_call") {
        compacted.push(
          this.renderer.render("memory/compacted_step_tool_call", {
            tool_name: item.toolName,
            args_text: JSON.stringify(item.args)
          })
        );
      } else if (item.type === "tool_result") {
        compacted.push(
          this.renderer.render("memory/compacted_step_tool_result", {
            tool_name: item.toolName,
            output: summarizeText(item.output, 220)
          })
        );
      } else if (item.type === "assistant" && item.text) {
        compacted.push(
          this.renderer.render("memory/compacted_step_assistant", {
            text: summarizeText(item.text, 220)
          })
        );
      }
    }

    if (input.assistantOutput.trim()) {
      compacted.push(
        this.renderer.render("memory/compacted_step_user_response", {
          text: summarizeText(input.assistantOutput, 220)
        })
      );
    }

    return {
      compacted: [...new Set(compacted)].slice(0, 12),
      rawInput: summarizeText(input.userRequest, 1000),
      rawOutput: summarizeText(input.assistantOutput, 1000)
    };
  }
}

export function buildMemoryRecordMetadata(trace: MemoryDetailedTrace[], compacted: string[], input: string, output: string): Pick<
  MemoryRecord,
  "files" | "tools" | "tags"
> {
  const values = [input, output, ...compacted];
  return {
    files: extractFileHints(values),
    tools: extractToolNames(trace),
    tags: []
  };
}
