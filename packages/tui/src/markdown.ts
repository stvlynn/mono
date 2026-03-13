import { marked } from "marked";

export type MarkdownInlineNode =
  | { type: "text"; text: string }
  | { type: "strong"; children: MarkdownInlineNode[] }
  | { type: "em"; children: MarkdownInlineNode[] }
  | { type: "del"; children: MarkdownInlineNode[] }
  | { type: "codespan"; text: string }
  | { type: "link"; href?: string; children: MarkdownInlineNode[] }
  | { type: "linebreak" };

export type MarkdownBlockNode =
  | { type: "paragraph"; children: MarkdownInlineNode[] }
  | { type: "heading"; depth: number; children: MarkdownInlineNode[] }
  | { type: "code"; text: string; lang?: string }
  | { type: "blockquote"; children: MarkdownBlockNode[] }
  | { type: "list"; ordered: boolean; items: MarkdownListItemNode[] }
  | { type: "hr" };

export interface MarkdownListItemNode {
  checked?: boolean;
  children: MarkdownBlockNode[];
}

type MarkedToken = ReturnType<typeof marked.lexer>[number];

function getChildTokens(token: { tokens?: unknown }): MarkedToken[] {
  return Array.isArray(token.tokens) ? token.tokens as MarkedToken[] : [];
}

function parseInlineTokens(tokens: MarkedToken[]): MarkdownInlineNode[] {
  const nodes: MarkdownInlineNode[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "text":
      case "escape":
        if (typeof token.text === "string" && token.text) {
          nodes.push({ type: "text", text: token.text });
        }
        break;
      case "strong":
        nodes.push({ type: "strong", children: parseInlineTokens(getChildTokens(token)) });
        break;
      case "em":
        nodes.push({ type: "em", children: parseInlineTokens(getChildTokens(token)) });
        break;
      case "del":
        nodes.push({ type: "del", children: parseInlineTokens(getChildTokens(token)) });
        break;
      case "codespan":
        nodes.push({ type: "codespan", text: token.text });
        break;
      case "br":
        nodes.push({ type: "linebreak" });
        break;
      case "link":
        nodes.push({
          type: "link",
          href: token.href,
          children: parseInlineTokens(getChildTokens(token))
        });
        break;
      case "image":
        nodes.push({
          type: "text",
          text: token.text ? `[image: ${token.text}]` : "[image]"
        });
        break;
      case "html":
        if (typeof token.raw === "string" && token.raw.trim()) {
          nodes.push({ type: "text", text: token.raw });
        }
        break;
      default:
        if (typeof token.raw === "string" && token.raw) {
          nodes.push({ type: "text", text: token.raw });
        }
        break;
    }
  }

  return nodes;
}

function paragraphFromRaw(token: MarkedToken): MarkdownBlockNode | undefined {
  const raw = typeof token.raw === "string" ? token.raw.trim() : "";
  if (!raw) {
    return undefined;
  }
  return {
    type: "paragraph",
    children: [{ type: "text", text: raw }]
  };
}

function parseListItems(token: unknown): MarkdownListItemNode[] {
  const items = token && typeof token === "object" && Array.isArray((token as { items?: unknown }).items)
    ? (token as { items: Array<Record<string, unknown>> }).items
    : [];
  return items.map((item) => {
    const children = parseBlockTokens(Array.isArray(item.tokens) ? item.tokens as MarkedToken[] : []);
    return {
      checked: typeof item.checked === "boolean" ? item.checked : undefined,
      children: children.length > 0
        ? children
        : [{
            type: "paragraph",
            children: typeof item.text === "string" && item.text
              ? [{ type: "text", text: item.text }]
              : []
          }]
    };
  });
}

function parseBlockTokens(tokens: MarkedToken[]): MarkdownBlockNode[] {
  const blocks: MarkdownBlockNode[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "space":
        break;
      case "paragraph":
        blocks.push({
          type: "paragraph",
          children: parseInlineTokens(getChildTokens(token))
        });
        break;
      case "heading":
        blocks.push({
          type: "heading",
          depth: token.depth,
          children: parseInlineTokens(getChildTokens(token))
        });
        break;
      case "code":
        blocks.push({
          type: "code",
          text: token.text,
          lang: token.lang || undefined
        });
        break;
      case "blockquote":
        blocks.push({
          type: "blockquote",
          children: parseBlockTokens(getChildTokens(token))
        });
        break;
      case "list":
        blocks.push({
          type: "list",
          ordered: Boolean(token.ordered),
          items: parseListItems(token)
        });
        break;
      case "hr":
        blocks.push({ type: "hr" });
        break;
      case "text": {
        const childTokens = getChildTokens(token);
        if (childTokens.length > 0) {
          blocks.push(...parseBlockTokens(childTokens));
          break;
        }

        const paragraph = paragraphFromRaw(token);
        if (paragraph) {
          blocks.push(paragraph);
        }
        break;
      }
      default: {
        const paragraph = paragraphFromRaw(token);
        if (paragraph) {
          blocks.push(paragraph);
        }
        break;
      }
    }
  }

  return blocks;
}

export function parseMarkdownToBlocks(markdown: string): MarkdownBlockNode[] {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return [];
  }

  try {
    return parseBlockTokens(marked.lexer(trimmed, {
      gfm: true,
      breaks: false
    }));
  } catch {
    return [
      {
        type: "paragraph",
        children: [{ type: "text", text: trimmed }]
      }
    ];
  }
}
