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

## Docker

mono can also run in Docker with a persistent `~/.mono` config volume.

### Quick start

```bash
docker compose build
cp .env.example .env
docker compose up -d
```

The compose file mounts:

- the repository into `/workspace`
- `${HOME}/.mono` into `/data/home/.mono`

Inside the container, `MONO_CONFIG_DIR` defaults to `/data/home/.mono`, so sessions, memory, cache, state, and local secrets survive container restarts.

If `.env` provides `MONO_BOOTSTRAP_PROVIDER`, `MONO_BOOTSTRAP_MODEL`, and `MONO_API_KEY`, the container will create a default `mono` profile on first boot.

### One-shot commands

```bash
docker compose run --rm mono "node /app/packages/cli/dist/bin.js --help"
docker compose run --rm mono "node /app/packages/cli/dist/bin.js --print hello"
```

### Interactive attach

```bash
docker attach $(docker compose ps -q mono)
```

For more detail, see [docs/operations/docker.md](docs/operations/docker.md).

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