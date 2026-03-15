# IM Platform Overview

## Purpose

This document describes the current `@mono/im-platform` implementation.

The package provides a provider-agnostic IM layer for outbound dispatch and inbound message normalization. Callers submit a generic dispatch request plus a provider alias, while each platform-specific implementation stays inside the package boundary.

Today the package ships one built-in provider:

- Telegram

The package shape is intentionally multi-provider even though the runtime surface is still v1 and Telegram-only.

## Audience

- maintainers working on the IM dispatch subsystem
- engineers integrating outbound delivery into other packages
- future contributors adding a second provider without changing the public request shape

## Current Position

`@mono/im-platform` is a standalone workspace package under `packages/im-platform`.

It currently owns:

- provider registration and lookup
- the generic dispatch request and result model
- the generic inbound message model used by platform-native inputs
- the generic inbound action model used by platform-native button callbacks
- normalization of provider results into a stable package-level contract
- one built-in Telegram provider
- Telegram-specific validation, request mapping, formatting, and HTTP transport
- Telegram-specific inbound update normalization for image-bearing messages and callback actions

It does not currently own:

- inbound webhook server orchestration
- queueing or retry policy
- durable dispatch jobs
- provider failover or multi-provider routing policy
- Telegram MTProto or client-side draft behavior

The package is rooted at `packages/im-platform/src/index.ts`. `packages/im-platform/package.json` only exports the package root, which keeps external callers on the generic package surface instead of deep-importing provider internals.

## Package Surface

The public surface is intentionally small and generic.

Main exports:

- request and result types from `packages/im-platform/src/types.ts`
- inbound message helpers from `packages/im-platform/src/types.ts`
- package error types from `packages/im-platform/src/errors.ts`
- registry helpers from `packages/im-platform/src/registry.ts`
- distributor creation from `packages/im-platform/src/distributor.ts`
- built-in provider creation from `packages/im-platform/src/built-in.ts`

The core contracts are:

- `DispatchRequest`
- `DispatchResult`
- `InboundMessage`
- `InboundAction`
- `ImPlatformProvider`
- `PlatformRegistry`
- `createDistributor()`

### Public request model

`DispatchRequest` is the canonical input shape:

```ts
interface DispatchRequest {
  provider: string;
  target: DispatchTarget;
  content: DispatchContent;
  options?: DispatchOptions;
}
```

Important design choices:

- `provider` is a caller-chosen alias, not a class import
- `target` uses generic kinds instead of Telegram-specific chat types
- `content` is modeled as platform-neutral variants
- `options` captures cross-provider intent, not Telegram-only switches

### Public result model

`DispatchResult` normalizes provider output:

```ts
interface DispatchResult {
  provider: string;
  platform: string;
  remoteChatId: string;
  remoteMessageIds: string[];
  raw?: unknown;
}
```

This lets callers keep generic flow control while still retaining raw provider payloads for debugging when needed.

### Provider contract

Each provider implements `ImPlatformProvider`:

```ts
interface ImPlatformProvider {
  readonly id: string;
  readonly platform: string;
  supportsTarget(target: DispatchTarget): boolean;
  supportsContent(content: DispatchContent): boolean;
  dispatch(request: DispatchRequest): Promise<DispatchResult>;
  normalizeIncomingMessage?(payload: unknown): Promise<InboundMessage | null>;
  normalizeIncomingAction?(payload: unknown): Promise<InboundAction | null>;
}
```

`supportsTarget()` and `supportsContent()` expose capability checks. The actual dispatch path still validates again before remote I/O.
`normalizeIncomingMessage()` is optional so providers can add inbound capability without forcing it on pure dispatch implementations.

## Core Model

The generic model lives in `packages/im-platform/src/types.ts`.

### Targets

`DispatchTarget` currently supports two kinds:

- `channel`
- `dm`

Each target includes:

- `address: string | number`
- optional `topicId`

The target model is intentionally generic. Provider implementations decide how those fields map onto their own transport parameters.

### Content

`DispatchContent` supports five variants:

- `text`
- `photo`
- `video`
- `document`
- `media-group`

Text and captions can declare a format:

- `plain`
- `markdown`
- `html`

Media sources support either:

- a remote or provider-native string source
- an in-memory binary file object with `filename`, `data`, and optional `mimeType`

### Options

`DispatchOptions` currently exposes:

- `silent`
- `protectContent`
- `allowPaidBroadcast`
- `deliveryMode`

`deliveryMode` currently distinguishes:

- `immediate`
- `native-draft`

The second mode exists as a generic capability signal, but Telegram explicitly rejects it today.

## Dispatch Flow

The runtime entrypoint is `createDistributor()` in `packages/im-platform/src/distributor.ts`.

The dispatch path is:

1. build a `PlatformRegistry`
2. optionally create built-in providers from config
3. resolve `request.provider`
4. throw `ProviderNotFoundError` if the alias is missing
5. call `provider.dispatch(request)`
6. let the provider validate, map, send, and normalize its result

### Registry behavior

`PlatformRegistry` stores providers by `provider.id`.

Current behavior:

- duplicate provider ids are rejected at registration time
- lookup is exact by alias string
- the registry returns provider instances unchanged

This keeps provider identity stable and avoids fallback guessing.

### Built-in provider creation

`createDistributor()` accepts:

- a prebuilt registry
- explicit provider instances
- built-in provider configs

Today the built-in provider config union only contains `TelegramPlatformAdapterConfig`, but the creation path is already factored so more built-ins can be added later without changing the distributor API.

## Telegram Provider Behavior

The current Telegram implementation lives under `packages/im-platform/src/platforms/telegram/`.

Main pieces:

- `telegram-platform-adapter.ts`: provider implementation and result normalization
- `telegram-capabilities.ts`: target/content validation rules
- `telegram-request-mapper.ts`: generic request to Telegram method mapping
- `telegram-text.ts`: format preparation and message chunking
- `telegram-bot-api-client.ts`: HTTP transport and error normalization

### Provider identity and config

Telegram provider config is defined in `packages/im-platform/src/platforms/telegram/types.ts`.

Current config fields:

- `platform: "telegram"`
- `id`
- `botToken`
- `apiBaseUrl?`
- `defaultTextFormat?`
- `defaultDisableNotification?`
- `fetchImpl?`

`id` is the caller-facing alias. `platform` remains `"telegram"` in results and errors.

### Inbound normalization

Telegram now also normalizes inbound update payloads into a platform-agnostic `InboundMessage`.

Current supported inbound image sources:

- `message.photo`
- `message.document` where `mime_type` is `image/*`

Current behavior:

- extract message text or caption
- resolve the file through `getFile`
- download the Bot API file payload
- normalize the image into `InputImageAttachment`
- return a generic `InboundMessage` that can be converted to `TaskInput`

### Target mapping

Telegram target mapping is performed in `mapTelegramTarget()`.

Current rules:

- `channel` maps to Telegram `chat_id`
- `dm` maps to Telegram `chat_id`
- `dm.topicId` maps to `direct_messages_topic_id`
- `channel.topicId` is rejected before transport

There is no separate public Telegram target model. The provider translates the generic target contract into Bot API fields internally.

### Method mapping

Telegram content mapping is performed in `mapTelegramDispatchRequest()`.

Current mappings:

- `text` -> one or more `sendMessage` operations
- `photo` -> `sendPhoto`
- `video` -> `sendVideo`
- `document` -> `sendDocument`
- `media-group` -> `sendMediaGroup`

`text` may expand into multiple Telegram operations because the package chunks long messages before transport.

### Text formatting behavior

Telegram formatting behavior is intentionally conservative.

`telegram-text.ts` applies these rules:

- `plain` sends the text unchanged
- `markdown` converts to Telegram-compatible HTML
- `html` sends the text with `parse_mode: "HTML"`

For markdown and html text sends, the request mapper stores a plain-text fallback string.

`TelegramPlatformAdapter.#sendOperation()` then behaves as follows:

1. attempt the mapped request
2. if the request fails with `RemoteDispatchError`
3. and the operation was a JSON text send with fallback text
4. retry the same method without `parse_mode`

This fallback exists to absorb Telegram parse failures without forcing the caller to preflight formatting.

### Chunking behavior

Long text messages are split before transport in `telegram-text.ts`, which uses vendored Telegram-specific chunking helpers.

Current behavior:

- split threshold is effectively Telegram's 4096-character limit
- chunks try paragraph, line, and sentence boundaries before hard cuts
- each chunk becomes its own `sendMessage` operation

### Media behavior

Single-media requests support both:

- string sources such as URLs or provider-native ids
- in-memory binary payloads

Binary payloads are encoded as `FormData` and sent as multipart requests.

For single media:

- captions are optionally formatted
- `photo` may include `has_spoiler`
- multipart upload happens only when the source is binary

### Media-group behavior

Telegram media groups follow stricter rules enforced in `telegram-capabilities.ts`.

Current validation rules:

- a media group must contain 2 to 10 items
- document items cannot be mixed with photo or video items

Request mapping behavior:

- string-only groups are sent as JSON
- groups containing binary payloads are sent as multipart form-data
- binary items are referenced with `attach://attachment_<index>`

The provider expects `sendMediaGroup` to return an array and normalizes each message id into `DispatchResult.remoteMessageIds`.

### Result normalization

Telegram raw responses are normalized in `telegram-platform-adapter.ts`.

Current behavior:

- every successful operation contributes message ids
- the first response envelope sets `remoteChatId`
- a single operation returns `raw` as one payload
- multiple operations return `raw` as an array of payloads

This is why a long text send and a media group can both share the same generic `DispatchResult` shape.

## Error Model and Validation Rules

Package-level errors live in `packages/im-platform/src/errors.ts`.

Current error classes:

- `ImPlatformError`
- `ProviderNotFoundError`
- `UnsupportedTargetError`
- `UnsupportedContentError`
- `UnsupportedCapabilityError`
- `RemoteDispatchError`

### Validation-before-transport

The Telegram provider validates before sending remote requests.

Current enforcement order:

1. reject unsupported delivery mode
2. reject unsupported target
3. reject unsupported content
4. map request into one or more Telegram operations
5. send operations through `TelegramBotApiClient`

This means obvious shape and capability failures are reported without partial remote side effects.

### Missing provider

If `createDistributor().dispatch()` cannot resolve `request.provider`, it throws `ProviderNotFoundError`.

This failure happens in the generic distributor layer before any provider-specific logic runs.

### Unsupported capability

Telegram currently rejects `deliveryMode: "native-draft"` by raising `UnsupportedCapabilityError`.

This is deliberate. The public model allows a draft-like concept, but the built-in Telegram provider only supports immediate Bot API delivery.

### Unsupported target and content

Telegram raises:

- `UnsupportedTargetError` for invalid target shapes
- `UnsupportedContentError` for invalid content shapes

Current examples:

- `channel` target with `topicId`
- media group with fewer than 2 items
- media group with more than 10 items
- media group mixing documents with photo or video items

### Remote dispatch failures

`TelegramBotApiClient` wraps HTTP and Bot API failures in `RemoteDispatchError`.

That error includes:

- provider id
- platform name
- Telegram method name
- detail string
- optional status code

The transport treats both non-2xx HTTP responses and `{ ok: false }` Bot API payloads as failures.

## Vendored Upstream Boundary

Telegram-specific helper code is vendored under:

- `packages/im-platform/src/platforms/telegram/vendor/telegram-platform-adapter/`

The provenance note lives in:

- `packages/im-platform/src/platforms/telegram/vendor/telegram-platform-adapter/SOURCE.md`

Current provenance:

- upstream repository: `https://github.com/yusixian/cos-tool-bot`
- pinned commit: `eeb2552ffdade276f12c8f93b80339a18920d63b`

Only two helper files are vendored:

- Markdown-to-Telegram-HTML formatting
- Telegram-aware message splitting

Important boundary rules:

- vendored helpers stay under the Telegram provider subtree
- public package exports do not expose upstream names
- the vendored directory is named `telegram-platform-adapter`, not the upstream project name
- the rest of the provider logic is native to this repository

This keeps the public package identity provider-oriented while still reusing proven Telegram-specific behavior.

## Testing Coverage

Current automated coverage for the package lives in `test/im-platform.test.ts`.

The test suite currently verifies:

- dispatching markdown text to a channel through a provider alias
- fallback to plain text after Telegram parse failure
- `dm.topicId` mapping to `direct_messages_topic_id`
- media-group dispatch through `sendMediaGroup`
- rejection of `native-draft`
- rejection of unsupported target and media-group combinations
- failure when a provider alias is missing

The tests use a fetch stub instead of real Telegram I/O, so they validate package behavior and request mapping without requiring live network credentials.

## Extension Guidance

New providers should follow the same package boundary used by Telegram.

Recommended structure:

- `packages/im-platform/src/platforms/<provider>/`

Recommended responsibilities:

- provider-local config types
- provider-local capability checks
- provider-local request mapper
- provider-local transport
- one provider class implementing `ImPlatformProvider`

Rules for extending the package:

- keep the generic request and result model stable unless a cross-provider need requires change
- do not expose provider internals from the package root
- do not place provider code outside `packages/im-platform`
- prefer provider aliases plus generic dispatch over provider-specific convenience APIs
- use package errors for validation and transport normalization

If a provider needs helper code from an upstream project, vendor only the narrow helper surface required by that provider and keep provenance inside the provider subtree.

## Current Constraints

The current implementation is intentionally narrow.

Known constraints:

- Telegram is the only built-in provider
- there is no persisted job model
- there is no retry or backoff subsystem
- there is no inbound update handling
- there is no native Telegram draft support
- there is no provider selection or failover policy beyond exact alias lookup
- there is no cross-provider batching abstraction beyond the generic request shape

These are current constraints, not hidden roadmap promises.

## Related Source Files

- `packages/im-platform/src/index.ts`
- `packages/im-platform/src/types.ts`
- `packages/im-platform/src/errors.ts`
- `packages/im-platform/src/registry.ts`
- `packages/im-platform/src/distributor.ts`
- `packages/im-platform/src/built-in.ts`
- `packages/im-platform/src/platforms/telegram/telegram-platform-adapter.ts`
- `packages/im-platform/src/platforms/telegram/telegram-request-mapper.ts`
- `packages/im-platform/src/platforms/telegram/telegram-bot-api-client.ts`
- `test/im-platform.test.ts`
