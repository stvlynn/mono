import { describe, expect, it } from "vitest";
import { createDeterministicTuiSpec, decorateTuiSpec, summarizeTuiSpecLayout } from "../packages/tui/src/tui-render-spec.js";
import { hasMinimumTuiSurface } from "../packages/tui/src/tui-render-runtime.js";

describe("generative tui runtime", () => {
  it("builds a deterministic fallback spec with json-render interactive elements", () => {
    const spec = createDeterministicTuiSpec();

    expect(spec.root).toBe("pane-root");
    expect(spec.elements["pane-root"]?.children).toContain("history-list");
    expect(spec.elements["pane-root"]?.children).toContain("pending-assistant-section");
    expect(spec.elements["history-body"]?.type).toBe("Markdown");
    expect(spec.elements["pending-tools-item"]?.type).toBe("ListItem");
  });

  it("adds a render status element without replacing the current layout", () => {
    const base = createDeterministicTuiSpec();
    const decorated = decorateTuiSpec(base, {
      kind: "error",
      message: "UI render degraded",
    });

    expect(base.elements["render-status"]).toBeUndefined();
    expect(decorated.elements["render-status"]?.type).toBe("StatusLine");
    expect(decorated.elements["pane-root"]?.children?.at(-1)).toBe("render-status");
    expect(summarizeTuiSpecLayout(decorated)).toContain("render-status");
  });

  it("requires both content and interaction regions for a generated spec", () => {
    const valid = createDeterministicTuiSpec();
    const invalid = {
      root: "only-text",
      elements: {
        "only-text": {
          type: "Text",
          props: { text: "hello" },
          children: [],
        },
      },
    };

    expect(hasMinimumTuiSurface(valid)).toBe(true);
    expect(hasMinimumTuiSurface(invalid)).toBe(false);
  });
});
