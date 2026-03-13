import { describe, expect, it } from "vitest";
import { SelectList } from "../packages/pi-tui/src/components/select-list.js";
import { BUILTIN_SLASH_COMMANDS } from "../packages/tui/src/slash/commands.js";
import { parseSlashInput } from "../packages/tui/src/slash/parser.js";
import { SlashCommandRegistry } from "../packages/tui/src/slash/registry.js";

const theme = {
  selectedPrefix: (text: string) => text,
  selectedText: (text: string) => text,
  description: (text: string) => text,
  scrollInfo: (text: string) => text,
  noMatch: (text: string) => text
};

describe("slash parser", () => {
  it("parses slash command with args", () => {
    expect(parseSlashInput("/model anthropic"))?.toEqual({
      raw: "/model anthropic",
      trimmed: "/model anthropic",
      commandToken: "/model",
      commandName: "model",
      argsText: "anthropic",
      hasTrailingSpace: false
    });
  });

  it("returns null for non-slash input", () => {
    expect(parseSlashInput("summarize repo")).toBeNull();
  });
});

describe("slash registry", () => {
  const registry = new SlashCommandRegistry(BUILTIN_SLASH_COMMANDS);

  it("resolves aliases", () => {
    expect(registry.find("/exit")?.fullName).toBe("/quit");
    expect(registry.find("mdl")?.fullName).toBe("/model");
    expect(registry.find("login")?.fullName).toBe("/connect");
    expect(registry.find("tooldetails")?.fullName).toBe("/tools");
  });

  it("returns fuzzy-ranked matches", () => {
    const modelMatches = registry.search("mdl");
    const sessionMatches = registry.search("ses");
    const connectMatches = registry.search("conn");
    expect(modelMatches[0]?.command.fullName).toBe("/model");
    expect(sessionMatches[0]?.command.fullName).toBe("/sessions");
    expect(connectMatches[0]?.command.fullName).toBe("/connect");
  });

  it("lists builtins on empty query", () => {
    const matches = registry.search("");
    expect(matches.map((match) => match.command.fullName)).toContain("/help");
    expect(matches.map((match) => match.command.fullName)).toContain("/quit");
    expect(matches.map((match) => match.command.fullName)).toContain("/markdown");
    expect(matches.map((match) => match.command.fullName)).toContain("/thinking");
  });
});

describe("select list", () => {
  it("supports replacing items and clamping selection", () => {
    const list = new SelectList(
      [
        { value: "/help", label: "/help" },
        { value: "/model", label: "/model" }
      ],
      5,
      theme
    );
    list.setSelectedIndex(1);
    list.setItems([{ value: "/quit", label: "/quit" }]);
    expect(list.getSelectedIndex()).toBe(0);
    expect(list.getSelectedItem()?.value).toBe("/quit");
  });

  it("renders custom empty messages", () => {
    const list = new SelectList([{ value: "/help", label: "/help" }], 5, theme);
    list.setEmptyMessage("  No matching commands");
    list.setFilter("missing");
    expect(list.render(40)[0]).toContain("No matching commands");
  });
});
