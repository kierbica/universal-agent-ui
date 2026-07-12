/**
 * @fileoverview Adapter registry — manages provider adapters.
 *
 * Handles discovery, registration, initialization, and lifecycle
 * of all coding-agent adapters. The server uses this to route
 * requests to the correct provider.
 */

import { readdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** @type {Map<string, import('./base.js').BaseAdapter>} */
const adapters = new Map();

/** @type {Map<string, typeof import('./base.js').BaseAdapter>} */
const adapterClasses = new Map();

/**
 * Register an adapter class.
 * @param {typeof import('./base.js').BaseAdapter} AdapterClass
 */
export function registerAdapter(AdapterClass) {
  // Instantiate temporarily to get the id
  const temp = new AdapterClass();
  adapterClasses.set(temp.id, AdapterClass);
}

/**
 * Discover and register all adapter files in the adapters/ directory.
 * Adapter files must export a default class that extends BaseAdapter.
 */
export async function discoverAdapters() {
  const adaptersDir = __dirname;
  const files = await readdir(adaptersDir);

  for (const file of files) {
    if (file === 'base.js' || file === 'registry.js' || !file.endsWith('.js')) continue;

    try {
      const mod = await import(join(adaptersDir, file));
      const AdapterClass = mod.default || mod[Object.keys(mod).find(k => {
        try { return typeof mod[k] === 'function' && mod[k].prototype?.capabilities; } catch { return false; }
      })];

      if (AdapterClass) {
        registerAdapter(AdapterClass);
        console.log(`[registry] Discovered adapter: ${file}`);
      }
    } catch (err) {
      console.error(`[registry] Failed to load adapter ${file}:`, err.message);
    }
  }
}

/**
 * Get an initialized adapter by provider ID.
 * Creates and initializes on first access.
 *
 * @param {string} providerId
 * @param {Object} config
 * @returns {Promise<import('./base.js').BaseAdapter>}
 */
export async function getAdapter(providerId, config = {}) {
  if (adapters.has(providerId)) {
    return adapters.get(providerId);
  }

  const AdapterClass = adapterClasses.get(providerId);
  if (!AdapterClass) {
    throw new Error(`Unknown provider: ${providerId}. Available: ${listProviders().map(p => p.id).join(', ')}`);
  }

  const adapter = new AdapterClass();
  await adapter.init(config);
  adapters.set(providerId, adapter);
  return adapter;
}

/**
 * List all registered providers (initialized or not).
 * @returns {Array<{id: string, name: string, icon: string, color: string, description: string}>}
 */
export function listProviders() {
  return Array.from(adapterClasses.values()).map(Class => {
    const temp = new Class();
    return {
      id: temp.id,
      name: temp.name,
      icon: temp.icon,
      color: temp.color,
      description: temp.description,
      website: temp.website,
    };
  });
}

/**
 * Get the default provider (first registered, or "claude-code" if available).
 * @returns {string}
 */
export function getDefaultProvider() {
  if (adapterClasses.has('claude-code')) return 'claude-code';
  const first = adapterClasses.keys().next();
  return first.done ? null : first.value;
}

/**
 * Dispose all adapters.
 */
export async function disposeAll() {
  for (const [id, adapter] of adapters) {
    try {
      await adapter.dispose();
    } catch (err) {
      console.error(`[registry] Error disposing ${id}:`, err.message);
    }
  }
  adapters.clear();
}
