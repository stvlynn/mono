declare module "nunjucks" {
  export interface ConfigureOptions {
    autoescape?: boolean;
    trimBlocks?: boolean;
    lstripBlocks?: boolean;
    throwOnUndefined?: boolean;
    noCache?: boolean;
  }

  export class Environment {
    render(name: string, context?: Record<string, unknown>): string;
  }

  export function configure(path: string, options?: ConfigureOptions): Environment;

  const nunjucks: {
    configure: typeof configure;
    Environment: typeof Environment;
  };

  export default nunjucks;
}
