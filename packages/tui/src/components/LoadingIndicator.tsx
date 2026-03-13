import { Text } from "ink";

export function LoadingIndicator({ label }: { label?: string }) {
  return (
    <Text color="cyan">
      {label?.trim() || "…"}
    </Text>
  );
}
