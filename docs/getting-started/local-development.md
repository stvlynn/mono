# Local Development

## Purpose

This document covers the default local development workflow for `mono`.

## Prerequisites

- Node.js 20+
- `pnpm`
- at least one configured model profile or provider API key

## Install

```bash
pnpm install
```

## Build

```bash
pnpm build
```

The build uses TypeScript project references and copies prompt template assets into the build output.

## Test

```bash
pnpm test
```

## Run the Interactive UI

```bash
pnpm dev
```

Or run the built artifact directly:

```bash
node packages/cli/dist/bin.js
```

## Run a Single Prompt

```bash
node packages/cli/dist/bin.js --print "read package.json and summarize it"
```

## Configure a Profile

Interactive profile setup:

```bash
mono auth login
```

Common status checks:

```bash
mono auth status
mono config list
mono models
```

## Important Local State

`mono` stores machine-level state in `~/.mono`:

- `config.json`: profiles, defaults, project bindings
- `local/secrets.json`: local API keys
- `sessions/`: session JSONL files

Project-local memory defaults to:

- `.mono/memories/`

## Useful Debug Commands

```bash
mono memory status
mono memory list
mono memory search readme
node packages/cli/dist/bin.js --help
```
