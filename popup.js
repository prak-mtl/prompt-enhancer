const OLLAMA_BASE = 'http://127.0.0.1:11434';

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
const TARGET_MODEL = 'llama3.2:3b';
const SETUP_KEY = 'setupComplete';

// ─── Boot ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Popup has direct access to chrome.action — update icon immediately on open.
  // Uses ImageData (not path) so non-square PNGs are drawn square and path
  // resolution issues in popup contexts are avoided.
  setIconForTheme(window.matchMedia('(prefers-color-scheme: dark)').matches);
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
}

function showMainView() {
  document.getElementById('wizard-view').hidden = true;
  document.getElementById('main-view').hidden = false;
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

const STEP_TITLES = {
  1: { checking: 'Checking for Ollama…',   done: 'Ollama is running',           failed: 'Ollama not detected' },
  2: { checking: 'Verifying Ollama API…',  done: 'Ollama API ready',            failed: 'Ollama API not responding' },
  3: { checking: `Checking for model…`,    done: `Model ready (${TARGET_MODEL})`, failed: `Model not found (${TARGET_MODEL})` },
  4: { checking: 'Finishing up…',          done: "All set — you're ready!",     failed: '' },
};

function setStepState(n, state, customTitle) {
  const el = document.getElementById(`step-${n}`);
  el.className = `step state-${state}`;
  el.querySelector('.step-icon').innerHTML = STEP_ICONS[state] ?? '';
  el.querySelector('.step-title').textContent = customTitle ?? STEP_TITLES[n][state];

  const body = el.querySelector('.step-body');
  if (body) body.hidden = state !== 'failed';
}

// ─── Check functions ───────────────────────────────────────────────────────

async function checkOllamaReachable() {
  // Any HTTP response (200, 404, etc.) confirms the HTTP server is up.
  await fetch(`${OLLAMA_BASE}/`, { signal: AbortSignal.timeout(4000) });
  return true;
}

async function checkOllamaApiReady() {
  const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(4000) });
  return res.ok;
}

async function ensureModelAvailable() {
  const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) return false;
  const { models } = await res.json();
  const base = TARGET_MODEL.split(':')[0];
  return (models ?? []).some(m => m.name === TARGET_MODEL || m.name.startsWith(base + ':'));
}

// ─── Failure renderers ─────────────────────────────────────────────────────

function renderStep1Failure() {
  const body = document.querySelector('#step-1 .step-body');
  body.innerHTML = `
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
  `;
  return new Promise(resolve => {
    document.getElementById('retry-1').addEventListener('click', resolve, { once: true });
  });
}

function renderStep2Failure() {
  const body = document.querySelector('#step-2 .step-body');
  body.innerHTML = `
    <p class="step-msg">
      Ollama responded but the API isn't ready.<br>
      Try restarting it: <code class="cmd">ollama serve</code>
    </p>
    <div class="step-actions">
      <button class="action-btn" id="retry-2">Retry</button>
    </div>
  `;
  return new Promise(resolve => {
    document.getElementById('retry-2').addEventListener('click', resolve, { once: true });
  });
}

function renderStep3Failure() {
  const body = document.querySelector('#step-3 .step-body');
  body.innerHTML = `
    <p class="step-msg">
      Model <code class="cmd">${TARGET_MODEL}</code> isn't available locally.
      Pull it now (~2 GB download) or click Retry if you've already pulled it elsewhere.
    </p>
    <div class="step-actions">
      <button class="action-btn primary" id="pull-btn">Pull Model</button>
      <button class="action-btn" id="retry-3">Retry</button>
    </div>
    <div class="progress-wrap" id="pull-progress" hidden>
      <div class="progress-track"><div id="progress-bar"></div></div>
      <span id="progress-label">Starting download…</span>
    </div>
  `;

  return new Promise((resolve) => {
    document.getElementById('retry-3').addEventListener('click', resolve, { once: true });

    document.getElementById('pull-btn').addEventListener('click', async () => {
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
  const res = await fetch(`${OLLAMA_BASE}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: TARGET_MODEL, stream: true }),
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

// ─── Live Ollama status (main view) ───────────────────────────────────────

async function pingOllama() {
  try {
    await fetch('http://127.0.0.1:11434/', { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

function applyOllamaStatus(online) {
  const badge    = document.getElementById('ollama-badge');
  const dot      = badge?.querySelector('.status-dot');
  const text     = document.getElementById('ollama-badge-text');
  const desc     = document.getElementById('ollama-desc');
  const hint     = document.getElementById('ollama-offline-hint');
  if (!badge) return;

  badge.className = 'status-badge ' + (online ? 'on' : 'off');
  text.textContent = online ? 'Online' : 'Offline';
  desc.textContent = online ? 'Local model ready' : 'Not running';
  hint.hidden = online;
}

function startOllamaPolling() {
  let lastState = null;

  async function tick() {
    const online = await pingOllama();
    if (online !== lastState) {
      lastState = online;
      applyOllamaStatus(online);
    }
  }

  tick();
  return setInterval(tick, 5000);
}

// ─── Main view (existing toggle logic) ────────────────────────────────────

async function initMainView() {
  startOllamaPolling();

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

  // Actual per-domain state, kept separate from the toggle's visual state
  let siteEnabledForDomain = true;

  function updateUI() {
    const globalOn = globalToggle.checked;
    // When global is off: site toggle appears off and is non-interactive
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
