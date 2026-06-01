// ─── API config (mirrored in background.js) ───────────────────────────────

const DEFAULTS = {
  apiEndpoint: 'http://127.0.0.1:11434',
  apiUsername: '',
  apiPassword: '',
  apiModel:    'llama3.2:3b',
};

let CONFIG = { ...DEFAULTS };

async function loadConfig() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  CONFIG = {
    apiEndpoint: (stored.apiEndpoint ?? DEFAULTS.apiEndpoint).replace(/\/+$/, ''),
    apiUsername: stored.apiUsername ?? DEFAULTS.apiUsername,
    apiPassword: stored.apiPassword ?? DEFAULTS.apiPassword,
    apiModel:    stored.apiModel    ?? DEFAULTS.apiModel,
  };
  return CONFIG;
}

function authHeaders(extra = {}) {
  const headers = { ...extra };
  if (CONFIG.apiUsername || CONFIG.apiPassword) {
    headers['Authorization'] = 'Basic ' + btoa(`${CONFIG.apiUsername}:${CONFIG.apiPassword}`);
  }
  return headers;
}

function isLocalDefault(endpoint = CONFIG.apiEndpoint) {
  return endpoint === DEFAULTS.apiEndpoint || endpoint === 'http://localhost:11434';
}

// ─── Icon theme helpers (popup has DOM/canvas access) ──────────────────────

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function setIconForTheme(isDark) {
  try {
    const src = isDark ? 'icons/favicon_light.png' : 'icons/favicon_dark.png';
    const img = await loadImage(src);
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, size, size);
    await chrome.action.setIcon({ imageData: ctx.getImageData(0, 0, size, size) });
  } catch { /* keep existing icon if anything fails */ }
}

const SETUP_KEY = 'setupComplete';

// ─── Boot ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  setIconForTheme(window.matchMedia('(prefers-color-scheme: dark)').matches);
  await loadConfig();
  wireSettingsView();
  wireCliView();

  const { setupComplete } = await chrome.storage.local.get(SETUP_KEY);
  if (setupComplete) {
    showMainView();
    initMainView();
  } else {
    showWizardView();
    runWizard();
  }
});

// ─── View switching ────────────────────────────────────────────────────────

function showWizardView() {
  document.getElementById('wizard-view').hidden = false;
  document.getElementById('main-view').hidden = true;
  document.getElementById('settings-view').hidden = true;
  document.getElementById('cli-view').hidden = true;
}

function showMainView() {
  document.getElementById('wizard-view').hidden = true;
  document.getElementById('main-view').hidden = false;
  document.getElementById('settings-view').hidden = true;
  document.getElementById('cli-view').hidden = true;
  updateSettingsSummary();
}

function showSettingsView(returnTo) {
  document.getElementById('wizard-view').hidden = true;
  document.getElementById('main-view').hidden = true;
  document.getElementById('cli-view').hidden = true;
  const view = document.getElementById('settings-view');
  view.hidden = false;
  view.dataset.returnTo = returnTo;
  populateSettingsFields();
  clearSettingsStatus();
}

function showCliView() {
  document.getElementById('wizard-view').hidden = true;
  document.getElementById('main-view').hidden = true;
  document.getElementById('settings-view').hidden = true;
  document.getElementById('cli-view').hidden = false;
  selectCliTab(detectDefaultOs());
}

// ─── Wizard runner ─────────────────────────────────────────────────────────

async function runWizard() {
  await runStep(1, checkOllamaReachable, renderStep1Failure);
  await runStep(2, checkOllamaApiReady,  renderStep2Failure);
  await runStep(3, ensureModelAvailable, renderStep3Failure);

  const step4 = document.getElementById('step-4');
  step4.hidden = false;
  setStepState(4, 'done', "All set — you're ready!");

  await chrome.storage.local.set({ [SETUP_KEY]: true });
  await new Promise(r => setTimeout(r, 700));
  showMainView();
  initMainView();
}

// Runs a single step in a retry loop until the check passes.
async function runStep(n, checkFn, onFail) {
  document.getElementById(`step-${n}`).hidden = false;
  setStepState(n, 'checking');

  let passed = false;
  while (!passed) {
    try {
      passed = await checkFn();
    } catch (_) {
      passed = false;
    }

    if (!passed) {
      setStepState(n, 'failed');
      await onFail(); // resolves when user clicks Retry or an action completes
      setStepState(n, 'checking');
    }
  }

  setStepState(n, 'done');
}

// ─── Step state management ─────────────────────────────────────────────────

const STEP_ICONS = {
  checking: '<span class="spinner"></span>',
  done: '✅',
  failed: '❌',
};

function stepTitle(n, state) {
  if (n === 3) {
    if (state === 'checking') return 'Checking for model…';
    if (state === 'done')     return `Model ready (${CONFIG.apiModel})`;
    if (state === 'failed')   return `Model not found (${CONFIG.apiModel})`;
  }
  const baseTitles = {
    1: { checking: 'Checking for endpoint…', done: 'Endpoint reachable',  failed: 'Endpoint not reachable' },
    2: { checking: 'Verifying API…',         done: 'API ready',           failed: 'API not responding' },
    4: { checking: 'Finishing up…',          done: "All set — you're ready!", failed: '' },
  };
  return baseTitles[n]?.[state] ?? '';
}

function setStepState(n, state, customTitle) {
  const el = document.getElementById(`step-${n}`);
  el.className = `step state-${state}`;
  el.querySelector('.step-icon').innerHTML = STEP_ICONS[state] ?? '';
  el.querySelector('.step-title').textContent = customTitle ?? stepTitle(n, state);

  const body = el.querySelector('.step-body');
  if (body) body.hidden = state !== 'failed';
}

// ─── Check functions ───────────────────────────────────────────────────────

async function checkOllamaReachable() {
  // Any HTTP response (200, 404, etc.) confirms the HTTP server is up.
  await fetch(`${CONFIG.apiEndpoint}/`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(4000),
  });
  return true;
}

async function checkOllamaApiReady() {
  const res = await fetch(`${CONFIG.apiEndpoint}/api/tags`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(4000),
  });
  return res.ok;
}

async function ensureModelAvailable() {
  const res = await fetch(`${CONFIG.apiEndpoint}/api/tags`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) return false;
  const { models } = await res.json();
  const base = CONFIG.apiModel.split(':')[0];
  return (models ?? []).some(m => m.name === CONFIG.apiModel || m.name.startsWith(base + ':'));
}

// ─── Failure renderers ─────────────────────────────────────────────────────

function renderStep1Failure() {
  const body = document.querySelector('#step-1 .step-body');
  const usingLocal = isLocalDefault();
  body.innerHTML = usingLocal ? `
    <p class="step-msg">Can't reach Ollama on <code class="cmd">127.0.0.1:11434</code>. Follow these steps:</p>
    <ol class="setup-steps">
      <li>Download &amp; install Ollama using the button below</li>
      <li>Open <strong>Terminal</strong> and run:<br><code class="cmd">ollama serve</code></li>
      <li>Leave that terminal open, then click <strong>Retry</strong></li>
    </ol>
    <p class="step-msg" style="margin-top:8px">Already installed? Just run <code class="cmd">ollama serve</code> and retry.</p>
    <div class="step-actions">
      <a class="action-link" href="https://ollama.com/download" target="_blank">Download Ollama</a>
      <button class="action-btn" id="retry-1">Retry</button>
    </div>
  ` : `
    <p class="step-msg">Can't reach <code class="cmd">${CONFIG.apiEndpoint}</code>. Check the URL and credentials, or use a different endpoint.</p>
    <div class="step-actions">
      <button class="action-btn primary" id="open-settings-1">Edit Settings</button>
      <button class="action-btn" id="retry-1">Retry</button>
    </div>
  `;
  return new Promise(resolve => {
    document.getElementById('retry-1').addEventListener('click', resolve, { once: true });
    document.getElementById('open-settings-1')?.addEventListener('click', () => {
      showSettingsView('wizard');
    }, { once: true });
  });
}

function renderStep2Failure() {
  const body = document.querySelector('#step-2 .step-body');
  body.innerHTML = `
    <p class="step-msg">
      Endpoint responded but the API isn't ready. Check that <code class="cmd">${CONFIG.apiEndpoint}/api/tags</code> is reachable and credentials are correct.
    </p>
    <div class="step-actions">
      <button class="action-btn primary" id="open-settings-2">Edit Settings</button>
      <button class="action-btn" id="retry-2">Retry</button>
    </div>
  `;
  return new Promise(resolve => {
    document.getElementById('retry-2').addEventListener('click', resolve, { once: true });
    document.getElementById('open-settings-2').addEventListener('click', () => {
      showSettingsView('wizard');
    }, { once: true });
  });
}

function renderStep3Failure() {
  const body = document.querySelector('#step-3 .step-body');
  const usingLocal = isLocalDefault();
  body.innerHTML = `
    <p class="step-msg">
      Model <code class="cmd">${CONFIG.apiModel}</code> isn't available on this endpoint.
      ${usingLocal ? 'Pull it now (~2 GB) or click Retry if already pulled.' : 'Update the model name in Settings or pull it on the server.'}
    </p>
    <div class="step-actions">
      ${usingLocal ? '<button class="action-btn primary" id="pull-btn">Pull Model</button>' : '<button class="action-btn primary" id="open-settings-3">Edit Settings</button>'}
      <button class="action-btn" id="retry-3">Retry</button>
    </div>
    <div class="progress-wrap" id="pull-progress" hidden>
      <div class="progress-track"><div id="progress-bar"></div></div>
      <span id="progress-label">Starting download…</span>
    </div>
  `;

  return new Promise((resolve) => {
    document.getElementById('retry-3').addEventListener('click', resolve, { once: true });
    document.getElementById('open-settings-3')?.addEventListener('click', () => {
      showSettingsView('wizard');
    }, { once: true });

    document.getElementById('pull-btn')?.addEventListener('click', async () => {
      const pullBtn   = document.getElementById('pull-btn');
      const retryBtn  = document.getElementById('retry-3');
      const progressWrap = document.getElementById('pull-progress');

      pullBtn.disabled  = true;
      retryBtn.disabled = true;
      progressWrap.hidden = false;

      try {
        const success = await pullModel((pct, status) => {
          document.getElementById('progress-bar').style.width = pct + '%';
          document.getElementById('progress-label').textContent =
            status ? `${status} — ${pct}%` : `${pct}%`;
        });

        if (success) {
          resolve();
        } else {
          document.getElementById('progress-label').textContent = 'Pull ended unexpectedly — click Retry';
          retryBtn.disabled = false;
        }
      } catch (err) {
        document.getElementById('progress-label').textContent = 'Pull failed — click Retry';
        retryBtn.disabled = false;
      }
    }, { once: true });
  });
}

// ─── Streaming model pull ──────────────────────────────────────────────────

async function pullModel(onProgress) {
  const res = await fetch(`${CONFIG.apiEndpoint}/api/pull`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name: CONFIG.apiModel, stream: true }),
  });

  if (!res.ok) throw new Error(`Pull request failed: ${res.statusText}`);

  const reader = res.body.getReader();
  const dec    = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    for (const line of dec.decode(value, { stream: true }).split('\n')) {
      if (!line.trim()) continue;
      try {
        const { status, completed, total } = JSON.parse(line);
        if (total > 0) onProgress(Math.round((completed / total) * 100), status);
        if (status === 'success') return true;
      } catch { /* partial JSON chunk — skip */ }
    }
  }

  return false;
}

// ─── Live status polling (main view) ──────────────────────────────────────

async function pingOllama() {
  try {
    const res = await fetch(`${CONFIG.apiEndpoint}/api/tags`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(3000),
    });
    return { reachable: true, authed: res.status !== 401 && res.status !== 403 };
  } catch {
    return { reachable: false, authed: false };
  }
}

function applyOllamaStatus(state) {
  const badge = document.getElementById('ollama-badge');
  const text  = document.getElementById('ollama-badge-text');
  const desc  = document.getElementById('ollama-desc');
  const hint  = document.getElementById('ollama-offline-hint');
  if (!badge) return;

  const online = state.reachable && state.authed;
  badge.className = 'status-badge ' + (online ? 'on' : 'off');

  if (!state.reachable) {
    text.textContent = 'Offline';
    desc.textContent = 'Not reachable';
  } else if (!state.authed) {
    text.textContent = 'Auth Error';
    desc.textContent = 'Check credentials';
  } else {
    text.textContent = 'Online';
    desc.textContent = isLocalDefault() ? 'Local model ready' : 'Remote endpoint ready';
  }

  // Only show the local-Ollama setup hint when we're actually configured for local.
  hint.hidden = online || !isLocalDefault();
}

let pollHandle = null;
function startOllamaPolling() {
  if (pollHandle) clearInterval(pollHandle);
  let lastKey = null;

  async function tick() {
    const state = await pingOllama();
    const key = `${state.reachable}:${state.authed}`;
    if (key !== lastKey) {
      lastKey = key;
      applyOllamaStatus(state);
    }
  }

  tick();
  pollHandle = setInterval(tick, 5000);
}

// ─── Settings view ─────────────────────────────────────────────────────────

function wireSettingsView() {
  document.getElementById('wizard-to-settings').addEventListener('click', (e) => {
    e.preventDefault();
    showSettingsView('wizard');
  });

  document.getElementById('open-settings-row').addEventListener('click', () => {
    showSettingsView('main');
  });

  document.getElementById('settings-back').addEventListener('click', () => {
    const returnTo = document.getElementById('settings-view').dataset.returnTo;
    if (returnTo === 'wizard') {
      showWizardView();
    } else {
      showMainView();
    }
  });

  document.getElementById('settings-reset').addEventListener('click', () => {
    document.getElementById('settings-endpoint').value = DEFAULTS.apiEndpoint;
    document.getElementById('settings-model').value    = DEFAULTS.apiModel;
    document.getElementById('settings-username').value = '';
    document.getElementById('settings-password').value = '';
    showSettingsStatus('Reset to local defaults. Click Save to apply.', 'checking');
  });

  document.getElementById('settings-test').addEventListener('click', async () => {
    const draft = readSettingsForm();
    if (!draft) return;
    showSettingsStatus('Testing connection…', 'checking');
    const result = await testEndpoint(draft);
    if (!result.ok) {
      showSettingsStatus(`Failed: ${result.error}`, 'error');
      return;
    }
    if (result.modelFound) {
      showSettingsStatus(`Connected. Model "${draft.apiModel}" found.`, 'success');
    } else if (result.available && result.available.length) {
      const list = result.available.slice(0, 8).join(', ');
      const extra = result.available.length > 8 ? `, … (+${result.available.length - 8} more)` : '';
      showSettingsStatus(`Connected, but "${draft.apiModel}" isn't on this server. Available: ${list}${extra}`, 'checking');
    } else {
      showSettingsStatus(`Connected, but the server reports no models installed.`, 'checking');
    }
  });

  document.getElementById('settings-save').addEventListener('click', async () => {
    const draft = readSettingsForm();
    if (!draft) return;
    await chrome.storage.local.set({
      apiEndpoint: draft.apiEndpoint,
      apiUsername: draft.apiUsername,
      apiPassword: draft.apiPassword,
      apiModel:    draft.apiModel,
      [SETUP_KEY]: true,  // saving settings counts as completing setup
    });
    await loadConfig();
    showSettingsStatus('Saved.', 'success');
    setTimeout(() => {
      const returnTo = document.getElementById('settings-view').dataset.returnTo;
      showMainView();
      if (returnTo === 'wizard') {
        initMainView();
      } else {
        // Already in main view session — refresh status badge with new config.
        startOllamaPolling();
      }
    }, 400);
  });
}

// ─── CLI view ───────────────────────────────────────────────────────────────

const CLI_RAW_BASE = 'https://raw.githubusercontent.com/prak-mtl/prompt-enhancer/main/cli';
const CLI_SCRIPT_URL = {
  unix: `${CLI_RAW_BASE}/install-remote.sh`,
  win:  `${CLI_RAW_BASE}/install-remote.ps1`,
};

function detectDefaultOs() {
  const platform =
    (navigator.userAgentData && navigator.userAgentData.platform) ||
    navigator.platform ||
    navigator.userAgent ||
    '';
  return /win/i.test(platform) ? 'win' : 'unix';
}

function selectCliTab(os) {
  const isWin = os === 'win';
  document.getElementById('cli-tab-win').classList.toggle('active', isWin);
  document.getElementById('cli-tab-unix').classList.toggle('active', !isWin);
  document.getElementById('cli-cmd-win-block').hidden = !isWin;
  document.getElementById('cli-cmd-unix-block').hidden = isWin;
  document.getElementById('cli-note-win').hidden = !isWin;
  document.getElementById('cli-view-script').href = isWin ? CLI_SCRIPT_URL.win : CLI_SCRIPT_URL.unix;
}

async function copyCliCommand(codeId, btn) {
  const text = document.getElementById(codeId).textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied ✓';
  } catch {
    btn.textContent = 'Copy failed';
  }
  setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
}

function wireCliView() {
  document.getElementById('open-cli-row').addEventListener('click', showCliView);
  document.getElementById('cli-tab-unix').addEventListener('click', () => selectCliTab('unix'));
  document.getElementById('cli-tab-win').addEventListener('click', () => selectCliTab('win'));
  document.getElementById('cli-copy-unix').addEventListener('click', (e) => copyCliCommand('cli-cmd-unix', e.currentTarget));
  document.getElementById('cli-copy-win').addEventListener('click', (e) => copyCliCommand('cli-cmd-win', e.currentTarget));
  document.getElementById('cli-back').addEventListener('click', showMainView);
}

function populateSettingsFields() {
  document.getElementById('settings-endpoint').value = CONFIG.apiEndpoint;
  document.getElementById('settings-model').value    = CONFIG.apiModel;
  document.getElementById('settings-username').value = CONFIG.apiUsername;
  document.getElementById('settings-password').value = CONFIG.apiPassword;
}

function readSettingsForm() {
  const endpointRaw = document.getElementById('settings-endpoint').value.trim();
  const modelRaw    = document.getElementById('settings-model').value.trim();
  const username    = document.getElementById('settings-username').value;
  const password    = document.getElementById('settings-password').value;

  if (!endpointRaw) {
    showSettingsStatus('Endpoint URL is required.', 'error');
    return null;
  }
  try {
    const u = new URL(endpointRaw);
    if (!/^https?:$/.test(u.protocol)) throw new Error('proto');
  } catch {
    showSettingsStatus('Endpoint must be a valid http:// or https:// URL.', 'error');
    return null;
  }
  if (!modelRaw) {
    showSettingsStatus('Model name is required.', 'error');
    return null;
  }

  return {
    apiEndpoint: endpointRaw.replace(/\/+$/, ''),
    apiUsername: username,
    apiPassword: password,
    apiModel:    modelRaw,
  };
}

function showSettingsStatus(message, kind) {
  const el = document.getElementById('settings-status');
  el.textContent = message;
  el.className = `settings-status ${kind}`;
  el.hidden = false;
}

function clearSettingsStatus() {
  const el = document.getElementById('settings-status');
  el.hidden = true;
  el.textContent = '';
}

async function testEndpoint(draft) {
  const headers = {};
  if (draft.apiUsername || draft.apiPassword) {
    headers['Authorization'] = 'Basic ' + btoa(`${draft.apiUsername}:${draft.apiPassword}`);
  }
  try {
    const res = await fetch(`${draft.apiEndpoint}/api/tags`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'authentication failed (check username/password)' };
    }
    if (res.status === 404) {
      return { ok: false, error: '404 — /api/tags not found at this URL. Is this an Ollama-compatible endpoint?' };
    }
    if (res.status >= 500) {
      return { ok: false, error: `${res.status} ${res.statusText || 'server error'} — the server (or its proxy) is unhealthy. Credentials and URL look fine; try again in a moment.` };
    }
    if (!res.ok) {
      return { ok: false, error: `${res.status} ${res.statusText || 'error'}` };
    }
    const { models } = await res.json();
    const base = draft.apiModel.split(':')[0];
    const available = (models ?? []).map(m => m.name);
    const modelFound = available.some(name => name === draft.apiModel || name.startsWith(base + ':'));
    return { ok: true, modelFound, available };
  } catch (err) {
    return { ok: false, error: 'network error — endpoint unreachable' };
  }
}

function updateSettingsSummary() {
  const summary = document.getElementById('settings-summary');
  if (!summary) return;
  if (isLocalDefault()) {
    summary.textContent = `Local Ollama · ${CONFIG.apiModel}`;
  } else {
    try {
      const host = new URL(CONFIG.apiEndpoint).host;
      const authBit = CONFIG.apiUsername ? ` · ${CONFIG.apiUsername}@` : ' · ';
      summary.textContent = `${host}${authBit}${CONFIG.apiModel}`;
    } catch {
      summary.textContent = `${CONFIG.apiEndpoint} · ${CONFIG.apiModel}`;
    }
  }
}

// ─── Main view (toggle logic) ─────────────────────────────────────────────

async function initMainView() {
  startOllamaPolling();
  updateSettingsSummary();

  const globalToggle    = document.getElementById('globalToggle');
  const siteToggle      = document.getElementById('siteToggle');
  const siteNameDisplay = document.getElementById('siteName');
  const statusBadge     = document.getElementById('statusBadge');
  const statusText      = document.getElementById('statusText');

  let tab, domain;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url);
    domain = url.hostname;
    siteNameDisplay.textContent = domain;
  } catch {
    siteNameDisplay.textContent = 'unknown';
  }

  let siteEnabledForDomain = true;

  function updateUI() {
    const globalOn = globalToggle.checked;
    siteToggle.checked  = globalOn && siteEnabledForDomain;
    siteToggle.disabled = !globalOn;

    const active = globalOn && siteEnabledForDomain;
    statusBadge.className = 'status-badge ' + (active ? 'on' : 'off');
    statusText.textContent = active ? 'Active' : 'Inactive';
  }

  chrome.storage.local.get(['disabled', 'disabledDomains'], (res) => {
    globalToggle.checked = !res.disabled;
    const disabledDomains = res.disabledDomains || [];
    siteEnabledForDomain = domain ? !disabledDomains.includes(domain) : false;
    updateUI();
  });

  globalToggle.addEventListener('change', () => {
    chrome.storage.local.set({ disabled: !globalToggle.checked });
    if (tab) chrome.tabs.sendMessage(tab.id, { action: 'refresh_state' }).catch(() => {});
    updateUI();
  });

  siteToggle.addEventListener('change', () => {
    siteEnabledForDomain = siteToggle.checked;
    chrome.storage.local.get(['disabledDomains'], (res) => {
      let list = res.disabledDomains || [];
      if (siteEnabledForDomain) {
        list = list.filter(d => d !== domain);
      } else {
        if (domain) list.push(domain);
      }
      chrome.storage.local.set({ disabledDomains: list });
      if (tab) chrome.tabs.sendMessage(tab.id, { action: 'refresh_state' }).catch(() => {});
    });
    updateUI();
  });
}
