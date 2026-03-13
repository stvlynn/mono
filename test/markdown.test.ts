import { describe, expect, it } from "vitest";
import { parseMarkdownToBlocks } from "../packages/tui/src/markdown.js";

describe("tui markdown parsing", () => {
  it("parses headings, paragraphs, lists, and fenced code blocks", () => {
    const blocks = parseMarkdownToBlocks(`# Title

Paragraph with **bold** text.

- first
- second

\`\`\`ts
console.log("hi");
\`\`\`
`);

    expect(blocks.map((block) => block.type)).toEqual(["heading", "paragraph", "list", "code"]);
    expect(blocks[0]).toMatchObject({ type: "heading", depth: 1 });
    expect(blocks[2]).toMatchObject({ type: "list", ordered: false });
    expect(blocks[3]).toMatchObject({ type: "code", lang: "ts" });
  });

  it("falls back safely for incomplete streaming markdown", () => {
    const blocks = parseMarkdownToBlocks("## Partial\n\n```ts\nconst value = 1");

    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]?.type).toBe("heading");
  });
});
