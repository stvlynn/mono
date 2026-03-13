import { Marked, type MarkedExtension, type Tokens } from "marked";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const telegramRenderer: MarkedExtension = {
  renderer: {
    heading({ tokens }: Tokens.Heading): string {
      const text = this.parser.parseInline(tokens);
      return `\n<b>${text}</b>\n\n`;
    },
    paragraph({ tokens }: Tokens.Paragraph): string {
      return `${this.parser.parseInline(tokens)}\n\n`;
    },
    strong({ tokens }: Tokens.Strong): string {
      return `<b>${this.parser.parseInline(tokens)}</b>`;
    },
    em({ tokens }: Tokens.Em): string {
      return `<i>${this.parser.parseInline(tokens)}</i>`;
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
      return `<s>${this.parser.parseInline(tokens)}</s>`;
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
    hr(): string {
      return "\n---\n\n";
    },
    br(): string {
      return "\n";
    },
    image({ title, href, text }: Tokens.Image): string {
      return title ? `[${text} - ${title}](${href})` : `[${text}](${href})`;
    },
    text(token: Tokens.Text | Tokens.Escape | Tokens.Tag): string {
      if ("tokens" in token && token.tokens) {
        return this.parser.parseInline(token.tokens);
      }
      return escapeHtml(token.text);
    },
    html(token: Tokens.HTML | Tokens.Tag): string {
      return token.text;
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
