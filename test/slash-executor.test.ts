import { describe, expect, it, vi } from "vitest";
import { buildSlashCommandLine, SlashCommandExecutor } from "../packages/tui/src/slash-executor.js";
import type { ParsedSlashInput, SlashCommandDefinition } from "../packages/tui/src/slash/types.js";

function createCommand(name: string): SlashCommandDefinition {
  return {
    name,
    fullName: `/${name}`,
    description: name,
    kind: "action",
    source: "builtin",
    executeMode: "direct"
  };
}

function createParsed(argsText = ""): ParsedSlashInput {
  return {
    raw: argsText ? `/x ${argsText}` : "/x",
    trimmed: argsText ? `/x ${argsText}` : "/x",
    commandToken: "/x",
    commandName: "x",
    argsText,
    hasTrailingSpace: false
  };
}

describe("SlashCommandExecutor", () => {
  it("builds canonical slash input with args and spacing", () => {
    const command = createCommand("model");

    expect(buildSlashCommandLine(command, "anthropic")).toBe("/model anthropic");
    expect(buildSlashCommandLine(command, "", true)).toBe("/model ");
  });

  it("dispatches selector commands with parsed filter", async () => {
    const actions = {
      exit: vi.fn(),
      openHelp: vi.fn(),
      openOnboarding: vi.fn(),
      openProfileSelector: vi.fn(async () => {}),
      openModelSelector: vi.fn(async () => {}),
      openSessionSelector: vi.fn(async () => {}),
      openMemorySelector: vi.fn(async () => {}),
      openTreeView: vi.fn(async () => {}),
      clearInput: vi.fn(),
      setUnknownCommand: vi.fn(),
      isRunning: vi.fn(() => false),
      setBlockedSwitchStatus: vi.fn()
    };
    const executor = new SlashCommandExecutor(actions);

    await executor.execute(createCommand("model"), createParsed("anthropic"));

    expect(actions.clearInput).toHaveBeenCalledTimes(1);
    expect(actions.openModelSelector).toHaveBeenCalledWith("anthropic");
    expect(actions.exit).not.toHaveBeenCalled();
  });

  it("dispatches memory selector commands without run blocking", async () => {
    const actions = {
      exit: vi.fn(),
      openHelp: vi.fn(),
      openOnboarding: vi.fn(),
      openProfileSelector: vi.fn(async () => {}),
      openModelSelector: vi.fn(async () => {}),
      openSessionSelector: vi.fn(async () => {}),
      openMemorySelector: vi.fn(async () => {}),
      openTreeView: vi.fn(async () => {}),
      clearInput: vi.fn(),
      setUnknownCommand: vi.fn(),
      isRunning: vi.fn(() => false),
      setBlockedSwitchStatus: vi.fn()
    };
    const executor = new SlashCommandExecutor(actions);

    await executor.execute(createCommand("memory"), createParsed("build"));

    expect(actions.openMemorySelector).toHaveBeenCalledWith("build");
    expect(actions.setBlockedSwitchStatus).not.toHaveBeenCalled();
  });

  it("dispatches direct commands and unknown fallback", async () => {
    const actions = {
      exit: vi.fn(),
      openHelp: vi.fn(),
      openOnboarding: vi.fn(),
      openProfileSelector: vi.fn(async () => {}),
      openModelSelector: vi.fn(async () => {}),
      openSessionSelector: vi.fn(async () => {}),
      openMemorySelector: vi.fn(async () => {}),
      openTreeView: vi.fn(async () => {}),
      clearInput: vi.fn(),
      setUnknownCommand: vi.fn(),
      isRunning: vi.fn(() => false),
      setBlockedSwitchStatus: vi.fn()
    };
    const executor = new SlashCommandExecutor(actions);

    await executor.execute(createCommand("help"), createParsed());
    await executor.execute(createCommand("quit"), createParsed());
    await executor.execute(createCommand("missing"), createParsed());

    expect(actions.openHelp).toHaveBeenCalledTimes(1);
    expect(actions.exit).toHaveBeenCalledTimes(1);
    expect(actions.setUnknownCommand).toHaveBeenCalledWith("/missing");
  });

  it("blocks context-switching commands while a run is active", async () => {
    const actions = {
      exit: vi.fn(),
      openHelp: vi.fn(),
      openOnboarding: vi.fn(),
      openProfileSelector: vi.fn(async () => {}),
      openModelSelector: vi.fn(async () => {}),
      openSessionSelector: vi.fn(async () => {}),
      openMemorySelector: vi.fn(async () => {}),
      openTreeView: vi.fn(async () => {}),
      clearInput: vi.fn(),
      setUnknownCommand: vi.fn(),
      isRunning: vi.fn(() => true),
      setBlockedSwitchStatus: vi.fn()
    };
    const executor = new SlashCommandExecutor(actions);

    await executor.execute(createCommand("model"), createParsed("anthropic"));

    expect(actions.setBlockedSwitchStatus).toHaveBeenCalledTimes(1);
    expect(actions.openModelSelector).not.toHaveBeenCalled();
    expect(actions.clearInput).not.toHaveBeenCalled();
  });
});
