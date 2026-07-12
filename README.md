# Universal Agent UI

A web frontend for AI coding agents — similar to OpenCode's Web UI, but provider-agnostic. Connect to Claude Code, OpenCode/Crush, or any other coding agent through a single interface with session history, streaming responses, and provider switching.

## Quick Start

```bash
git clone https://github.com/kierbica/universal-agent-ui.git
cd universal-agent-ui
npm install
npm start
```

Open **http://localhost:3300** and start chatting.

## Features

- **Session history** — browse, resume, and delete past conversations per provider
- **Streaming responses** — real-time token-by-token output with cost and duration tracking
- **Provider switching** — dropdown to switch between Claude Code, OpenCode, and others on the fly
- **Dynamic theming** — UI colors, icons, and labels adapt to the selected provider
- **Tool call visibility** — see which tools the agent is invoking (bash, file edits, etc.)
- **Auth status** — check if the selected provider is authenticated
- **Settings modal** — enable/disable providers without touching config files
- **Thinking indicator** — visual feedback while the agent processes
- **Cost tracking** — per-response cost and duration display
- **New chat** — one-click session reset

## Built-in Providers

| Provider | Transport | How it works |
|----------|-----------|--------------|
| **Claude Code** | CLI | Spawns `claude` with `--output-format stream-json` for streaming |
| **OpenCode / Crush** | HTTP | Connects to `crush serve` via SSE streaming |

## Adding a New Provider

Create a single file `adapters/my-agent.js`:

```js
import { BaseAdapter, textDelta, doneEvent } from './base.js';

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
    // Your streaming logic here
    yield textDelta('Hello! ');
    yield doneEvent({ durationMs: 1200 });
  }

  async listSessions() {
    return [];
  }
}
```

Restart the server — your provider appears in the dropdown automatically.

## Adapter Interface

Every adapter extends `BaseAdapter` and implements:

| Method | Description |
|--------|-------------|
| `get id` | Unique provider ID |
| `get name` | Display name |
| `get icon` | Emoji icon |
| `get color` | Hex color for theming |
| `get capabilities` | Set of supported features |
| `authStatus()` | Authentication state |
| `chat(message, options)` | Stream response events |
| `listSessions()` | List saved sessions |
| `getSession(id)` | Get session with messages |
| `deleteSession(id)` | Delete a session |
| `abort()` | Cancel current generation |

### Capabilities

| Capability | Description |
|------------|-------------|
| `chat` | Send messages and stream responses |
| `sessions` | List, get, and delete sessions |
| `tools` | Tool call visibility |
| `diffs` | Code diff display |
| `auth` | Authentication status |
| `abort` | Cancel mid-generation |
| `models` | List available models |

### Event Schema

All adapters emit normalized events:

```js
{ type: 'session',     sessionId: '...' }
{ type: 'text_delta',  text: '...' }
{ type: 'tool_call',   name: 'bash', input: { command: 'ls' } }
{ type: 'tool_result', name: 'bash', output: 'file1\nfile2' }
{ type: 'thinking',    text: '...' }
{ type: 'message',     role: 'assistant', content: '...' }
{ type: 'system',      model: 'claude-sonnet-4', provider: 'anthropic' }
{ type: 'done',        cost: 0.0042, durationMs: 3200, usage: {...} }
{ type: 'error',       message: 'Something went wrong' }
```

## API

```
GET  /api/providers                  List all providers
GET  /api/providers/:id/status       Auth status
POST /api/providers/:id/config       Update provider config
POST /api/chat                       SSE stream (provider + message)
GET  /api/sessions?provider=<id>     List sessions
GET  /api/sessions/:id               Get session with messages
DELETE /api/sessions/:id             Delete session
POST /api/abort                      Abort current generation
```

## Configuration

Provider configs live in `config/providers.json`:

```json
{
  "providers": {
    "claude-code": {
      "enabled": true,
      "config": { "command": "claude", "timeout": 300000 }
    },
    "opencode": {
      "enabled": true,
      "config": { "baseUrl": "http://localhost:3000" }
    }
  }
}
```

Set `PORT` env var to change the default port (3300).

## Requirements

- Node.js 18+
- One or more coding agent CLIs installed and authenticated

## License

MIT
