/**
 * @fileoverview Base adapter interface for coding agents.
 *
 * Every provider adapter must extend BaseAdapter and implement
 * all abstract methods. The adapter layer isolates all provider-specific
 * logic from the frontend and server routing.
 *
 * @typedef {'chat'|'sessions'|'tools'|'diffs'|'auth'|'abort'|'models'} Capability
 *
 * @typedef {Object} AdapterInfo
 * @property {string} id - Unique provider identifier (e.g., "claude-code")
 * @property {string} name - Display name (e.g., "Claude Code")
 * @property {string} icon - Emoji or asset path for provider icon
 * @property {string} color - Hex color for provider theming (#RRGGBB)
 * @property {string} description - Short description of the provider
 * @property {string} website - Provider homepage URL
 *
 * @typedef {Object} AuthStatus
 * @property {boolean} loggedIn
 * @property {string} [username]
 * @property {string} [email]
 * @property {string} [plan]
 * @property {Object} [extra]
 *
 * @typedef {Object} SessionSummary
 * @property {string} id
 * @property {string} title
 * @property {number} created
 * @property {number} updated
 * @property {number} messageCount
 *
 * @typedef {Object} SessionDetail
 * @property {string} id
 * @property {string} title
 * @property {Array<{role: string, content: string}>} messages
 * @property {number} created
 * @property {number} updated
 *
 * @typedef {Object} ChatOptions
 * @property {string} [sessionId] - Resume existing session
 * @property {string} [cwd] - Working directory
 * @property {string} [model] - Model override
 * @property {boolean} [yolo] - Auto-approve all tool calls
 *
 * @typedef {Object} ChatEvent
 * @property {string} type - Event type (session|text_delta|tool_call|tool_result|thinking|message|system|done|error|auth_status)
 * @property {*} [data] - Event-type-specific payload
 */

/**
 * Base adapter class. All provider adapters extend this.
 *
 * Lifecycle:
 *   1. new AdapterClass(config)
 *   2. await adapter.init()
 *   3. adapter.chat() / adapter.listSessions() / etc.
 *   4. await adapter.dispose()
 */
export class BaseAdapter {
  /** @returns {string} Unique provider identifier */
  get id() {
    throw new Error('Adapter must implement get id()');
  }

  /** @returns {string} Display name */
  get name() {
    throw new Error('Adapter must implement get name()');
  }

  /** @returns {string} Emoji icon */
  get icon() {
    return '🤖';
  }

  /** @returns {string} Hex color */
  get color() {
    return '#6366f1';
  }

  /** @returns {string} Description */
  get description() {
    return '';
  }

  /** @returns {string} Website URL */
  get website() {
    return '';
  }

  /**
   * @returns {Set<Capability>} Set of capabilities this adapter supports
   */
  get capabilities() {
    return new Set(['chat', 'sessions']);
  }

  /**
   * Check if this adapter supports a specific capability.
   * @param {Capability} cap
   * @returns {boolean}
   */
  supports(cap) {
    return this.capabilities.has(cap);
  }

  /**
   * Initialize the adapter with configuration.
   * @param {Object} config - Provider-specific configuration
   */
  async init(config) {
    this.config = config || {};
  }

  /**
   * Check authentication status.
   * @returns {Promise<AuthStatus>}
   */
  async authStatus() {
    return { loggedIn: false };
  }

  /**
   * Send a chat message and stream response events.
   *
   * Must be an async generator that yields ChatEvent objects.
   * The server wraps these into SSE for the frontend.
   *
   * @param {string} message - User message
   * @param {ChatOptions} options
   * @yields {ChatEvent}
   */
  async *chat(message, options) {
    throw new Error('Adapter must implement chat()');
  }

  /**
   * List available sessions.
   * @returns {Promise<SessionSummary[]>}
   */
  async listSessions() {
    return [];
  }

  /**
   * Get a session with full message history.
   * @param {string} id
   * @returns {Promise<SessionDetail|null>}
   */
  async getSession(id) {
    return null;
  }

  /**
   * Delete a session.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async deleteSession(id) {
    return false;
  }

  /**
   * Abort the current generation.
   */
  abort() {
    // Default no-op; adapters with streaming override this
  }

  /**
   * Get available models for this provider.
   * @returns {Promise<Array<{id: string, name: string, provider: string}>>}
   */
  async listModels() {
    return [];
  }

  /**
   * Cleanup resources.
   */
  async dispose() {
    // Default no-op
  }
}

/**
 * Normalize a raw provider event into the standard ChatEvent format.
 * Adapters use this to convert their provider-specific events.
 *
 * @param {string} type
 * @param {*} data
 * @returns {ChatEvent}
 */
export function createEvent(type, data = null) {
  return { type, ...data };
}

/**
 * Helper: create a text_delta event.
 * @param {string} text
 * @returns {ChatEvent}
 */
export function textDelta(text) {
  return { type: 'text_delta', text };
}

/**
 * Helper: create a session event.
 * @param {string} sessionId
 * @returns {ChatEvent}
 */
export function sessionEvent(sessionId) {
  return { type: 'session', sessionId };
}

/**
 * Helper: create a done event.
 * @param {Object} meta
 * @returns {ChatEvent}
 */
export function doneEvent(meta = {}) {
  return { type: 'done', ...meta };
}

/**
 * Helper: create an error event.
 * @param {string} message
 * @returns {ChatEvent}
 */
export function errorEvent(message) {
  return { type: 'error', message };
}

/**
 * Helper: create a system event.
 * @param {Object} info
 * @returns {ChatEvent}
 */
export function systemEvent(info) {
  return { type: 'system', ...info };
}
