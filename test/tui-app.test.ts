import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("tui app bootstrap", () => {
  it("disables Ink's default Ctrl+C exit handling", async () => {
    const source = readFileSync("packages/tui/src/app.tsx", "utf8");

    expect(source).toContain("exitOnCtrlC: false");
  });

  it("wraps the app in a TUI error boundary", () => {
    const source = readFileSync("packages/tui/src/AppContainer.tsx", "utf8");

    expect(source).toContain("TuiErrorBoundary");
    expect(source).toContain("reportFatalError");
    expect(source).toContain("FatalScreen");
  });

  it("keeps initialization out of useAgentBridge", () => {
    const source = readFileSync("packages/tui/src/hooks/useAgentBridge.ts", "utf8");

    expect(source).not.toContain("agent.initialize()");
  });

  it("uses a single app-level raw keypress listener with foreground registration", () => {
    const appContainer = readFileSync("packages/tui/src/AppContainer.tsx", "utf8");
    const inputPrompt = readFileSync("packages/tui/src/components/InputPrompt.tsx", "utf8");
    const listDialog = readFileSync("packages/tui/src/components/ListDialog.tsx", "utf8");
    const approvalDialog = readFileSync("packages/tui/src/components/ApprovalDialog.tsx", "utf8");

    expect(appContainer).toContain("ForegroundKeypressContext");
    expect(appContainer).toContain("useRawKeypress(dispatchForegroundKeypress");
    expect(inputPrompt).toContain("useForegroundKeypress(");
    expect(inputPrompt).not.toContain("useRawKeypress(");
    expect(listDialog).toContain("useForegroundKeypress(");
    expect(listDialog).not.toContain("useRawKeypress(");
    expect(approvalDialog).toContain("useForegroundKeypress(");
    expect(approvalDialog).not.toContain("useRawKeypress(");
  });

  it("routes /model through configured profiles and exposes /connect", () => {
    const appContainer = readFileSync("packages/tui/src/AppContainer.tsx", "utf8");
    const slashCommands = readFileSync("packages/tui/src/slash/commands.ts", "utf8");
    const slashHook = readFileSync("packages/tui/src/hooks/useSlashCommands.ts", "utf8");

    expect(appContainer).toContain("agent.listConfiguredProfiles()");
    expect(appContainer).toContain("Use /connect to add one.");
    expect(slashCommands).toContain('fullName: "/connect"');
    expect(slashHook).toContain('case "connect"');
    expect(slashCommands).toContain('fullName: "/skills"');
    expect(slashHook).toContain('case "skills"');
    expect(appContainer).toContain("loadAvailableSkills(process.cwd())");
    expect(slashCommands).toContain('fullName: "/context"');
    expect(slashHook).toContain('case "context"');
    expect(appContainer).toContain("agent.inspectContext(");
  });

  it("uses config summary rather than synthesized builtin profiles to choose the first connected default", () => {
    const appContainer = readFileSync("packages/tui/src/AppContainer.tsx", "utf8");

    expect(appContainer).toContain("shouldSetConnectedProfileAsDefault(configSummary.hasAnyProfiles)");
    expect(appContainer).not.toContain("setDefault: configuredProfiles.length === 0");
  });

  it("persists the selected profile back into project config", () => {
    const appContainer = readFileSync("packages/tui/src/AppContainer.tsx", "utf8");

    expect(appContainer).toContain("persistProjectProfileSelection");
    expect(appContainer).toContain("if (!agent.hasModelSelectionOverride())");
    expect(appContainer).toContain("await persistProjectProfileSelection(resolved.profileName, process.cwd())");
  });

  it("keeps runtime request errors out of the fatal path", () => {
    const source = readFileSync("packages/tui/src/AppContainer.tsx", "utf8");

    expect(source).toContain("isRecoverableRuntimeError");
    expect(source).toContain('reportUiError(reason, "Unhandled runtime error")');
    expect(source).toContain('reportUiError(error, "Uncaught runtime error")');
  });
});
