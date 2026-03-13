Adapted from `https://github.com/yusixian/cos-tool-bot` at commit `eeb2552ffdade276f12c8f93b80339a18920d63b`.

Vendored files were renamed under `telegram-platform-adapter` to keep the public package surface platform-oriented:

- `packages/bot/src/utils/format.ts`
- `packages/bot/src/utils/split-message.ts`

Only Telegram-specific formatting and text-splitting helpers are copied here. The public API of `@mono/im-platform` does not expose upstream names.
