import type { Terminal } from "./terminal.js";
import { padRight, visibleWidth } from "./utils.js";

export interface Component {
  render(width: number, height: number): string[];
  handleInput?(data: string): void;
  invalidate?(): void;
}

export class Container implements Component {
  readonly children: Component[] = [];

  addChild(component: Component): void {
    this.children.push(component);
  }

  clear(): void {
    this.children.length = 0;
  }

  render(width: number, height: number): string[] {
    const lines: string[] = [];
    for (const child of this.children) {
      lines.push(...child.render(width, height));
    }
    return lines;
  }

  handleInput(data: string): void {
    for (const child of this.children) {
      child.handleInput?.(data);
    }
  }
}

export class TUI extends Container {
  private focusedComponent: Component | null = null;
  private renderQueued = false;
  private running = false;

  constructor(private readonly terminal: Terminal) {
    super();
  }

  setFocus(component: Component | null): void {
    this.focusedComponent = component;
  }

  requestRender(): void {
    if (!this.running || this.renderQueued) {
      return;
    }
    this.renderQueued = true;
    setImmediate(() => {
      this.renderQueued = false;
      this.renderNow();
    });
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.terminal.start(
      (data) => {
        if (this.focusedComponent?.handleInput) {
          this.focusedComponent.handleInput(data);
        } else {
          this.handleInput(data);
        }
      },
      () => this.requestRender()
    );
    this.renderNow();
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.terminal.stop();
  }

  private renderNow(): void {
    const width = this.terminal.columns;
    const height = this.terminal.rows;
    const rendered = this.render(width, height)
      .slice(0, height)
      .map((line) => {
        const truncated = visibleWidth(line) > width ? line.slice(0, width) : line;
        return padRight(truncated, width);
      });
    while (rendered.length < height) {
      rendered.push(" ".repeat(width));
    }
    this.terminal.clearScreen();
    this.terminal.write(rendered.join("\n"));
  }
}
