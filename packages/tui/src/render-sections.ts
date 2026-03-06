import { padRight, wrapText } from "@mono/pi-tui";
import type { ConversationMessage } from "@mono/shared";
import { ansi, formatMessage } from "./ui-format.js";
import type { ModalState, ToolRun } from "./ui-types.js";

interface ConversationSectionOptions {
  messages: ConversationMessage[];
  streamingText: string;
  streamingThinking: string;
  width: number;
}

interface EditorSectionOptions {
  inputValue: string;
  cursor: number;
  slashPaletteVisible: boolean;
  slashPaletteLines: string[];
  width: number;
}

export function renderConversationSection(options: ConversationSectionOptions): string[] {
  const bodyWidth = Math.max(1, options.width - 2);
  const lines: string[] = [];
  const recentMessages = options.messages.slice(-8);

  if (recentMessages.length === 0) {
    lines.push(ansi.dim("No messages yet."));
  }

  for (const message of recentMessages) {
    for (const line of wrapText(formatMessage(message), bodyWidth)) {
      lines.push(`  ${line}`);
    }
  }

  if (options.streamingThinking) {
    for (const line of wrapText(`[thinking] ${options.streamingThinking}`, bodyWidth)) {
      lines.push(`  ${ansi.dim(line)}`);
    }
  }

  if (options.streamingText) {
    for (const line of wrapText(options.streamingText, bodyWidth)) {
      lines.push(`  ${ansi.green(line)}`);
    }
  }

  return lines.slice(-12);
}

export function renderToolsSection(toolRuns: ToolRun[], width: number): string[] {
  const bodyWidth = Math.max(1, width - 2);
  if (toolRuns.length === 0) {
    return [padRight(ansi.dim("  No tool activity."), width)];
  }

  const lines: string[] = [];
  for (const tool of toolRuns.slice(0, 4)) {
    const statusColor = tool.status === "error" ? ansi.red : tool.status === "done" ? ansi.green : ansi.yellow;
    const summary = `${statusColor(`[${tool.status}]`)} ${tool.name}: ${tool.output}`;
    for (const line of wrapText(summary, bodyWidth)) {
      lines.push(`  ${line}`);
    }
  }

  return lines;
}

export function renderEditorSection(options: EditorSectionOptions): string[] {
  const bodyWidth = Math.max(1, options.width - 2);
  const promptPrefix = "> ";
  const before = options.inputValue.slice(0, options.cursor);
  const current = options.inputValue[options.cursor] ?? " ";
  const after = options.inputValue.slice(options.cursor + (options.cursor < options.inputValue.length ? 1 : 0));
  const editorText = `${promptPrefix}${before}${ansi.inverse(current)}${after}`;
  const lines = wrapText(editorText, bodyWidth).map((line) => `  ${line}`);
  lines.push(`  ${ansi.dim("/help /profile /model /auth /sessions /tree /quit | Ctrl+J newline | Ctrl+L profiles | Ctrl+R sessions")}`);

  if (options.slashPaletteVisible) {
    lines.push(`  ${ansi.dim("Commands")}`);
    lines.push(...options.slashPaletteLines.map((line) => `  ${line}`));
  }

  return lines;
}

export function renderModal(modal: ModalState, width: number): string[] {
  if (modal.type === "help") {
    return [
      padRight(ansi.bold("Help"), width),
      padRight("  /help      Show this help", width),
      padRight("  /profile   Open profile selector", width),
      padRight("  /model     Open model selector", width),
      padRight("  /auth      Show auth setup hint", width),
      padRight("  /sessions  Open session selector", width),
      padRight("  /tree      Open session tree", width),
      padRight("  /quit      Exit mono", width),
      padRight(ansi.dim("  Enter/Esc close"), width)
    ];
  }

  if (modal.type === "onboarding") {
    return [
      padRight(ansi.bold(ansi.yellow("No configured profiles found")), width),
      padRight("  Run `mono auth login` to create a profile in ~/.mono/config.json.", width),
      padRight("  Environment variables like MONO_API_KEY and OPENAI_API_KEY still work.", width),
      padRight(ansi.dim("  Enter/Esc close"), width)
    ];
  }

  if (modal.type === "approval") {
    return [
      padRight(ansi.bold(ansi.yellow(`Approve ${modal.request.toolName}?`)), width),
      ...wrapText(modal.request.reason, Math.max(1, width - 2)).map((line) => padRight(`  ${line}`, width)),
      ...wrapText(JSON.stringify(modal.request.input, null, 2), Math.max(1, width - 2)).map((line) =>
        padRight(`  ${ansi.dim(line)}`, width)
      ),
      padRight(ansi.dim("  y approve, n deny"), width)
    ];
  }

  if (modal.type === "select") {
    return [
      padRight(ansi.bold(modal.title), width),
      ...modal.list.render(width),
      padRight(ansi.dim(`  ${modal.hint}`), width)
    ];
  }

  return [];
}
