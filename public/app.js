/**
 * @fileoverview Universal Agent UI — Frontend Logic
 *
 * Provider-agnostic chat interface that communicates with any
 * coding agent via the standardized adapter API.
 */

// --- State ---
let currentProvider = null;     // Current provider info { id, name, icon, color, ... }
let providers = [];             // All available providers
let currentSessionId = null;
let currentAbortController = null;
let isStreaming = false;
let streamingTextBuffer = '';   // Accumulator for streaming markdown re-renders

// --- DOM refs ---
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const stopBtn = document.getElementById('stop-btn');
const thinkingEl = document.getElementById('thinking');
const thinkingText = document.getElementById('thinking-text');
const errorBanner = document.getElementById('error-banner');
const errorText = document.getElementById('error-text');
const sessionList = document.getElementById('session-list');
const sessionCount = document.getElementById('session-count');
const authBanner = document.getElementById('auth-banner');
const authBannerText = document.getElementById('auth-banner-text');
const modelInfo = document.getElementById('model-info');
const newChatBtn = document.getElementById('new-chat');
const providerTrigger = document.getElementById('provider-trigger');
const providerMenu = document.getElementById('provider-menu');
const providerBadge = document.getElementById('provider-badge');
const currentProviderIcon = document.getElementById('current-provider-icon');
const currentProviderName = document.getElementById('current-provider-name');
const welcomeEl = document.getElementById('welcome');
const welcomeIcon = document.getElementById('welcome-icon');
const welcomeTitle = document.getElementById('welcome-title');
const welcomeDesc = document.getElementById('welcome-desc');
const inputFooterText = document.getElementById('input-footer-text');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const settingsBackdrop = document.getElementById('settings-backdrop');
const settingsClose = document.getElementById('settings-close');
const settingsProviders = document.getElementById('settings-providers');

// --- Mobile DOM refs ---
const mobileHeader = document.getElementById('mobile-header');
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileProviderTrigger = document.getElementById('mobile-provider-trigger');
const mobileProviderIcon = document.getElementById('mobile-provider-icon');
const mobileProviderName = document.getElementById('mobile-provider-name');
const mobileSettingsBtn = document.getElementById('mobile-settings-btn');
const sidebarEl = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');

// --- Auto-resize textarea ---
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
  sendBtn.disabled = !inputEl.value.trim();
});

// --- Keyboard submit ---
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);

// --- Stop button ---
stopBtn.addEventListener('click', stopGeneration);

function stopGeneration() {
  if (currentAbortController) {
    currentAbortController.abort();
  }
  // Also tell the server to abort
  if (currentProvider) {
    fetch('/api/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: currentProvider.id }),
    }).catch(() => {});
  }
}

// --- New chat ---
newChatBtn.addEventListener('click', () => {
  currentSessionId = null;
  showWelcome();
  inputEl.focus();
  loadSessions();
  closeSidebar();
});

// --- Error dismiss ---
document.getElementById('error-dismiss').addEventListener('click', () => {
  errorBanner.classList.add('hidden');
});
document.getElementById('auth-dismiss').addEventListener('click', () => {
  authBanner.classList.add('hidden');
});

// --- Provider selector ---
providerTrigger.addEventListener('click', (e) => {
  e.stopPropagation();
  providerMenu.classList.toggle('hidden');
});

document.addEventListener('click', () => {
  providerMenu.classList.add('hidden');
});

// --- Settings modal ---
settingsBtn.addEventListener('click', openSettings);
settingsBackdrop.addEventListener('click', closeSettings);
settingsClose.addEventListener('click', closeSettings);

function openSettings() {
  settingsModal.classList.remove('hidden');
  renderSettings();
}

function closeSettings() {
  settingsModal.classList.add('hidden');
}

// --- Mobile sidebar ---
function openSidebar() {
  sidebarEl.classList.add('open');
  sidebarBackdrop.classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  sidebarEl.classList.remove('open');
  sidebarBackdrop.classList.remove('visible');
  document.body.style.overflow = '';
}

function isMobile() {
  return window.innerWidth <= 720;
}

mobileMenuBtn.addEventListener('click', () => {
  if (sidebarEl.classList.contains('open')) {
    closeSidebar();
  } else {
    openSidebar();
  }
});

sidebarBackdrop.addEventListener('click', closeSidebar);

// Mobile provider trigger — opens the same dropdown
mobileProviderTrigger.addEventListener('click', (e) => {
  e.stopPropagation();
  providerMenu.classList.toggle('hidden');
});

// Mobile settings button
mobileSettingsBtn.addEventListener('click', openSettings);

// Close sidebar on escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (sidebarEl.classList.contains('open')) closeSidebar();
    if (!settingsModal.classList.contains('hidden')) closeSettings();
  }
});

// --- Load providers ---
async function loadProviders() {
  try {
    providers = await fetch('/api/providers').then(r => r.json());
    renderProviderMenu();

    // Select first enabled provider, or default
    const enabled = providers.filter(p => p.enabled);
    if (enabled.length > 0) {
      selectProvider(enabled[0]);
    } else if (providers.length > 0) {
      selectProvider(providers[0]);
    }
  } catch (err) {
    console.error('Failed to load providers:', err);
    currentProviderName.textContent = 'No providers';
  }
}

function renderProviderMenu() {
  providerMenu.innerHTML = providers.map(p => `
    <div class="provider-option${p.id === currentProvider?.id ? ' active' : ''}${!p.enabled ? ' disabled' : ''}"
         data-id="${p.id}" data-enabled="${p.enabled}">
      <span class="provider-option-icon">${p.icon}</span>
      <div class="provider-option-info">
        <span class="provider-option-name">${escapeHtml(p.name)}</span>
        <span class="provider-option-desc">${escapeHtml(p.description || '')}</span>
      </div>
      ${p.enabled ? '<span class="provider-option-check">✓</span>' : ''}
    </div>
  `).join('');

  providerMenu.querySelectorAll('.provider-option:not(.disabled)').forEach(el => {
    el.addEventListener('click', () => {
      const provider = providers.find(p => p.id === el.dataset.id);
      if (provider) selectProvider(provider);
      providerMenu.classList.add('hidden');
      if (isMobile()) closeSidebar();
    });
  });
}

function selectProvider(provider) {
  currentProvider = provider;

  // Update UI chrome
  currentProviderIcon.textContent = provider.icon;
  currentProviderName.textContent = provider.name;
  providerBadge.textContent = provider.id;
  providerBadge.style.background = provider.color || '#6366f1';
  document.documentElement.style.setProperty('--accent', provider.color || '#6366f1');

  // Compute lighter accent for hover
  const r = parseInt(provider.color?.slice(1, 3) || '63', 16);
  const g = parseInt(provider.color?.slice(3, 5) || '66', 16);
  const b = parseInt(provider.color?.slice(5, 7) || 'f1', 16);
  const lighter = `rgb(${Math.min(255, r + 30)}, ${Math.min(255, g + 30)}, ${Math.min(255, b + 30)})`;
  document.documentElement.style.setProperty('--accent-hover', lighter);

  // Update placeholders and labels
  inputEl.placeholder = `Message ${provider.name}...`;
  inputFooterText.textContent = `${provider.name} • Universal Agent UI`;
  welcomeIcon.textContent = provider.icon;
  welcomeTitle.textContent = provider.name;
  welcomeDesc.textContent = `Send a message to start a conversation with ${provider.name}.`;
  modelInfo.textContent = provider.name;
  thinkingText.textContent = `${provider.name} is thinking...`;

  // Update provider menu active state
  providerMenu.querySelectorAll('.provider-option').forEach(el => {
    el.classList.toggle('active', el.dataset.id === provider.id);
  });

  // Sync mobile header
  if (mobileProviderIcon) mobileProviderIcon.textContent = provider.icon;
  if (mobileProviderName) mobileProviderName.textContent = provider.name;

  // Check auth
  checkAuth();
  // Load sessions
  loadSessions();
}

// --- Send message ---
async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || isStreaming || !currentProvider) return;

  inputEl.value = '';
  inputEl.style.height = 'auto';
  sendBtn.disabled = true;
  errorBanner.classList.add('hidden');

  // Remove welcome
  const welcome = messagesEl.querySelector('.welcome');
  if (welcome) welcome.remove();

  // Add user message
  addMessage('user', text);

  // Prepare streaming
  isStreaming = true;
  streamingTextBuffer = '';
  thinkingEl.classList.remove('hidden');
  sendBtn.classList.add('hidden');
  stopBtn.classList.remove('hidden');
  scrollToBottom();

  currentAbortController = new AbortController();

  // Build assistant bubble
  const assistantDiv = document.createElement('div');
  assistantDiv.className = 'message assistant';
  assistantDiv.innerHTML = `
    <div class="message-header">
      <div class="avatar" style="background: ${currentProvider.color || 'var(--bg-tertiary)'}">${currentProvider.icon}</div>
      <span>${escapeHtml(currentProvider.name)}</span>
    </div>
    <div class="message-content streaming" id="streaming-content"></div>
  `;
  messagesEl.appendChild(assistantDiv);
  const contentEl = assistantDiv.querySelector('.message-content');
  scrollToBottom();

  try {
    // Use POST for robustness with large messages
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        provider: currentProvider.id,
        session_id: currentSessionId,
        cwd: getCurrentCwd(),
      }),
      signal: currentAbortController.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body.getReader();
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
        if (!jsonStr) continue;

        try {
          const ev = JSON.parse(jsonStr);
          handleEvent(ev, contentEl);
        } catch {
          // skip malformed
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      // User stopped — render what we have
      if (streamingTextBuffer) {
        contentEl.innerHTML = renderMarkdown(streamingTextBuffer);
      }
    } else {
      showError(err.message || 'Request failed');
      assistantDiv.remove();
    }
  } finally {
    isStreaming = false;
    streamingTextBuffer = '';
    thinkingEl.classList.add('hidden');
    contentEl.classList.remove('streaming');
    sendBtn.disabled = !inputEl.value.trim();
    sendBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    currentAbortController = null;

    // Add timestamp
    if (!assistantDiv.querySelector('.timestamp')) {
      const ts = document.createElement('div');
      ts.className = 'timestamp';
      ts.textContent = new Date().toLocaleTimeString();
      assistantDiv.appendChild(ts);
    }

    loadSessions();
  }
}

// --- Handle normalized events ---
function handleEvent(ev, contentEl) {
  switch (ev.type) {
    case 'session':
      currentSessionId = ev.sessionId;
      break;

    case 'text_delta':
      streamingTextBuffer += ev.text;
      contentEl.innerHTML = renderMarkdown(streamingTextBuffer);
      scrollToBottom();
      break;

    case 'message':
      if (ev.content) {
        streamingTextBuffer = ev.content;
        contentEl.innerHTML = renderMarkdown(ev.content);
        scrollToBottom();
      }
      break;

    case 'tool_call': {
      const toolDiv = document.createElement('div');
      toolDiv.className = 'tool-call';
      const inputStr = formatToolInput(ev.input);
      toolDiv.innerHTML = `<strong>${escapeHtml(ev.name)}</strong>${inputStr ? ' ' + escapeHtml(inputStr) : ''}`;
      contentEl.appendChild(toolDiv);
      scrollToBottom();
      break;
    }

    case 'tool_result': {
      const resultDiv = document.createElement('div');
      resultDiv.className = 'tool-result';
      const output = typeof ev.output === 'string' ? ev.output : JSON.stringify(ev.output || '');
      resultDiv.innerHTML = `<span class="tool-result-label">Result:</span> <code>${escapeHtml(output.slice(0, 500))}${output.length > 500 ? '...' : ''}</code>`;
      contentEl.appendChild(resultDiv);
      scrollToBottom();
      break;
    }

    case 'thinking':
      thinkingText.textContent = ev.text || `${currentProvider?.name || 'Agent'} is thinking...`;
      break;

    case 'system':
      if (ev.model) {
        modelInfo.textContent = `${currentProvider?.name || ev.provider} • ${ev.model}`;
      }
      break;

    case 'error':
      showError(ev.message || 'Unknown error');
      break;

    case 'done': {
      const ts = document.createElement('div');
      ts.className = 'timestamp cost';
      const parts = [];
      if (ev.cost) parts.push(`$${Number(ev.cost).toFixed(4)}`);
      if (ev.durationMs) parts.push(`${(ev.durationMs / 1000).toFixed(1)}s`);
      if (ev.usage) {
        if (ev.usage.input_tokens) parts.push(`${ev.usage.input_tokens.toLocaleString()} in`);
        if (ev.usage.output_tokens) parts.push(`${ev.usage.output_tokens.toLocaleString()} out`);
      }
      if (parts.length) ts.textContent = parts.join(' \u00b7 ');
      contentEl.parentElement.appendChild(ts);
      break;
    }
  }
}

// --- Markdown renderer (minimal) ---
function renderMarkdown(text) {
  if (!text) return '';

  // Escape HTML first
  let html = escapeHtml(text);

  // Fenced code blocks: ```lang\n...\n```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="lang-${lang || 'text'}">${code.trim()}</code></pre>`;
  });

  // Inline code: `...`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold: **...**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic: *...*
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

  // Links: [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  return html;
}

// --- Add a user message ---
function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  const avatar = role === 'user' ? 'U' : (currentProvider?.icon || 'A');
  const name = role === 'user' ? 'You' : (currentProvider?.name || 'Agent');
  const avatarBg = role === 'user' ? 'var(--accent)' : 'var(--bg-tertiary)';
  div.innerHTML = `
    <div class="message-header">
      <div class="avatar" style="background: ${avatarBg}">${avatar}</div>
      <span>${escapeHtml(name)}</span>
    </div>
    <div class="message-content">${role === 'user' ? escapeHtml(text) : renderMarkdown(text)}</div>
    <div class="timestamp">${new Date().toLocaleTimeString()}</div>
  `;
  messagesEl.appendChild(div);
  scrollToBottom();
}

// --- Load session from history ---
function loadSession(sessionId) {
  if (isStreaming) return;
  currentSessionId = sessionId;

  const providerParam = currentProvider ? `?provider=${currentProvider.id}` : '';

  fetch(`/api/sessions/${sessionId}${providerParam}`)
    .then(r => r.json())
    .then(session => {
      messagesEl.innerHTML = '';

      for (const msg of session.messages || []) {
        if (msg.role === 'user') {
          addMessage('user', msg.content);
        } else {
          const div = document.createElement('div');
          div.className = 'message assistant';
          div.innerHTML = `
            <div class="message-header">
              <div class="avatar" style="background: ${currentProvider?.color || 'var(--bg-tertiary)'}">${currentProvider?.icon || 'A'}</div>
              <span>${escapeHtml(currentProvider?.name || 'Agent')}</span>
            </div>
            <div class="message-content">${renderMarkdown(msg.content || '')}</div>
          `;
          messagesEl.appendChild(div);
        }
      }
      scrollToBottom();
      highlightSession(sessionId);
      if (isMobile()) closeSidebar();
    })
    .catch(() => showError('Failed to load session'));
}

// --- Load sessions list ---
async function loadSessions() {
  if (!currentProvider) {
    sessionList.innerHTML = '<div class="loading-sessions" style="padding:16px;color:var(--text-muted);font-size:13px;">Select a provider</div>';
    sessionCount.textContent = '';
    return;
  }

  try {
    const list = await fetch(`/api/sessions?provider=${currentProvider.id}`).then(r => r.json());
    if (!list.length) {
      sessionList.innerHTML = '<div class="loading-sessions" style="padding:16px;color:var(--text-muted);font-size:13px;">No sessions yet</div>';
      sessionCount.textContent = '';
      return;
    }

    sessionCount.textContent = `${list.length} session${list.length !== 1 ? 's' : ''}`;

    sessionList.innerHTML = list
      .map(s => {
        const timeAgo = formatTimeAgo(s.updated || s.created);
        const meta = [timeAgo];
        if (s.messageCount) meta.push(`${s.messageCount} msgs`);
        return `
        <div class="session-item${s.id === currentSessionId ? ' active' : ''}"
             data-id="${s.id}">
          <div class="session-item-content">
            <div class="session-title">${escapeHtml(s.title || 'Untitled')}</div>
            <div class="session-meta">${meta.join(' · ')}</div>
          </div>
          <button class="session-delete" data-id="${s.id}" title="Delete session">&times;</button>
        </div>`;
      })
      .join('');

    sessionList.querySelectorAll('.session-item').forEach(el => {
      el.addEventListener('click', (e) => {
        // Don't load session if clicking delete
        if (e.target.closest('.session-delete')) return;
        loadSession(el.dataset.id);
      });
    });

    sessionList.querySelectorAll('.session-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        try {
          await fetch(`/api/sessions/${id}?provider=${currentProvider.id}`, { method: 'DELETE' });
          if (id === currentSessionId) {
            currentSessionId = null;
            showWelcome();
          }
          loadSessions();
        } catch {
          showError('Failed to delete session');
        }
      });
    });
  } catch {
    sessionList.innerHTML = '<div class="loading-sessions">Failed to load</div>';
    sessionCount.textContent = '';
  }
}

function highlightSession(id) {
  sessionList.querySelectorAll('.session-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });
}

// --- Check auth ---
async function checkAuth() {
  if (!currentProvider) return;

  try {
    const status = await fetch(`/api/providers/${currentProvider.id}/status`).then(r => r.json());
    if (status.loggedIn) {
      authBanner.classList.add('hidden');
      modelInfo.textContent = `${currentProvider.name} • ${status.username || 'authenticated'}`;
    } else if (status.error) {
      authBannerText.textContent = `${currentProvider.name}: ${status.error}`;
      authBanner.classList.remove('hidden');
    } else {
      authBannerText.textContent = `Not logged in to ${currentProvider.name}`;
      authBanner.classList.remove('hidden');
    }
  } catch {
    // Silent — auth check is non-critical
  }
}

// --- Settings ---
function renderSettings() {
  settingsProviders.innerHTML = providers.map(p => `
    <div class="settings-provider">
      <div class="settings-provider-header">
        <span>${p.icon} ${escapeHtml(p.name)}</span>
        <label class="toggle">
          <input type="checkbox" data-provider="${p.id}" ${p.enabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="settings-provider-desc">${escapeHtml(p.description || '')}</div>
    </div>
  `).join('');

  settingsProviders.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const providerId = cb.dataset.provider;
      await fetch(`/api/providers/${providerId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: cb.checked }),
      });
      // Update local state
      const p = providers.find(x => x.id === providerId);
      if (p) p.enabled = cb.checked;
      renderProviderMenu();
    });
  });
}

// --- Helpers ---
function showWelcome() {
  messagesEl.innerHTML = `
    <div class="welcome" id="welcome">
      <div class="welcome-icon" id="welcome-icon">${currentProvider?.icon || '🤖'}</div>
      <h2 id="welcome-title">${currentProvider?.name || 'Agent Hub'}</h2>
      <p id="welcome-desc">Send a message to start a conversation${currentProvider ? ' with ' + currentProvider.name : ''}.</p>
    </div>`;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

function showError(msg) {
  errorText.textContent = msg;
  errorBanner.classList.remove('hidden');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatToolInput(input) {
  if (!input) return '';
  if (typeof input === 'string') return input;
  try {
    const s = JSON.stringify(input);
    return s.length > 100 ? s.slice(0, 100) + '...' : s;
  } catch {
    return '';
  }
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function getCurrentCwd() {
  // Could be made configurable via UI
  return window.location.pathname !== '/' ? window.location.pathname : undefined;
}

// --- Init ---
loadProviders();
inputEl.focus();
