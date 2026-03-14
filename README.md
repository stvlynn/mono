# mono

`xsai`-powered coding agent CLI with `read`, `write`, `edit`, and `bash` tools.

## Overview

mono is an AI-powered coding agent that provides a command-line interface for intelligent code development and project management. It integrates with various AI providers (OpenAI, Anthropic, Google Gemini, etc.) to offer context-aware coding assistance.

## Features

- **Multi-provider AI support**: OpenAI, Anthropic Claude, Google Gemini, OpenRouter
- **Interactive CLI**: Real-time conversation with the AI agent
- **File system tools**: Read, write, edit files with intelligent context
- **Shell integration**: Execute bash commands with safety controls
- **Session management**: Persistent sessions with memory compression
- **Telegram control runtime**: Bot polling, DM pairing, and local allowlist management
- **Project configuration**: Per-project profiles and settings
- **Tool approval system**: Configurable approval flow for protected operations

## Packages

The project is organized as a monorepo with the following packages:

- **`@mono/cli`**: Main command-line interface and entry point
- **`@mono/agent-core`**: Core agent logic and task orchestration
- **`@mono/shared`**: Common utilities and type definitions
- **`@mono/tools`**: File system and shell tool implementations
- **`@mono/config`**: Configuration management and profile handling
- **`@mono/llm`**: LLM provider integrations and model registry
- **`@mono/memory`**: Session memory management and compression
- **`@mono/prompts`**: Template system for AI prompts
- **`@mono/session`**: Session state management
- **`@mono/tui`**: Terminal user interface components

## Installation

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Link the CLI globally
pnpm link --global
```

## Usage

### Basic Usage

```bash
# Start interactive mode
mono

# Run a single command
mono "read the project structure and create a new component"

# Use a specific model
mono -m gpt-4 "optimize this function"

# Auto-approve all tool usage (use with caution)
mono -y "refactor the entire codebase"
```

### Configuration

```bash
# Set up a new profile
mono auth login

# Configure OpenAI
mono auth login --provider openai --model gpt-4.1-mini

# Configure Anthropic Claude
mono auth login --provider anthropic --model claude-sonnet-4-5

# Set default profile
mono auth login --provider openai --model gpt-4.1-mini --default
```

### Session Management

```bash
# Continue previous session
mono -c "continue working on the feature"

# Start fresh session (default)
mono "start new task"
```

### Telegram Account Pairing

`mono` supports Telegram DM pairing. The intended flow is:

1. Save the Telegram bot token:

```bash
mono telegram token <BOT_TOKEN>
```

2. Start the interactive TUI so the Telegram control runtime begins polling:

```bash
mono
```

3. Have the Telegram user send a DM to the bot. If the user is not approved yet, the bot replies with a short pairing code.

4. Approve that code from the operator side:

```bash
# From the local CLI
mono pair telegram code <CODE>

# Or inside the mono TUI
/pair telegram code <CODE>
```

5. After approval, the Telegram user id is stored in the local DM allowlist. While the `mono` TUI is running, the user can message the bot directly; `/help` is still available for Telegram control commands.

Useful shortcuts and checks:

```bash
# Inspect Telegram runtime status, token presence, policy, and pending requests
mono telegram status

# Directly allowlist a Telegram user id without a pairing code
mono pair telegram userid <USER_ID>

# Optionally save the bot's Telegram user id for diagnostics
mono pair telegram botid <BOT_ID>
```

Notes:

- DM pairing is the default policy for Telegram private chats.
- The polling runtime starts in the TUI, not in one-shot `--print` mode.
- Telegram chat currently runs through the same in-process agent as the TUI, so only one active task can run at a time.
- Approved DM users are stored under the local mono state directory.

## Architecture

### Core Components

1. **Agent Core**: Orchestrates AI interactions and tool execution
2. **Tool System**: Provides safe file system and shell operations
3. **Memory System**: Manages conversation history and context compression
4. **Configuration**: Handles profiles, API keys, and project settings
5. **LLM Integration**: Abstracts different AI providers with unified interface

### Tool Safety

The system implements a multi-layer approval system:
- **Protected tools**: File write, edit, and bash operations require approval
- **Read-only tools**: File read operations are generally safe
- **Auto-approval mode**: `-y` flag bypasses approvals (use carefully)

### Memory Management

- **Session persistence**: Maintains context across interactions
- **Intelligent compression**: Summarizes older messages to stay within token limits
- **File tracking**: Records which files were accessed or modified

## Development

### Project Structure

```
mono/
├── packages/
│   ├── cli/           # Command-line interface
│   ├── agent-core/    # Core agent logic
│   ├── shared/        # Common utilities
│   ├── tools/         # File/shell tools
│   ├── config/        # Configuration management
│   ├── llm/           # LLM integrations
│   ├── memory/        # Memory management
│   ├── prompts/       # Prompt templates
│   ├── session/       # Session management
│   └── tui/           # Terminal UI
├── docs/              # Documentation
└── examples/          # Usage examples
```

### Development Workflow

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Watch mode for development
pnpm dev

# Run tests
pnpm test

# Lint code
pnpm lint
```

### Adding New Tools

1. Define tool schema in `@mono/tools`
2. Implement tool logic with safety checks
3. Add tool to agent's available tools
4. Update documentation and help text

## Configuration

### Global Configuration (`~/.mono/config.json`)

```json
{
  "mono": {
    "defaultProfile": "default",
    "profiles": {
      "default": {
        "provider": "openai",
        "modelId": "gpt-4.1-mini",
        "baseURL": "https://api.openai.com/v1",
        "family": "openai-compatible",
        "transport": "xsai-openai-compatible",
        "providerFactory": "openai",
        "apiKeyEnv": "OPENAI_API_KEY",
        "supportsTools": true,
        "supportsReasoning": true
      }
    }
  }
}
```

### Project Configuration (`.mono/config.json`)

```json
{
  "profile": "default",
  "provider": "openai",
  "modelId": "gpt-4.1-mini",
  "baseURL": "https://api.openai.com/v1",
  "apiKeyEnv": "OPENAI_API_KEY"
}
```

## Supported Providers

- **OpenAI**: GPT-4, GPT-4.1-mini, GPT-3.5-turbo
- **Anthropic**: Claude 3.5 Sonnet, Claude 3 Opus
- **Google**: Gemini Pro, Gemini Flash
- **OpenRouter**: Various models through unified API

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.
