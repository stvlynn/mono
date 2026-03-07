# API Reference: `@mono/tools`

## Purpose

Document the built-in coding tools and permission wrapping.

## Built-in Tool Factory

`createCodingTools(cwd)` returns:

- `read`
- `write`
- `edit`
- `bash`

`createProtectedCodingTools(...)` wraps them in permission checks.

## Important Tool Contracts

Tools can expose:

- `parseArgs`
- `inputSchema`
- `executionMode`
- `conflictKey`
- `execute(args, context)`

## Permission Layer

The default permission policy:

- auto-allows `read`
- asks before `bash`
- denies destructive bash patterns
- asks before other mutating tools
