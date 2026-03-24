# Web Config

Browser-based configuration UI for `mono`, backed by the real global config and local secrets stores.

A React + TypeScript + Tailwind CSS + shadcn/ui dashboard for managing `~/.mono/config.json`, `~/.mono/local/secrets.json`, nearby runtime status, and skill installation workflows.

## Quick Start

```bash
# Serve the real config UI through the mono CLI
mono config ui
```

The CLI serves the built SPA and same-origin JSON API on `http://127.0.0.1:5173` by default.

For frontend-only development, run the API separately and proxy `/api` from Vite:

```bash
# Terminal 1: API only
mono config ui --api-only --port 5174 --no-open

# Terminal 2: Vite dev server
cd packages/web-config
MONO_CONFIG_UI_API_URL=http://127.0.0.1:5174 npm run dev
```

## Features

- **Global Config Editing**: Materialized editing for `mono.settings`, `mono.memory`, `mono.context`, and `mono.channels.telegram`
- **LLM Profiles Management**: Create, edit, rename, delete, and set the default global profile
- **Secret Management**: Store and clear per-profile API keys in `~/.mono/local/secrets.json`
- **Nearby Operations**: Inspect memory status, Telegram status, local skills, remote skill search, and install operations
- **Raw JSON Editor**: Edit the materialized global config snapshot directly with hash-guarded saves
- **Responsive Navigation**: Mobile drawer navigation with desktop sidebar layout

## Tech Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Utility-first styling
- **shadcn/ui** - UI component library
- **Radix UI** - Headless UI primitives
- **Lucide React** - Icon library

## Project Structure

```
packages/web-config/
├── src/
│   ├── components/
│   │   ├── sections/       # Page sections (Profiles, Memory, etc.)
│   │   │   ├── ProfilesSection.tsx
│   │   │   ├── MemorySection.tsx
│   │   │   ├── SafetySection.tsx
│   │   │   ├── SkillsSection.tsx
│   │   │   └── GeneralSection.tsx
│   │   └── ui/            # shadcn/ui components
│   │       ├── button.tsx
│   │       ├── card.tsx
│   │       ├── input.tsx
│   │       ├── switch.tsx
│   │       └── ...
│   ├── App.tsx            # Main app component with sidebar navigation
│   ├── index.css          # Global styles and CSS variables
│   └── main.tsx           # Entry point
├── index.html
├── package.json
├── tailwind.config.js
├── postcss.config.js
└── vite.config.ts
```

## Development

```bash
# Install dependencies
npm install

# Start dev server with hot reload
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Configuration

The UI always edits the **global** config file:

- `~/.mono/config.json`
- `~/.mono/local/secrets.json`

If the current workspace contains `.mono/config.json`, the UI shows a warning because project-level overrides still affect runtime resolution.

The app uses CSS variables for theming (defined in `src/index.css`):

- Explicit light/dark theme overrides via document root classes
- `System` theme follows `prefers-color-scheme`
- Primary, secondary, accent, muted color scales
- Consistent border radius and spacing

## Accessibility

This UI follows accessibility best practices:

- **Focus states**: Visible focus rings on all interactive elements (`focus-visible:ring-2`)
- **Labels & ARIA**: Inputs, switches, and icon-only buttons have programmatic labels
- **Reduced motion**: Respects `prefers-reduced-motion` media query
- **Semantic HTML**: Proper heading hierarchy and button types
- **Touch targets**: Minimum 44x44px for interactive elements
- **Keyboard support**: Mobile navigation can be closed with `Escape`

### Recent UI Improvements (2026-03-22)

- Added responsive mobile drawer navigation while keeping the desktop sidebar layout
- Wired theme selection to the document root with `system` mode support
- Added labels and focus states for custom navigation and form controls
- Increased touch targets to meet the documented 44x44 minimum
- Made profile credential metadata provider-aware
- Implemented `prefers-reduced-motion` support for accessibility
- Replaced mock state with a real CLI-served JSON API and hash-guarded config writes
- Added global secret management for profile-local API keys
- Added nearby operational panels for memory status, Telegram status, and skill installation

## Integration with mono

This UI is served by `mono config ui` and uses the same config store, profile model resolution, and secret files as the CLI/TUI. Saves emit a config-ui reload signal so long-lived TUI sessions can refresh their registry and Telegram runtime when idle.
