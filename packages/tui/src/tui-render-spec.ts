import type { Spec } from "@json-render/core";

export interface TuiRenderOverlayState {
  kind: "idle" | "loading" | "error";
  message?: string;
}

export function createDeterministicTuiSpec(): Spec {
  return {
    root: "pane-root",
    elements: {
      "pane-root": {
        type: "Box",
        props: {
          flexDirection: "column",
          gap: 1,
        },
        children: [
          "pane-hint",
          "query-status",
          "history-empty",
          "history-list",
          "pending-tools-section",
          "pending-assistant-section",
        ],
      },
      "pane-hint": {
        type: "Text",
        props: {
          text: { "$state": "/pane/hint" },
          dimColor: true,
        },
        children: [],
      },
      "query-status": {
        type: "StatusLine",
        props: {
          text: { "$state": "/query/status" },
          status: {
            "$cond": { "$state": "/query/running" },
            "$then": "info",
            "$else": "success",
          },
        },
        children: [],
      },
      "history-empty": {
        type: "Text",
        props: {
          text: "No output yet.",
          dimColor: true,
        },
        visible: { "$state": "/history/hasItems", not: true },
        children: [],
      },
      "history-list": {
        type: "Box",
        props: {
          flexDirection: "column",
          gap: 1,
        },
        visible: { "$state": "/history/hasItems" },
        repeat: {
          statePath: "/history/items",
          key: "id",
        },
        children: ["history-card"],
      },
      "history-card": {
        type: "Card",
        props: {
          title: { "$item": "title" },
          padding: 1,
        },
        children: ["history-body", "history-thinking", "history-detail"],
      },
      "history-body": {
        type: "Markdown",
        props: {
          text: { "$item": "body" },
        },
        children: [],
      },
      "history-thinking": {
        type: "Text",
        props: {
          text: { "$item": "thinking" },
          dimColor: true,
        },
        visible: { "$item": "thinking" },
        children: [],
      },
      "history-detail": {
        type: "Text",
        props: {
          text: { "$item": "detail" },
          dimColor: true,
        },
        visible: { "$item": "detail" },
        children: [],
      },
      "pending-tools-section": {
        type: "Box",
        props: {
          flexDirection: "column",
          gap: 1,
        },
        visible: { "$state": "/pendingTools/active" },
        children: ["pending-tools-title", "pending-tools-list"],
      },
      "pending-tools-title": {
        type: "Heading",
        props: {
          text: "Pending Tools",
          level: "h3",
          color: "yellow",
        },
        children: [],
      },
      "pending-tools-list": {
        type: "Box",
        props: {
          flexDirection: "column",
          gap: 1,
        },
        repeat: { statePath: "/pendingTools/items", key: "id" },
        children: ["pending-tools-item"],
      },
      "pending-tools-item": {
        type: "ListItem",
        props: {
          title: { "$template": "${$item.name} · ${$item.status}" },
          subtitle: { "$item": "summary" },
          trailing: { "$item": "detail" },
        },
        children: [],
      },
      "pending-assistant-section": {
        type: "Box",
        props: {
          flexDirection: "column",
          gap: 1,
        },
        visible: { "$state": "/pendingAssistant/active" },
        children: ["pending-assistant-title", "pending-assistant-text", "pending-assistant-thinking"],
      },
      "pending-assistant-title": {
        type: "Heading",
        props: {
          text: "Assistant",
          level: "h3",
          color: "cyan",
        },
        children: [],
      },
      "pending-assistant-text": {
        type: "Markdown",
        props: {
          text: { "$state": "/pendingAssistant/text" },
        },
        children: [],
      },
      "pending-assistant-thinking": {
        type: "Text",
        props: {
          text: { "$state": "/pendingAssistant/thinking" },
          dimColor: true,
        },
        visible: [
          { "$state": "/pendingAssistant/showThinking" },
          { "$state": "/pendingAssistant/thinking" },
        ],
        children: [],
      },
    },
  };
}

function cloneSpec(spec: Spec): Spec {
  return structuredClone(spec);
}

export function decorateTuiSpec(spec: Spec, overlay: TuiRenderOverlayState): Spec {
  const next = cloneSpec(spec);
  if (!next.elements[next.root]) {
    return next;
  }

  if (overlay.kind === "idle" || !overlay.message) {
    delete next.elements["render-status"];
    const root = next.elements[next.root]!;
    root.children = (root.children ?? []).filter((child) => child !== "render-status");
    return next;
  }

  next.elements["render-status"] = {
    type: "StatusLine",
    props: {
      text: overlay.message,
      status: overlay.kind === "error" ? "error" : "warning",
    },
    children: [],
  };
  const root = next.elements[next.root]!;
  root.children = [...(root.children ?? []).filter((child) => child !== "render-status"), "render-status"];
  return next;
}

export function summarizeTuiSpecLayout(spec: Spec): string {
  const root = spec.elements[spec.root];
  if (!root?.children?.length) {
    return "empty";
  }
  return root.children.join(" > ");
}
