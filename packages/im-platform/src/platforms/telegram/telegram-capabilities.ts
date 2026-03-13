import { UnsupportedCapabilityError, UnsupportedContentError, UnsupportedTargetError } from "../../errors.js";
import type { DispatchContent, DispatchTarget } from "../../types.js";

export function isSupportedTelegramTarget(target: DispatchTarget): boolean {
  if (target.kind !== "channel" && target.kind !== "dm") {
    return false;
  }
  if (target.kind === "channel" && target.topicId !== undefined) {
    return false;
  }
  return true;
}

export function isSupportedTelegramContent(content: DispatchContent): boolean {
  if (content.type !== "media-group") {
    return true;
  }
  if (content.items.length < 2 || content.items.length > 10) {
    return false;
  }
  const hasDocument = content.items.some((item) => item.type === "document");
  const hasNonDocument = content.items.some((item) => item.type !== "document");
  return !(hasDocument && hasNonDocument);
}

export function assertSupportedTelegramTarget(
  providerId: string,
  platform: string,
  target: DispatchTarget,
): void {
  if (!isSupportedTelegramTarget(target)) {
    if (target.kind === "channel" && target.topicId !== undefined) {
      throw new UnsupportedTargetError(
        providerId,
        platform,
        'Telegram channel targets do not support "topicId"',
      );
    }
    throw new UnsupportedTargetError(providerId, platform, `Unsupported Telegram target kind: ${target.kind}`);
  }
}

export function assertSupportedTelegramContent(
  providerId: string,
  platform: string,
  content: DispatchContent,
): void {
  if (!isSupportedTelegramContent(content)) {
    if (content.type === "media-group" && (content.items.length < 2 || content.items.length > 10)) {
      throw new UnsupportedContentError(providerId, platform, "Telegram media groups require 2-10 items");
    }
    throw new UnsupportedContentError(
      providerId,
      platform,
      "Telegram media groups cannot mix document items with photo/video items",
    );
  }
}

export function assertImmediateDelivery(
  providerId: string,
  platform: string,
  deliveryMode: "immediate" | "native-draft" | undefined,
): void {
  if (deliveryMode === "native-draft") {
    throw new UnsupportedCapabilityError(providerId, platform, "native-draft");
  }
}
