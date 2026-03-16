import { Marked, type MarkedExtension, type RendererThis, type Token, type Tokens } from "marked";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const TELEGRAM_HTML_TAG_RE = /<\/?[^>]+>/g;
const TELEGRAM_NUMERIC_ENTITY_RE = /&#(?:x([0-9a-f]+)|([0-9]+));/gi;

const telegramRenderer: MarkedExtension = {
  renderer: {
    heading({ tokens }: Tokens.Heading): string {
      const text = this.parser.parseInline(tokens);
      return containsCodeEntity(tokens) ? `\n${text}\n\n` : `\n<b>${text}</b>\n\n`;
    },
    paragraph({ tokens }: Tokens.Paragraph): string {
      return `${this.parser.parseInline(tokens)}\n\n`;
    },
    strong({ tokens }: Tokens.Strong): string {
      const text = this.parser.parseInline(tokens);
      return containsCodeEntity(tokens) ? text : `<b>${text}</b>`;
    },
    em({ tokens }: Tokens.Em): string {
      const text = this.parser.parseInline(tokens);
      return containsCodeEntity(tokens) ? text : `<i>${text}</i>`;
    },
    codespan({ text }: Tokens.Codespan): string {
      return `<code>${escapeHtml(text)}</code>`;
    },
    code({ text, lang }: Tokens.Code): string {
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      return `<pre><code${cls}>${escapeHtml(text)}</code></pre>\n\n`;
    },
    blockquote({ tokens }: Tokens.Blockquote): string {
      const body = this.parser.parse(tokens).trim();
      return `<blockquote>${body}</blockquote>\n\n`;
    },
    link({ tokens, href }: Tokens.Link): string {
      const text = this.parser.parseInline(tokens);
      return `<a href="${escapeHtml(href)}">${text}</a>`;
    },
    del({ tokens }: Tokens.Del): string {
      const text = this.parser.parseInline(tokens);
      return containsCodeEntity(tokens) ? text : `<s>${text}</s>`;
    },
    list({ items, ordered }: Tokens.List): string {
      const lines = items.map((item: Tokens.ListItem, index: number) => {
        const prefix = ordered ? `${index + 1}. ` : "• ";
        const content = this.parser.parse(item.tokens).trim();
        return `${prefix}${content}`;
      });
      return `${lines.join("\n")}\n\n`;
    },
    listitem({ tokens }: Tokens.ListItem): string {
      return this.parser.parse(tokens).trim();
    },
    checkbox({ checked }: Tokens.Checkbox): string {
      return checked ? "[x] " : "[ ] ";
    },
    table(token: Tokens.Table): string {
      return renderTelegramTable(this, token);
    },
    hr(): string {
      return "\n---\n\n";
    },
    br(): string {
      return "\n";
    },
    image({ title, href, tokens }: Tokens.Image): string {
      const label = [renderPlainInlineText(this, tokens), title?.trim()]
        .filter((value): value is string => Boolean(value))
        .join(" - ");
      const linkText = label || href;
      return `<a href="${escapeHtml(href)}">${escapeHtml(linkText)}</a>`;
    },
    text(token: Tokens.Text | Tokens.Escape | Tokens.Tag): string {
      if ("tokens" in token && token.tokens) {
        return this.parser.parseInline(token.tokens);
      }
      return escapeHtml(token.text);
    },
    html(token: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(token.text);
    },
    space(): string {
      return "";
    },
  },
};

const marked = new Marked(telegramRenderer);

export function markdownToTelegramHtml(markdown: string): string {
  const result = marked.parse(markdown) as string;
  return result.trim();
}

export function countTelegramHtmlTextLength(text: string): number {
  const withoutTags = text.replace(TELEGRAM_HTML_TAG_RE, "");
  const decodedEntities = withoutTags
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(TELEGRAM_NUMERIC_ENTITY_RE, (_match, hex, decimal) => {
      const radix = hex ? 16 : 10;
      const value = Number.parseInt((hex ?? decimal) as string, radix);
      if (!Number.isFinite(value) || value < 0) {
        return "";
      }
      try {
        return String.fromCodePoint(value);
      } catch {
        return "";
      }
    });
  return decodedEntities.length;
}

function containsCodeEntity(tokens: Token[]): boolean {
  return tokens.some((token) => {
    if (token.type === "codespan" || token.type === "code") {
      return true;
    }
    if ("tokens" in token && Array.isArray(token.tokens)) {
      return containsCodeEntity(token.tokens);
    }
    return false;
  });
}

function renderPlainInlineText(renderer: RendererThis, tokens: Token[]): string {
  return renderer.parser.parseInline(tokens, renderer.parser.textRenderer)
    .replace(/\s+/g, " ")
    .trim();
}

function renderTelegramTable(renderer: RendererThis, token: Tokens.Table): string {
  const rows = [
    token.header.map((cell) => renderPlainInlineText(renderer, cell.tokens)),
    ...token.rows.map((row) => row.map((cell) => renderPlainInlineText(renderer, cell.tokens))),
  ];

  if (rows.length === 0 || rows[0]?.length === 0) {
    return "";
  }

  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const normalizedRows = rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? "")
  );
  const widths = Array.from({ length: columnCount }, (_, index) =>
    normalizedRows.reduce((max, row) => Math.max(max, row[index]?.length ?? 0), 3)
  );
  const separator = widths.map((width) => "-".repeat(width));
  const lines = [
    renderTableRow(normalizedRows[0]!, widths),
    renderTableRow(separator, widths),
    ...normalizedRows.slice(1).map((row) => renderTableRow(row, widths)),
  ];

  return `<pre><code>${escapeHtml(lines.join("\n"))}</code></pre>\n\n`;
}

function renderTableRow(row: string[], widths: number[]): string {
  const padded = row.map((cell, index) => cell.padEnd(widths[index] ?? 0));
  return `| ${padded.join(" | ")} |`;
}
