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
  const systemInstruction = `
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

  try {
    const response = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2:3b',
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userPayload },
        ],
        stream: false,
        options: { temperature: 0.7 },
      }),
    });

    if (!response.ok) throw new Error(`Ollama Error: ${response.statusText}`);

    const data = await response.json();
    return data.message.content.trim();
  } catch (err) {
    throw new Error(err instanceof TypeError ? 'ollama_offline' : 'enhancement_failed');
  }
}
