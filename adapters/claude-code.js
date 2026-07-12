/**
 * @fileoverview Claude Code adapter.
 *
 * Connects to Claude Code via its CLI, using --output-format stream-json
 * for real-time streaming of responses, tool calls, and session events.
 *
 * CLI reference:
 *   claude -p "message" --output-format stream-json --verbose
 *          --include-partial-messages --session-id <id> [--resume <id>]
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  BaseAdapter,
  textDelta,
  sessionEvent,
  doneEvent,
  errorEvent,
  systemEvent,
} from './base.js';

const SESSIONS_DIR_NAME = 'sessions';

export default class ClaudeCodeAdapter extends BaseAdapter {
  get id() { return 'claude-code'; }
  get name() { return 'Claude Code'; }
  get icon() { return '🟣'; }
  get color() { return '#b07cd8'; }
  get description() { return 'Anthropic Claude Code CLI — powerful agentic coding assistant'; }
  get website() { return 'https://docs.anthropic.com/en/docs/claude-code'; }

  get capabilities() {
    return new Set(['chat', 'sessions', 'tools', 'diffs', 'auth', 'abort']);
  }

  async init(config) {
    await super.init(config);
    this.command = config.command || 'claude';
    this.sessionsDir = config.sessionsDir || join(process.cwd(), SESSIONS_DIR_NAME);
    this.timeout = config.timeout || 300000;
    this._currentProcess = null;
  }

  async authStatus() {
    return new Promise((resolve) => {
      const cp = spawn(this.command, ['auth', 'status'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      cp.stdout.on('data', (d) => { stdout += d; });
      cp.on('close', () => {
        try {
          const status = JSON.parse(stdout);
          resolve({ loggedIn: !!status.loggedIn, ...status });
        } catch {
          resolve({ loggedIn: false, raw: stdout });
        }
      });
      cp.on('error', () => resolve({ loggedIn: false }));
    });
  }

  /**
   * Stream a chat response from Claude Code CLI.
   * @yields {import('./base.js').ChatEvent}
   */
  async *chat(message, options = {}) {
    const sessionId = options.sessionId || crypto.randomUUID();
    const cwd = options.cwd || process.cwd();

    // Build CLI arguments
    const args = [
      '-p', message,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--session-id', sessionId,
    ];

    // Resume existing session if file exists
    const sessionFile = join(this.sessionsDir, `${sessionId}.json`);
    if (existsSync(sessionFile)) {
      args.push('--resume', sessionId);
    }

    const proc = spawn(this.command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      timeout: this.timeout,
    });

    this._currentProcess = proc;

    let buffer = '';
    let assistantContent = '';
    let sessionInfo = null;

    yield sessionEvent(sessionId);

    try {
      // Process stdout line by line
      for await (const chunk of proc.stdout) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            const normalized = this._normalizeEvent(ev);
            if (normalized) {
              yield normalized;
              if (normalized.type === 'text_delta') {
                assistantContent += normalized.text;
              }
              if (normalized.type === 'system' && ev.subtype === 'init') {
                sessionInfo = ev;
              }
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const ev = JSON.parse(buffer);
          const normalized = this._normalizeEvent(ev);
          if (normalized) yield normalized;
        } catch { /* skip */ }
      }

      // Collect stderr for error reporting
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d; });

      const code = await new Promise((resolve) => {
        proc.on('close', resolve);
        proc.on('error', (err) => resolve(-1));
      });

      if (code !== 0 && !assistantContent) {
        yield errorEvent(`Claude exited with code ${code}${stderr ? ': ' + stderr.slice(0, 200) : ''}`);
      }
    } catch (err) {
      yield errorEvent(err.message || 'Chat failed');
    } finally {
      this._currentProcess = null;
    }
  }

  /**
   * Normalize a raw Claude stream event into our standard format.
   * @param {Object} ev - Raw event from Claude CLI
   * @returns {import('./base.js').ChatEvent|null}
   */
  _normalizeEvent(ev) {
    switch (ev.type) {
      case 'stream_event':
        if (ev.event?.delta?.type === 'text_delta') {
          return textDelta(ev.event.delta.text);
        }
        if (ev.event?.delta?.type === 'input_json_delta') {
          // Tool call input streaming — could expose as tool_call_progress
          return null;
        }
        return null;

      case 'assistant':
        if (ev.message?.content) {
          const text = this._extractText(ev.message.content);
          if (text) {
            return { type: 'message', role: 'assistant', content: text };
          }
        }
        return null;

      case 'system':
        if (ev.subtype === 'init') {
          return systemEvent({
            model: ev.model,
            provider: 'anthropic',
            sessionId: ev.session_id,
          });
        }
        return null;

      case 'result':
        return doneEvent({
          cost: ev.total_cost_usd,
          durationMs: ev.duration_ms,
          usage: ev.usage,
        });

      case 'error':
        return errorEvent(ev.message || 'Unknown error');

      case 'stderr':
        // Log but don't surface to UI
        console.log('[claude-code]', ev.text);
        return null;

      default:
        return null;
    }
  }

  /**
   * Extract plain text from Claude content blocks.
   */
  _extractText(blocks) {
    if (!blocks) return '';
    if (typeof blocks === 'string') return blocks;
    if (Array.isArray(blocks)) {
      return blocks
        .filter(b => b.type === 'text')
        .map(b => b.text || '')
        .join('');
    }
    return '';
  }

  async listSessions() {
    const { readdir, readFile } = await import('fs/promises');
    try {
      const files = await readdir(this.sessionsDir);
      const list = await Promise.all(
        files
          .filter(f => f.endsWith('.json'))
          .map(async (f) => {
            try {
              const data = JSON.parse(await readFile(join(this.sessionsDir, f), 'utf-8'));
              return {
                id: data.id,
                title: data.title || 'Untitled',
                created: data.created || 0,
                updated: data.updated || 0,
                messageCount: data.messages?.length || 0,
              };
            } catch {
              return null;
            }
          })
      );
      return list.filter(Boolean).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    } catch {
      return [];
    }
  }

  async getSession(id) {
    const { readFile } = await import('fs/promises');
    try {
      return JSON.parse(
        await readFile(join(this.sessionsDir, `${id}.json`), 'utf-8')
      );
    } catch {
      return null;
    }
  }

  async deleteSession(id) {
    const { unlink } = await import('fs/promises');
    try {
      await unlink(join(this.sessionsDir, `${id}.json`));
      return true;
    } catch {
      return false;
    }
  }

  abort() {
    if (this._currentProcess) {
      this._currentProcess.kill('SIGTERM');
      this._currentProcess = null;
    }
  }
}
