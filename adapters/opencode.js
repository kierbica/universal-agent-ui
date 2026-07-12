/**
 * @fileoverview OpenCode/Crush adapter.
 *
 * Connects to a running OpenCode (Crush) instance via its HTTP API.
 * Requires the server to be started with `crush serve` or `opencode server`.
 *
 * API reference (from Crush internal/server):
 *   POST /v1/chat          — Send message, returns SSE stream
 *   GET  /v1/sessions       — List sessions
 *   GET  /v1/sessions/:id   — Get session with messages
 *   DELETE /v1/sessions/:id — Delete session
 *   GET  /v1/auth/status    — Authentication status
 *   POST /v1/abort          — Abort current generation
 */

import {
  BaseAdapter,
  textDelta,
  sessionEvent,
  doneEvent,
  errorEvent,
  systemEvent,
} from './base.js';

export default class OpenCodeAdapter extends BaseAdapter {
  get id() { return 'opencode'; }
  get name() { return 'OpenCode'; }
  get icon() { return '⚡'; }
  get color() { return '#f59e0b'; }
  get description() { return 'OpenCode (Crush) — multi-model agentic coding via HTTP API'; }
  get website() { return 'https://github.com/charmbracelet/crush'; }

  get capabilities() {
    return new Set(['chat', 'sessions', 'auth', 'abort', 'models']);
  }

  async init(config) {
    await super.init(config);
    this.baseUrl = (config.baseUrl || 'http://localhost:3000').replace(/\/+$/, '');
    this.apiKey = config.apiKey || null;
    this.timeout = config.timeout || 300000;
    this._abortController = null;
  }

  /**
   * Build common fetch headers.
   */
  _headers() {
    const h = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    };
    if (this.apiKey) {
      h['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  async authStatus() {
    try {
      const res = await fetch(`${this.baseUrl}/v1/auth/status`, {
        headers: this._headers(),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { loggedIn: false };
      const data = await res.json();
      return { loggedIn: !!data.loggedIn, ...data };
    } catch {
      return { loggedIn: false, error: 'Cannot connect to OpenCode server' };
    }
  }

  /**
   * Stream a chat response from the OpenCode HTTP API.
   * @yields {import('./base.js').ChatEvent}
   */
  async *chat(message, options = {}) {
    this._abortController = new AbortController();

    const body = {
      message,
      session_id: options.sessionId || undefined,
      cwd: options.cwd || undefined,
      model: options.model || undefined,
    };

    try {
      const res = await fetch(`${this.baseUrl}/v1/chat`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify(body),
        signal: this._abortController.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        yield errorEvent(`OpenCode API error ${res.status}: ${text.slice(0, 200)}`);
        return;
      }

      yield sessionEvent(body.session_id || 'opencode-session');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;

          try {
            const ev = JSON.parse(jsonStr);
            const normalized = this._normalizeEvent(ev);
            if (normalized) yield normalized;
          } catch {
            // Skip malformed JSON
          }
        }
      }

      // Process remaining buffer
      if (buffer.startsWith('data: ')) {
        const jsonStr = buffer.slice(6).trim();
        if (jsonStr && jsonStr !== '[DONE]') {
          try {
            const ev = JSON.parse(jsonStr);
            const normalized = this._normalizeEvent(ev);
            if (normalized) yield normalized;
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      yield errorEvent(err.message || 'Connection to OpenCode failed');
    } finally {
      this._abortController = null;
    }
  }

  /**
   * Normalize OpenCode SSE events into standard format.
   */
  _normalizeEvent(ev) {
    // OpenCode may use different event structures depending on version
    // Handle common patterns
    switch (ev.type) {
      case 'session':
        return sessionEvent(ev.session_id);

      case 'text_delta':
      case 'content_delta':
        return textDelta(ev.text || ev.delta?.text || '');

      case 'message':
        if (ev.content || ev.text) {
          return { type: 'message', role: 'assistant', content: ev.content || ev.text };
        }
        return null;

      case 'tool_call':
        return { type: 'tool_call', name: ev.name, input: ev.input };

      case 'tool_result':
        return { type: 'tool_result', name: ev.name, output: ev.output };

      case 'system':
        return systemEvent({
          model: ev.model,
          provider: ev.provider || 'opencode',
          sessionId: ev.session_id,
        });

      case 'done':
      case 'result':
        return doneEvent({
          cost: ev.cost || ev.total_cost_usd,
          durationMs: ev.duration_ms,
          usage: ev.usage,
        });

      case 'error':
        return errorEvent(ev.message || ev.error || 'Unknown error');

      case 'thinking':
        return { type: 'thinking', text: ev.text };

      default:
        // Try to extract text from unknown events
        if (ev.text) return textDelta(ev.text);
        if (ev.delta?.text) return textDelta(ev.delta.text);
        return null;
    }
  }

  async listSessions() {
    try {
      const res = await fetch(`${this.baseUrl}/v1/sessions`, {
        headers: this._headers(),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (Array.isArray(data) ? data : data.sessions || []).map(s => ({
        id: s.id,
        title: s.title || s.name || 'Untitled',
        created: s.created || s.created_at || 0,
        updated: s.updated || s.updated_at || 0,
        messageCount: s.message_count || s.messages?.length || 0,
      }));
    } catch {
      return [];
    }
  }

  async getSession(id) {
    try {
      const res = await fetch(`${this.baseUrl}/v1/sessions/${id}`, {
        headers: this._headers(),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async deleteSession(id) {
    try {
      const res = await fetch(`${this.baseUrl}/v1/sessions/${id}`, {
        method: 'DELETE',
        headers: this._headers(),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  abort() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    // Also tell the server to abort
    fetch(`${this.baseUrl}/v1/abort`, {
      method: 'POST',
      headers: this._headers(),
    }).catch(() => {});
  }

  async listModels() {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this._headers(),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (Array.isArray(data) ? data : data.models || []).map(m => ({
        id: m.id,
        name: m.name || m.id,
        provider: m.provider || 'opencode',
      }));
    } catch {
      return [];
    }
  }
}
