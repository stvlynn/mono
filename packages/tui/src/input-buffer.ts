export class InputBuffer {
  private textValue = "";
  private cursorPosition = 0;
  private history: string[] = [];
  private historyIndex: number | null = null;

  get text(): string {
    return this.textValue;
  }

  get cursor(): number {
    return this.cursorPosition;
  }

  get hasText(): boolean {
    return this.textValue.length > 0;
  }

  setText(value: string): void {
    this.textValue = value;
    this.cursorPosition = value.length;
  }

  clear(): void {
    this.textValue = "";
    this.cursorPosition = 0;
    this.historyIndex = null;
  }

  insert(text: string): void {
    this.textValue = `${this.textValue.slice(0, this.cursorPosition)}${text}${this.textValue.slice(this.cursorPosition)}`;
    this.cursorPosition += text.length;
  }

  replace(text: string): void {
    this.textValue = text;
    this.cursorPosition = text.length;
  }

  moveLeft(): boolean {
    if (this.cursorPosition === 0) {
      return false;
    }
    this.cursorPosition -= 1;
    return true;
  }

  moveRight(): boolean {
    if (this.cursorPosition === this.textValue.length) {
      return false;
    }
    this.cursorPosition += 1;
    return true;
  }

  moveHome(): boolean {
    if (this.cursorPosition === 0) {
      return false;
    }
    this.cursorPosition = 0;
    return true;
  }

  moveEnd(): boolean {
    if (this.cursorPosition === this.textValue.length) {
      return false;
    }
    this.cursorPosition = this.textValue.length;
    return true;
  }

  deleteBackward(): boolean {
    if (this.cursorPosition === 0) {
      return false;
    }

    this.textValue = `${this.textValue.slice(0, this.cursorPosition - 1)}${this.textValue.slice(this.cursorPosition)}`;
    this.cursorPosition -= 1;
    return true;
  }

  deleteForward(): boolean {
    if (this.cursorPosition >= this.textValue.length) {
      return false;
    }

    this.textValue = `${this.textValue.slice(0, this.cursorPosition)}${this.textValue.slice(this.cursorPosition + 1)}`;
    return true;
  }

  recordHistory(prompt: string, maxEntries = 50): void {
    this.history.unshift(prompt);
    if (this.history.length > maxEntries) {
      this.history.pop();
    }
    this.historyIndex = null;
  }

  navigateHistory(direction: "up" | "down"): string | null {
    if (this.history.length === 0) {
      return null;
    }

    if (direction === "up") {
      const nextIndex = this.historyIndex === null ? 0 : Math.min(this.history.length - 1, this.historyIndex + 1);
      this.historyIndex = nextIndex;
      return this.history[nextIndex] ?? "";
    }

    if (this.historyIndex === null) {
      return null;
    }

    const nextIndex = this.historyIndex - 1;
    if (nextIndex < 0) {
      this.historyIndex = null;
      return "";
    }

    this.historyIndex = nextIndex;
    return this.history[nextIndex] ?? "";
  }
}
