// GmeetStayer — Background Service Worker (v1.1)
// Manages state, link dedup, tab creation, and Gemini API proxy.

const DEFAULT_STATE = {
  enabled: true,
  chatMonitorEnabled: true,
  autoFillEnabled: true,
  autoSubmit: false,
  geminiApiKey: '',
  saveCount: 0,
  formsOpened: 0,
  lastSaved: null,
  lastFormOpened: null,
  profile: {
    name: '',
    email: '',
    nim: '',
    phone: '',
    institution: '',
  },
  openedLinks: [],   // history of opened links
  linkMemory: {},     // tabId → Set of opened URLs for dedup
};

// ─── Initialize storage on install ───
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(null, (result) => {
    const updates = {};
    for (const [key, defaultVal] of Object.entries(DEFAULT_STATE)) {
      if (result[key] === undefined) {
        updates[key] = defaultVal;
      }
    }
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  });
});

// ─── Message Handler ───
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {

    // ── Stay-in-Meet dialog dismissed ──
    case 'DIALOG_DISMISSED': {
      chrome.storage.local.get(['saveCount'], (result) => {
        const newCount = (result.saveCount || 0) + 1;
        const now = new Date().toISOString();
        chrome.storage.local.set({ saveCount: newCount, lastSaved: now });
        sendResponse({ success: true, saveCount: newCount, lastSaved: now });
      });
      return true;
    }

    // ── Get full state ──
    case 'GET_STATE': {
      chrome.storage.local.get(null, (result) => {
        sendResponse({
          enabled: result.enabled ?? DEFAULT_STATE.enabled,
          chatMonitorEnabled: result.chatMonitorEnabled ?? DEFAULT_STATE.chatMonitorEnabled,
          autoFillEnabled: result.autoFillEnabled ?? DEFAULT_STATE.autoFillEnabled,
          autoSubmit: result.autoSubmit ?? DEFAULT_STATE.autoSubmit,
          geminiApiKey: result.geminiApiKey ?? '',
          saveCount: result.saveCount ?? 0,
          formsOpened: result.formsOpened ?? 0,
          lastSaved: result.lastSaved ?? null,
          lastFormOpened: result.lastFormOpened ?? null,
          profile: result.profile ?? DEFAULT_STATE.profile,
          openedLinks: result.openedLinks ?? [],
        });
      });
      return true;
    }

    // ── Toggle enabled/disabled ──
    case 'SET_ENABLED': {
      chrome.storage.local.set({ enabled: message.enabled }, () => {
        broadcastToMeetTabs({ type: 'STATE_CHANGED', enabled: message.enabled });
        sendResponse({ success: true });
      });
      return true;
    }

    // ── Toggle chat monitor ──
    case 'SET_CHAT_MONITOR': {
      chrome.storage.local.set({ chatMonitorEnabled: message.enabled }, () => {
        broadcastToMeetTabs({ type: 'CHAT_MONITOR_CHANGED', enabled: message.enabled });
        sendResponse({ success: true });
      });
      return true;
    }

    // ── Toggle auto-fill ──
    case 'SET_AUTO_FILL': {
      chrome.storage.local.set({ autoFillEnabled: message.enabled }, () => {
        sendResponse({ success: true });
      });
      return true;
    }

    // ── Toggle auto-submit ──
    case 'SET_AUTO_SUBMIT': {
      chrome.storage.local.set({ autoSubmit: message.enabled }, () => {
        sendResponse({ success: true });
      });
      return true;
    }

    // ── Save Gemini API Key ──
    case 'SET_GEMINI_KEY': {
      chrome.storage.local.set({ geminiApiKey: message.key }, () => {
        sendResponse({ success: true });
      });
      return true;
    }

    // ── Save profile ──
    case 'SAVE_PROFILE': {
      chrome.storage.local.set({ profile: message.profile }, () => {
        sendResponse({ success: true });
      });
      return true;
    }

    // ── Open a Google Form/Service link from chat ──
    case 'OPEN_FORM_LINK': {
      const url = message.url;
      chrome.storage.local.get(['openedLinks', 'formsOpened'], (result) => {
        const openedLinks = result.openedLinks || [];
        // Dedup: check if already opened
        if (openedLinks.includes(url)) {
          sendResponse({ success: false, reason: 'already_opened' });
          return;
        }
        // Open the tab (active = true, focused)
        chrome.tabs.create({ url, active: true }, () => {
          openedLinks.push(url);
          const formsOpened = (result.formsOpened || 0) + 1;
          chrome.storage.local.set({
            openedLinks,
            formsOpened,
            lastFormOpened: new Date().toISOString(),
          });
          sendResponse({ success: true });
        });
      });
      return true;
    }

    // ── Gemini API proxy ──
    case 'GEMINI_REQUEST': {
      chrome.storage.local.get(['geminiApiKey'], async (result) => {
        const apiKey = result.geminiApiKey;
        if (!apiKey) {
          sendResponse({ success: false, error: 'No Gemini API key configured.' });
          return;
        }
        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  parts: [{ text: message.prompt }],
                }],
                generationConfig: {
                  temperature: 0.4,
                  maxOutputTokens: 2048,
                },
              }),
            }
          );
          const data = await response.json();
          if (data.error) {
            sendResponse({ success: false, error: data.error.message });
          } else {
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            sendResponse({ success: true, text });
          }
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      });
      return true;
    }

    // ── Reset statistics ──
    case 'RESET_STATS': {
      chrome.storage.local.set({
        saveCount: 0,
        formsOpened: 0,
        lastSaved: null,
        lastFormOpened: null,
        openedLinks: [],
      }, () => {
        sendResponse({ success: true });
      });
      return true;
    }
  }
});

// ─── Broadcast to all Google Meet tabs ───
function broadcastToMeetTabs(message) {
  chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  });
}
