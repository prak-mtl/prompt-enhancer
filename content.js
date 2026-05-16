let activeElement = null;
let enhanceButton = null;
let toneMenu = null;
let elementResizeObserver = null;
let rafScheduled = false;
let contextAlive = true;

function isContextValid() {
    try { return !!chrome.runtime?.id; } catch { return false; }
}

function teardown() {
    contextAlive = false;
    detachResizeObserver();
    if (enhanceButton) { enhanceButton.remove(); enhanceButton = null; }
    if (toneMenu)      { toneMenu.remove();      toneMenu = null; }
    activeElement = null;
}

const TONES = ["Basic", "Professional", "Casual", "Friendly", "Polite", "Technical", "Creative", "Emojified"];

async function init() {
    createEnhanceButton();
    createToneMenu();

    const enabled = await checkEnabledStatus();

    // If a textarea is already focused when the script (re)loads, pick it up immediately
    if (enabled) tryAdoptFocusedElement();

    // Self-healing: re-attach buttons if the SPA wiped them from the DOM.
    // Only checks DOM presence — no chrome.storage call on every mutation.
    let mutationDebounce = null;
    const observer = new MutationObserver(() => {
        if (!contextAlive) { observer.disconnect(); return; }
        clearTimeout(mutationDebounce);
        mutationDebounce = setTimeout(() => {
            if (!contextAlive) return;
            if (enhanceButton && !document.getElementById('ai-prompt-enhancer-btn')) {
                document.body.appendChild(enhanceButton);
                document.body.appendChild(toneMenu);
            }
            if (activeElement) schedulePosition();
        }, 150);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setupEventListeners();

    if (isContextValid()) {
        chrome.runtime.onMessage.addListener((msg) => {
            if (msg.action === "refresh_state") checkEnabledStatus();
        });
    }
}

function tryAdoptFocusedElement() {
    const el = document.activeElement;
    if (el && (el.tagName === 'TEXTAREA' || el.isContentEditable || el.id === 'prompt-textarea')) {
        activeElement = el;
        attachResizeObserver(el);
        requestAnimationFrame(() => positionUI());
    }
}

function createEnhanceButton() {
    enhanceButton = document.createElement('button');
    enhanceButton.id = 'ai-prompt-enhancer-btn';
    enhanceButton.innerHTML = '✨ Enhance';
    enhanceButton.style.display = 'none';
    document.body.appendChild(enhanceButton);

    enhanceButton.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleToneMenu();
    });
}

function createToneMenu() {
    toneMenu = document.createElement('div');
    toneMenu.id = 'ai-tone-selector';
    toneMenu.style.display = 'none';
    
    TONES.forEach(tone => {
        const item = document.createElement('div');
        item.className = 'tone-item';
        item.innerText = tone;
        item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            processEnhancement(tone);
        });
        toneMenu.appendChild(item);
    });
    document.body.appendChild(toneMenu);
}

function toggleToneMenu() {
    const isVisible = toneMenu.style.display === 'flex';
    toneMenu.style.display = isVisible ? 'none' : 'flex';
    if (!isVisible) schedulePosition();
}

function positionUI() {
    if (!activeElement) return;
    const rect = activeElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const btnW = enhanceButton.offsetWidth || 110;
    const btnH = enhanceButton.offsetHeight || 34;
    const pad  = 8;

    // Visible slice of the element clipped to the viewport
    const visTop    = Math.max(rect.top,    0);
    const visBottom = Math.min(rect.bottom, window.innerHeight);
    const visLeft   = Math.max(rect.left,   0);
    const visRight  = Math.min(rect.right,  window.innerWidth);

    const visH = visBottom - visTop;
    const visW = visRight  - visLeft;

    // Element is entirely off-screen or too narrow to fit the button — hide and bail
    if (visH < 4 || visW < btnW + pad) {
        enhanceButton.style.display = 'none';
        return;
    }

    // Single-line / short elements (< 80px): center vertically.
    // Tall textareas: anchor to bottom-right so the button stays near the cursor.
    const top  = visH < 80
        ? visTop + Math.max(0, Math.round((visH - btnH) / 2))
        : Math.max(visTop + pad, visBottom - btnH - pad);
    const left = Math.max(visLeft + pad, visRight - btnW - pad);

    enhanceButton.style.top  = `${top}px`;
    enhanceButton.style.left = `${left}px`;
    enhanceButton.style.display = 'flex';

    // Tone menu: prefer opening above the button; flip below if no room
    const menuH = toneMenu.offsetHeight || 250;
    const menuW = toneMenu.offsetWidth  || 150;
    let menuTop  = top - menuH - 4;
    let menuLeft = Math.max(visLeft + pad, Math.min(left, window.innerWidth - menuW - pad));

    if (menuTop < pad) menuTop = visBottom + 4;

    toneMenu.style.top    = `${menuTop}px`;
    toneMenu.style.left   = `${menuLeft}px`;
    toneMenu.style.bottom = 'auto';
}

function schedulePosition() {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
        positionUI();
        rafScheduled = false;
    });
}

function attachResizeObserver(el) {
    if (elementResizeObserver) elementResizeObserver.disconnect();
    elementResizeObserver = new ResizeObserver(schedulePosition);
    elementResizeObserver.observe(el);
}

function detachResizeObserver() {
    if (elementResizeObserver) {
        elementResizeObserver.disconnect();
        elementResizeObserver = null;
    }
}

function getTargetContent() {
    let text = "";
    let isSelection = false;
    if (activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT') {
        const start = activeElement.selectionStart;
        const end = activeElement.selectionEnd;
        if (start !== end) {
            text = activeElement.value.substring(start, end);
            isSelection = true;
        } else {
            text = activeElement.value;
        }
    } else if (activeElement.isContentEditable) {
        const selection = window.getSelection();
        if (selection.toString().length > 0) {
            text = selection.toString();
            isSelection = true;
        } else {
            text = activeElement.innerText;
        }
    }
    return { text, isSelection };
}

async function processEnhancement(tone) {
    const { text, isSelection } = getTargetContent();
    if (!text.trim()) return;

    toneMenu.style.display = 'none';
    enhanceButton.innerHTML = '⏳...';

    if (!isContextValid()) { teardown(); return; }
    try {
        chrome.runtime.sendMessage({ action: "enhance_prompt", text, tone }, (response) => {
            try {
                if (chrome.runtime.lastError) return; // tab closed / context gone mid-flight
                if (response?.success) {
                    applyResult(response.text, isSelection);
                    if (enhanceButton) enhanceButton.innerHTML = '✨ Enhance';
                } else {
                    const isOffline = response?.error === 'ollama_offline';
                    if (enhanceButton) {
                        enhanceButton.innerHTML = isOffline ? '⚠️ Ollama offline' : '⚠️ Failed — retry';
                        setTimeout(() => {
                            try {
                                if (enhanceButton) enhanceButton.innerHTML = '✨ Enhance';
                            } catch { /* context gone before timeout fired */ }
                        }, 3000);
                    }
                }
            } catch { /* extension reloaded while LLM call was in flight */ }
        });
    } catch {
        teardown();
    }
}

function applyResult(newText, isSelection) {
    if (!activeElement || !isContextValid()) return;
    activeElement.focus();

    if (activeElement.isContentEditable) {
        if (!isSelection) activeElement.innerHTML = ""; 
        document.execCommand('insertText', false, newText);
    } else {
        if (isSelection) {
            const start = activeElement.selectionStart;
            const end = activeElement.selectionEnd;
            const val = activeElement.value;
            activeElement.value = val.slice(0, start) + newText + val.slice(end);
        } else {
            activeElement.value = newText;
        }
    }
    activeElement.dispatchEvent(new Event('input', { bubbles: true }));
}

function setupEventListeners() {
    document.addEventListener('focusin', async (e) => {
        if (!contextAlive) return;
        try {
            if (!(await checkEnabledStatus())) return;
            if (e.target.tagName === 'TEXTAREA' || e.target.isContentEditable || e.target.id === 'prompt-textarea') {
                activeElement = e.target;
                attachResizeObserver(activeElement);
                requestAnimationFrame(() => positionUI());
            }
        } catch { teardown(); }
    });

    document.addEventListener('mousedown', (e) => {
        if (!contextAlive) return;
        if (toneMenu?.style.display === 'flex') {
            if (!toneMenu.contains(e.target) && !enhanceButton.contains(e.target)) {
                toneMenu.style.display = 'none';
            }
        }
        if (activeElement && !activeElement.contains(e.target) && !enhanceButton?.contains(e.target) && !toneMenu?.contains(e.target)) {
            enhanceButton.style.display = 'none';
            toneMenu.style.display = 'none';
            detachResizeObserver();
            activeElement = null;
        }
    });

    const guardedSchedule = () => { if (contextAlive) schedulePosition(); };
    window.addEventListener('scroll', guardedSchedule, { capture: true, passive: true });
    window.addEventListener('resize', guardedSchedule, { passive: true });
}

async function checkEnabledStatus() {
    if (!isContextValid()) { teardown(); return false; }
    try {
        const res = await chrome.storage.local.get(['disabled', 'disabledDomains']);
        const domain = window.location.hostname;
        const isHidden = res.disabled || (res.disabledDomains && res.disabledDomains.includes(domain));
        if (isHidden) {
            if (enhanceButton) enhanceButton.style.display = 'none';
            if (toneMenu) toneMenu.style.display = 'none';
            detachResizeObserver();
            activeElement = null;
            return false;
        }
        // Re-enabled: restore button if we already have an active element,
        // otherwise try to pick up whatever is currently focused.
        if (activeElement) {
            schedulePosition();
        } else {
            tryAdoptFocusedElement();
        }
        return true;
    } catch {
        teardown();
        return false;
    }
}

init().catch(teardown);

// Sync the toolbar icon with the OS color scheme.
// Content scripts can't call chrome.action directly, so we message the background.
function syncIconToTheme() {
  if (!isContextValid()) return;
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  chrome.runtime.sendMessage({ action: 'update_icon_theme', isDark }).catch(() => {});
}

syncIconToTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncIconToTheme);