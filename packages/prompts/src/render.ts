import nunjucks, { Environment } from "nunjucks";
import { FileTemplateRegistry, TEMPLATE_FILES, getTemplatesRoot } from "./registry.js";
import type { PromptRenderOptions, PromptRenderer, PromptTemplateId } from "./types.js";

export class NunjucksPromptRenderer implements PromptRenderer {
  private readonly registry = new FileTemplateRegistry();
  private readonly env: Environment;

  constructor(options: PromptRenderOptions = {}) {
    this.env = nunjucks.configure(getTemplatesRoot(), {
      autoescape: false,
      trimBlocks: options.trimBlocks ?? true,
      lstripBlocks: options.lstripBlocks ?? true,
      throwOnUndefined: options.throwOnUndefined ?? true,
      noCache: true
    });
  }

  render(templateId: PromptTemplateId, context: Record<string, unknown> = {}): string {
    const path = this.registry.getPath(templateId);
    if (!this.registry.exists(templateId)) {
      throw new Error(`Prompt template file not found: ${path}`);
    }
    return this.env.render(TEMPLATE_FILES[templateId], context).trim();
  }
}

export const defaultPromptRenderer = new NunjucksPromptRenderer();
