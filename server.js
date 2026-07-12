/**
 * @fileoverview Universal Coding-Agent Web UI — Server
 *
 * Provider-agnostic Express backend that routes requests to the
 * appropriate coding-agent adapter. All provider-specific logic
 * is isolated in the adapters/ directory.
 */

import express from 'express';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  discoverAdapters,
  getAdapter,
  listProviders,
  getDefaultProvider,
  disposeAll,
} from './adapters/registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3300;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Load provider configurations
let providerConfigs = {};
async function loadConfigs() {
  try {
    const raw = await readFile(join(__dirname, 'config', 'providers.json'), 'utf-8');
    providerConfigs = JSON.parse(raw).providers || {};
  } catch {
    providerConfigs = {};
  }
}

// --- Provider Management API ---

/** List all available providers */
app.get('/api/providers', (_req, res) => {
  const providers = listProviders();
  const enriched = providers.map(p => ({
    ...p,
    enabled: providerConfigs[p.id]?.enabled ?? false,
    configured: !!providerConfigs[p.id]?.config?.apiKey || p.id === 'claude-code',
  }));
  res.json(enriched);
});

/** Get provider configuration */
app.get('/api/providers/:id/config', async (req, res) => {
  const config = providerConfigs[req.params.id];
  if (!config) return res.status(404).json({ error: 'Provider not found' });
  // Mask API keys in response
  const safe = { ...config.config };
  if (safe.apiKey) safe.apiKey = safe.apiKey.slice(0, 8) + '...';
  res.json({ id: req.params.id, enabled: config.enabled, config: safe });
});

/** Update provider configuration */
app.post('/api/providers/:id/config', async (req, res) => {
  if (!providerConfigs[req.params.id]) {
    return res.status(404).json({ error: 'Provider not found' });
  }
  providerConfigs[req.params.id] = {
    ...providerConfigs[req.params.id],
    ...req.body,
    config: {
      ...providerConfigs[req.params.id].config,
      ...(req.body.config || {}),
    },
  };
  res.json({ ok: true });
});

/** Auth status for a provider */
app.get('/api/providers/:id/status', async (req, res) => {
  try {
    const adapter = await getAdapter(req.params.id, providerConfigs[req.params.id]?.config || {});
    const status = await adapter.authStatus();
    res.json(status);
  } catch (err) {
    res.json({ loggedIn: false, error: err.message });
  }
});

// --- Chat API (SSE streaming) ---

app.get('/api/chat', async (req, res) => {
  const message = req.query.message?.trim();
  const providerId = req.query.provider || getDefaultProvider();
  const sessionId = req.query.session_id || undefined;
  const cwd = req.query.cwd || process.cwd();
  const model = req.query.model || undefined;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  if (!providerId) {
    return res.status(400).json({ error: 'No provider configured' });
  }

  let adapter;
  try {
    adapter = await getAdapter(providerId, providerConfigs[providerId]?.config || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let aborted = false;

  req.on('close', () => {
    aborted = true;
    adapter.abort();
  });

  try {
    const eventStream = adapter.chat(message, { sessionId, cwd, model });

    for await (const event of eventStream) {
      if (aborted) break;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  } catch (err) {
    if (!aborted) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    }
  }

  if (!aborted) {
    res.end();
  }
});

// POST variant for larger messages
app.post('/api/chat', async (req, res) => {
  const { message, provider, session_id, cwd, model } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const providerId = provider || getDefaultProvider();
  if (!providerId) {
    return res.status(400).json({ error: 'No provider configured' });
  }

  let adapter;
  try {
    adapter = await getAdapter(providerId, providerConfigs[providerId]?.config || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let aborted = false;
  req.on('close', () => {
    aborted = true;
    adapter.abort();
  });

  try {
    const eventStream = adapter.chat(message.trim(), {
      sessionId: session_id,
      cwd: cwd || process.cwd(),
      model,
    });

    for await (const event of eventStream) {
      if (aborted) break;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  } catch (err) {
    if (!aborted) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    }
  }

  if (!aborted) res.end();
});

// --- Session API ---

/** List sessions for a provider */
app.get('/api/sessions', async (req, res) => {
  const providerId = req.query.provider || getDefaultProvider();
  if (!providerId) return res.json([]);

  try {
    const adapter = await getAdapter(providerId, providerConfigs[providerId]?.config || {});
    const sessions = await adapter.listSessions();
    res.json(sessions);
  } catch {
    res.json([]);
  }
});

/** Get a session with messages */
app.get('/api/sessions/:id', async (req, res) => {
  const providerId = req.query.provider || getDefaultProvider();
  if (!providerId) return res.status(404).json({ error: 'No provider' });

  try {
    const adapter = await getAdapter(providerId, providerConfigs[providerId]?.config || {});
    const session = await adapter.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch {
    res.status(404).json({ error: 'Session not found' });
  }
});

/** Delete a session */
app.delete('/api/sessions/:id', async (req, res) => {
  const providerId = req.query.provider || getDefaultProvider();
  if (!providerId) return res.status(404).json({ error: 'No provider' });

  try {
    const adapter = await getAdapter(providerId, providerConfigs[providerId]?.config || {});
    const ok = await adapter.deleteSession(req.params.id);
    res.json({ ok });
  } catch {
    res.status(404).json({ error: 'Session not found' });
  }
});

// --- Abort API ---

app.post('/api/abort', async (req, res) => {
  const providerId = req.body?.provider || getDefaultProvider();
  if (!providerId) return res.json({ ok: true });

  try {
    const adapter = await getAdapter(providerId, providerConfigs[providerId]?.config || {});
    adapter.abort();
    res.json({ ok: true });
  } catch {
    res.json({ ok: true });
  }
});

// --- Startup ---

async function start() {
  console.log('[server] Discovering adapters...');
  await discoverAdapters();
  await loadConfigs();

  const providers = listProviders();
  console.log(`[server] Found ${providers.length} providers: ${providers.map(p => p.name).join(', ')}`);
  console.log(`[server] Default provider: ${getDefaultProvider()}`);

  app.listen(PORT, () => {
    console.log(`[server] Universal Agent UI running at http://localhost:${PORT}`);
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  await disposeAll();
  process.exit(0);
});
process.on('SIGINT', async () => {
  await disposeAll();
  process.exit(0);
});

start().catch(err => {
  console.error('[server] Fatal error:', err);
  process.exit(1);
});
