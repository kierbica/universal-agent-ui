# Universal Agent UI

A provider-agnostic web frontend for AI coding agents. Connect to Claude Code, OpenCode, Codex, Gemini CLI, Aider, and any future agent through a single, unified interface.

## Quick Start

```bash
git clone https://github.com/kierbica/universal-agent-ui.git
cd universal-agent-ui
npm install
npm start
```

Open **http://localhost:3300**, pick a provider from the sidebar dropdown, and start chatting.

## What It Does

Universal Agent UI decouples the chat interface from any single coding agent. Instead of building a separate UI for each provider, you get one interface that speaks a standardized protocol. Any agent that implements the adapter interface works out of the box.

**Supported providers today:**

| Provider | Transport | Status |
|----------|-----------|--------|
| Claude Code | CLI (`claude --output-format stream-json`) | Built-in |
| OpenCode / Crush | HTTP API (`crush serve`) | Built-in |
| Codex | CLI | Adapter-ready |
| Gemini CLI | CLI | Adapter-ready |
| Aider | CLI | Adapter-ready |
| Continue | HTTP API | Adapter-ready |
| OpenHands | HTTP API | Adapter-ready |

"Adapter-ready" means the interface supports it — you just write the adapter.

## Architecture

```
server.js                     Express backend, provider-agnostic routing
adapters/
  base.js                     BaseAdapter interface + event helpers
  registry.js                 Auto-discovery, lifecycle management
  claude-code.js              Claude Code CLI adapter
  opencode.js                 OpenCode/Crush HTTP adapter
config/providers.json         Provider configurations
public/
  index.html                  UI shell with provider selector
  app.js                      Frontend logic, provider switching
  style.css                   Theme with dynamic accent colors
```

**Key design decisions:**

- **Adapter pattern** — each provider is a class extending `BaseAdapter`. All provider logic stays in `adapters/`. The server and frontend never import provider-specific code.
- **Normalized event stream** — every adapter emits the same event types (`text_delta`, `tool_call`, `done`, etc.). The frontend doesn't know or care which provider is behind the stream.
- **Auto-discovery** — drop a `.js` file in `adapters/` exporting a `BaseAdapter` subclass. The registry picks it up on server start. Zero config changes.
- **Dynamic theming** — the frontend reads each provider's color and icon, updating CSS variables, labels, and placeholders in real time when you switch.

## Adding a New Provider

Create `adapters/my-agent.js`:

```js
import { BaseAdapter, textDelta, doneEvent, errorEvent } from './base.js';

export default class MyAgentAdapter extends BaseAdapter {
  get id()     { return 'my-agent'; }
  get name()   { return 'My Agent'; }
  get icon()   { return '🔧'; }
  get color()  { return '#10b981'; }
  get description() { return 'My custom coding agent'; }

  get capabilities() {
    return new Set(['chat', 'sessions']);
  }

  async authStatus() {
    return { loggedIn: true };
  }

  async *chat(message, options) {
    // Your provider-specific streaming logic.
    // Yield normalized events:
    yield { type: 'session', sessionId: 'abc-123' };
    yield textDelta('Hello! ');
    yield textDelta('How can I help?');
    yield doneEvent({ durationMs: 1200 });
  }

  async listSessions() {
    return [{ id: 'abc-123', title: 'Previous chat', created: Date.now(), updated: Date.now(), messageCount: 4 }];
  }
}
```

Restart the server. Your provider appears in the dropdown automatically.

## Adapter Interface

Every adapter must implement:

| Method | Returns | Description |
|--------|---------|-------------|
| `get id` | `string` | Unique provider ID |
| `get name` | `string` | Display name |
| `get icon` | `string` | Emoji icon |
| `get color` | `string` | Hex color for theming |
| `get capabilities` | `Set<string>` | Supported features |
| `authStatus()` | `AuthStatus` | Authentication state |
| `chat(message, options)` | `AsyncGenerator<ChatEvent>` | Stream response events |
| `listSessions()` | `SessionSummary[]` | List saved sessions |
| `getSession(id)` | `SessionDetail` | Get session with messages |
| `deleteSession(id)` | `boolean` | Delete a session |
| `abort()` | `void` | Cancel current generation |

### Capabilities

Adapters declare which features they support:

| Capability | Description |
|------------|-------------|
| `chat` | Send messages and receive streaming responses |
| `sessions` | Session management (list, get, delete) |
| `tools` | Tool call visibility (bash, file ops, etc.) |
| `diffs` | Code diff display |
| `auth` | Authentication status checking |
| `abort` | Cancel mid-generation |
| `models` | List available models |

### Event Schema

All adapters emit normalized events:

```js
{ type: 'session',    sessionId: '...' }
{ type: 'text_delta', text: '...' }
{ type: 'tool_call',  name: 'bash', input: { command: 'ls' } }
{ type: 'tool_result', name: 'bash', output: 'file1\nfile2' }
{ type: 'thinking',   text: '...' }
{ type: 'message',    role: 'assistant', content: '...' }
{ type: 'system',     model: 'claude-sonnet-4', provider: 'anthropic' }
{ type: 'done',       cost: 0.0042, durationMs: 3200, usage: {...} }
{ type: 'error',      message: 'Something went wrong' }
```

## API

The server exposes provider-agnostic endpoints:

```
GET  /api/providers                  List all providers
GET  /api/providers/:id/status       Auth status for a provider
GET  /api/providers/:id/config       Get provider config
POST /api/providers/:id/config       Update provider config

GET  /api/chat?message=...&provider=claude-code   SSE stream
POST /api/chat                      POST variant for large messages

GET  /api/sessions?provider=claude-code   List sessions
GET  /api/sessions/:id                    Get session
DELETE /api/sessions/:id                  Delete session

POST /api/abort                     Abort current generation
```

## Configuration

Provider configs live in `config/providers.json`:

```json
{
  "providers": {
    "claude-code": {
      "enabled": true,
      "config": {
        "command": "claude",
        "timeout": 300000
      }
    },
    "opencode": {
      "enabled": true,
      "config": {
        "baseUrl": "http://localhost:3000",
        "apiKey": null
      }
    }
  }
}
```

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3300` | Server port |

## Requirements

- Node.js 18+
- One or more coding agent CLIs installed and authenticated

## License

MIT
