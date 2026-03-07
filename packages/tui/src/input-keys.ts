export interface DeleteAwareKey {
  backspace?: boolean;
  delete?: boolean;
  ctrl?: boolean;
}

export function isBackwardDeleteInput(input: string, key: DeleteAwareKey): boolean {
  return Boolean(key.backspace || input === "\u007f" || input === "\b" || (key.ctrl && input === "h"));
}

export function isForwardDeleteInput(input: string, key: DeleteAwareKey): boolean {
  return Boolean(key.delete || input === "\u001b[3~");
}
