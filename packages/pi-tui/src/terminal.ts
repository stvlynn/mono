export interface Terminal {
  start(onInput: (data: string) => void, onResize: () => void): void;
  stop(): void;
  write(data: string): void;
  readonly columns: number;
  readonly rows: number;
  hideCursor(): void;
  showCursor(): void;
  clearScreen(): void;
}

export class ProcessTerminal implements Terminal {
  private onInput?: (data: string) => void;
  private onResize?: () => void;
  private wasRaw = false;
  private readonly handleData = (chunk: string | Buffer) => {
    this.onInput?.(chunk.toString());
  };
  private readonly handleResize = () => {
    this.onResize?.();
  };

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.onInput = onInput;
    this.onResize = onResize;
    this.wasRaw = process.stdin.isRaw ?? false;
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    process.stdin.on("data", this.handleData);
    process.stdout.on("resize", this.handleResize);
    this.write("\u001b[?1049h\u001b[?25l");
  }

  stop(): void {
    process.stdin.off("data", this.handleData);
    process.stdout.off("resize", this.handleResize);
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(this.wasRaw);
    }
    this.write("\u001b[?25h\u001b[?1049l");
    process.stdin.pause();
  }

  write(data: string): void {
    process.stdout.write(data);
  }

  get columns(): number {
    return process.stdout.columns || 80;
  }

  get rows(): number {
    return process.stdout.rows || 24;
  }

  hideCursor(): void {
    this.write("\u001b[?25l");
  }

  showCursor(): void {
    this.write("\u001b[?25h");
  }

  clearScreen(): void {
    this.write("\u001b[2J\u001b[H");
  }
}
