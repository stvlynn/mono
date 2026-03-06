import { Text } from "ink";

export function LoadingIndicator({ label = "Thinking..." }: { label?: string }) {
  return (
    <Text color="cyan">
      {label}
    </Text>
  );
}
