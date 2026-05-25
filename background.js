// ─── API config (single source of truth, mirrored in popup.js) ────────────

const DEFAULT_API_ENDPOINT = 'http://127.0.0.1:11434';
const DEFAULT_API_MODEL    = 'llama3.2:3b';

async function getApiConfig() {
  const {
    apiEndpoint = DEFAULT_API_ENDPOINT,
    apiUsername = '',
    apiPassword = '',
    apiModel    = DEFAULT_API_MODEL,
  } = await chrome.storage.local.get(['apiEndpoint', 'apiUsername', 'apiPassword', 'apiModel']);

  return {
    endpoint: apiEndpoint.replace(/\/+$/, ''),
    username: apiUsername,
    password: apiPassword,
    model: apiModel,
  };
}

function buildAuthHeaders(cfg) {
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.username || cfg.password) {
    headers['Authorization'] = 'Basic ' + btoa(`${cfg.username}:${cfg.password}`);
  }
  return headers;
}

// ─── Strip browser-only headers proxies often reject (Caddy/nginx WAFs) ───

const API_HEADER_RULE_ID = 1001;

async function updateApiHeaderRules() {
  try {
    const cfg = await getApiConfig();
    let urlFilter = '||example.invalid^';
    try {
      const u = new URL(cfg.endpoint);
      urlFilter = `||${u.host}^`;
    } catch { /* keep no-op filter */ }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [API_HEADER_RULE_ID],
      addRules: [{
        id: API_HEADER_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'origin',             operation: 'remove' },
            { header: 'sec-fetch-mode',     operation: 'remove' },
            { header: 'sec-fetch-site',     operation: 'remove' },
            { header: 'sec-fetch-dest',     operation: 'remove' },
            { header: 'sec-fetch-user',     operation: 'remove' },
            { header: 'sec-ch-ua',          operation: 'remove' },
            { header: 'sec-ch-ua-mobile',   operation: 'remove' },
            { header: 'sec-ch-ua-platform', operation: 'remove' },
          ],
        },
        condition: {
          urlFilter,
          resourceTypes: ['xmlhttprequest'],
        },
      }],
    });
    console.log('[prompt-enhancer] header-stripping rule installed for', urlFilter);
  } catch (err) {
    console.warn('[prompt-enhancer] updateApiHeaderRules failed:', err);
  }
}

chrome.runtime.onStartup.addListener(updateApiHeaderRules);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.apiEndpoint) {
    updateApiHeaderRules();
  }
});

// ─── Icon theme helper (service worker — uses OffscreenCanvas, no DOM) ────

async function setIconForTheme(isDark) {
  const path = isDark ? 'icons/favicon_light.png' : 'icons/favicon_dark.png';
  const url = chrome.runtime.getURL(path);
  const blob = await fetch(url).then(r => r.blob());
  const bitmap = await createImageBitmap(blob);
  const size = 128;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, size, size);
  await chrome.action.setIcon({ imageData: ctx.getImageData(0, 0, size, size) });
}

// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await chrome.storage.local.set({ setupComplete: false });
  }
  await updateApiHeaderRules();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'enhance_prompt') {
    handlePromptEnhancement(request.text, request.tone)
      .then(enhancedText => sendResponse({ success: true, text: enhancedText }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'update_icon_theme') {
    setIconForTheme(request.isDark).catch(() => {});
  }
});

async function handlePromptEnhancement(originalText, tone) {
  const systemInstruction = tone === "Basic"
    ? `You are a light-touch editor. Fix grammar, spelling, and clarity issues in the user's input. Keep the wording, tone, and length as close to the original as possible. Do NOT restructure the prompt, do NOT add sections, headings, examples, role definitions, or extra context. Do NOT answer the prompt — only return the corrected version of the user's text.`
    : `
    Act as an expert Prompt Architect.
    Your task is to transform a user's raw, unstructured input into a high-quality, structured AI prompt.

    Rules:
    1. Maintain the user's original intent.
    2. Apply a ${tone.toUpperCase()} tone consistently.
    3. Use a clear structure (e.g., Role, Task, Context, Constraints, or Output Format).
    4. Add specificity to vague requests to ensure the AI provides a better result.
    5. DO NOT provide the answer to the prompt; only provide the enhanced PROMPT itself.
  `;

  const userPayload = `Tone: ${tone}. Input: ${originalText}`;

  const cfg = await getApiConfig();
  const url = `${cfg.endpoint}/api/chat`;
  const headers = buildAuthHeaders(cfg);

  // Diagnostic log (visible in chrome://extensions → service worker inspect)
  console.log('[prompt-enhancer] POST', url, {
    model: cfg.model,
    hasAuth: !!headers.Authorization,
    user: cfg.username,
    passLen: cfg.password.length,
  });

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      credentials: 'omit',
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userPayload },
        ],
        stream: false,
        options: { temperature: 0.7 },
      }),
    });
  } catch (err) {
    console.error('[prompt-enhancer] fetch network failure:', err);
    throw new Error('ollama_offline');
  }

  if (response.ok) {
    const data = await response.json();
    return data.message.content.trim();
  }

  // Non-OK — capture body for diagnostics
  const bodyText = await response.text().catch(() => '');
  console.error('[prompt-enhancer] non-OK from /api/chat', {
    status: response.status,
    statusText: response.statusText,
    body: bodyText.slice(0, 400),
    wwwAuth: response.headers.get('www-authenticate'),
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error('auth_failed');
  }
  throw new Error('enhancement_failed');
}
