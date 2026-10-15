// GmeetStayer — Content Script (v1.1)
// Injected into Google Meet pages.
// Features:
//   1. Auto-dismiss "you're alone" dialogs (Stay in Meet)
//   2. Auto-open chat panel & monitor for Google Form/Service links

(function GmeetStayer() {
  'use strict';

  let isEnabled = true;
  let isChatMonitorEnabled = true;
  let observer = null;
  let chatObserver = null;
  let intervalId = null;
  const openedLinksThisSession = new Set();

  // ═══════════════════════════════════════════════════
  //  PART 1: STAY-IN-MEET (Auto-dismiss alone dialogs)
  // ═══════════════════════════════════════════════════

  // ─── Button texts specifically for "Stay" ───
  const STAY_BUTTON_TEXTS = [
    'stay here',
    'stay in the call',
    'stay in call',
    'stay',
    'tetap di sini',
    'tetap di panggilan',
    'tetap berada di sini',
    'tetap berada di panggilan',
    'tetap',
    'saya masih di sini',
    'masih di sini',
    'quedarme',
    'permanecer en la llamada',
    'rester dans l\'appel',
    'rester',
    'im anruf bleiben',
    'bleiben',
    'continuar na chamada',
    'ficar',
    '通話を続ける',
    '통화 유지',
  ];

  // ─── Blacklist: NEVER click these buttons! ───
  const LEAVE_BUTTON_BLACKLIST = [
    'leave', 'keluar', 'end', 'akhiri', 'hang up', 'close', 'tutup',
    'cancel', 'batal', 'leave call', 'leave now', 'keluar sekarang',
    'keluar dari panggilan', 'akhiri panggilan', 'end call'
  ];

  // ─── Dialog warning texts indicating idle/alone timeout ───
  const ALONE_DIALOG_TEXTS = [
    'are you still here',
    'are you still there',
    'you\'re the only one here',
    'call will end in',
    'this call will end',
    'left the meeting alone',
    'ending in',
    'ending soon',
    'apakah anda masih di sini',
    'apakah anda masih ada di sini',
    'panggilan ini akan segera berakhir',
    'panggilan akan berakhir',
    'anda satu-satunya orang di sini',
    'anda sendirian di sini',
    'hanya anda yang ada di panggilan ini',
    'berakhir dalam',
    'akan berakhir dalam',
  ];

  function normalize(text) {
    return (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function isLeaveButton(element) {
    if (!element) return false;
    const text = normalize(element.textContent);
    const ariaLabel = normalize(element.getAttribute('aria-label') || '');
    return LEAVE_BUTTON_BLACKLIST.some(
      (badWord) => text === badWord || ariaLabel === badWord || text.includes(badWord) || ariaLabel.includes(badWord)
    );
  }

  function isAloneDialog(element) {
    if (!element) return false;
    const text = normalize(element.textContent);
    return ALONE_DIALOG_TEXTS.some((pattern) => text.includes(pattern));
  }

  /**
   * Safe click function that dispatches full pointer + mouse events to bypass
   * Google Meet's Material Web Component event blockers.
   */
  function simulateSafeClick(element) {
    if (!element) return;
    const eventOptions = { bubbles: true, cancelable: true, view: window };
    element.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
    element.dispatchEvent(new MouseEvent('mousedown', eventOptions));
    element.dispatchEvent(new PointerEvent('pointerup', eventOptions));
    element.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    element.click();

    // Also trigger on inner span/div if present
    const innerTextSpan = element.querySelector('span, [class*="vQzf8d"]');
    if (innerTextSpan) {
      innerTextSpan.click();
    }
  }

  /**
   * Find the actual "Stay" button inside a verified dialog container.
   * Explicitly avoids any leave/cancel buttons!
   */
  function findStayButton(dialogContainer) {
    const candidates = dialogContainer.querySelectorAll(
      'button, [role="button"], [data-mdc-dialog-action], [class*="VfPpkd-LgbsSe"]'
    );

    for (const el of candidates) {
      if (isLeaveButton(el)) continue;

      const text = normalize(el.textContent);
      const ariaLabel = normalize(el.getAttribute('aria-label') || '');

      // 1. Exact match
      for (const pattern of STAY_BUTTON_TEXTS) {
        if (text === pattern || ariaLabel === pattern) {
          return el;
        }
      }

      // 2. Inclusion match (only patterns with length >= 4)
      for (const pattern of STAY_BUTTON_TEXTS) {
        if (pattern.length >= 4 && (text.includes(pattern) || ariaLabel.includes(pattern))) {
          return el;
        }
      }
    }

    return null;
  }

  let lastDismissTime = 0;

  function scanAndDismiss() {
    if (!isEnabled) return;

    const now = Date.now();
    if (now - lastDismissTime < 3000) return;

    // Search across modal/dialog containers including Google Material 3 overlays
    const dialogSelectors = [
      '[role="dialog"]',
      '[role="alertdialog"]',
      'div[data-mdc-dialog-action]',
      '.m3-dialog',
      'div[class*="VfPpkd-P5QLlc"]',
      'div[class*="g3VIbe"]',
      'div[class*="XfpsVe"]',
    ];

    let foundDialog = null;
    const dialogs = document.querySelectorAll(dialogSelectors.join(', '));
    for (const dialog of dialogs) {
      if (isAloneDialog(dialog)) {
        foundDialog = dialog;
        break;
      }
    }

    // Fallback: search for any overlay container that contains timeout warning text
    if (!foundDialog) {
      const allDivs = document.querySelectorAll('div[tabindex="-1"], div[style*="z-index"]');
      for (const div of allDivs) {
        if (div.offsetWidth > 150 && div.offsetHeight > 80 && isAloneDialog(div)) {
          // Verify it's not the main meeting grid or chat
          if (!div.closest('[role="toolbar"]') && !div.closest('[role="log"]')) {
            foundDialog = div;
            break;
          }
        }
      }
    }

    if (foundDialog) {
      const stayButton = findStayButton(foundDialog);
      if (stayButton) {
        lastDismissTime = now;
        console.log('[GmeetStayer] 🛡️ SAFE CLICK: "Stay" button confirmed in dialog!', stayButton);

        // Visual indicator
        stayButton.style.border = '3px solid #4ade80';
        stayButton.style.backgroundColor = 'rgba(74, 222, 128, 0.2)';

        // Click with full event chain
        simulateSafeClick(stayButton);

        chrome.runtime.sendMessage({ type: 'DIALOG_DISMISSED' }, () => {
          if (chrome.runtime.lastError) {}
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════
  //  PART 2: CHAT MONITOR (Auto-open chat + detect links)
  // ═══════════════════════════════════════════════════

  // Google service link patterns to detect in chat
  const GOOGLE_LINK_PATTERNS = [
    /https?:\/\/forms\.gle\/[\w-]+/gi,
    /https?:\/\/docs\.google\.com\/forms\/[\w/?.=&-]+/gi,
    /https?:\/\/docs\.google\.com\/document\/[\w/?.=&-]+/gi,
    /https?:\/\/docs\.google\.com\/spreadsheets\/[\w/?.=&-]+/gi,
    /https?:\/\/docs\.google\.com\/presentation\/[\w/?.=&-]+/gi,
    /https?:\/\/drive\.google\.com\/[\w/?.=&-]+/gi,
  ];

  /**
   * Try to auto-open the Meet chat panel.
   * Looks for the chat button in the bottom toolbar and clicks it if chat isn't open.
   */
  function autoOpenChatPanel() {
    if (!isChatMonitorEnabled) return;

    // Check if chat panel is already open
    const chatPanel = document.querySelector(
      '[aria-label*="chat" i], [aria-label*="pesan" i], [aria-label*="message" i]'
    );

    // Look for the chat panel container (side panel with messages)
    const existingPanel = document.querySelector(
      '[data-panel-id="2"], [aria-live="polite"][role="log"]'
    );
    if (existingPanel && existingPanel.offsetHeight > 0) {
      console.log('[GmeetStayer] 💬 Chat panel already open.');
      startChatObserver();
      return;
    }

    // Find the chat button in the toolbar
    const chatButtons = document.querySelectorAll('button, [role="button"]');
    for (const btn of chatButtons) {
      if (isLeaveButton(btn)) continue;

      const ariaLabel = normalize(btn.getAttribute('aria-label') || '');
      const tooltip = normalize(btn.getAttribute('data-tooltip') || '');
      const combined = ariaLabel + ' ' + tooltip;

      if (
        combined.includes('chat') ||
        combined.includes('pesan') ||
        combined.includes('message') ||
        combined.includes('chat with everyone')
      ) {
        // Check if it's a toolbar button (not a small button inside chat panel)
        if (btn.closest('[role="toolbar"]') || btn.closest('[class*="toolbar" i]') || btn.offsetWidth > 30) {
          console.log('[GmeetStayer] 💬 Opening chat panel...');
          btn.click();
          // Wait for panel to render, then start observing
          setTimeout(startChatObserver, 1500);
          return;
        }
      }
    }

    // Retry after a delay if button not found yet (Meet might still be loading)
    console.log('[GmeetStayer] 💬 Chat button not found yet, retrying in 3s...');
    setTimeout(autoOpenChatPanel, 3000);
  }

  /**
   * Start a MutationObserver on the chat panel to detect new messages with links.
   */
  function startChatObserver() {
    if (chatObserver) return;
    if (!isChatMonitorEnabled) return;

    // Find the chat messages container
    // Google Meet chat messages are typically in a scrollable container
    const chatContainer =
      document.querySelector('[role="log"]') ||
      document.querySelector('[aria-live="polite"]') ||
      document.querySelector('[data-panel-id="2"]');

    if (!chatContainer) {
      console.log('[GmeetStayer] 💬 Chat container not found, retrying in 2s...');
      setTimeout(startChatObserver, 2000);
      return;
    }

    // Scan existing messages first
    scanChatForLinks(chatContainer);

    chatObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            scanChatForLinks(node);
          }
        }
      }
    });

    chatObserver.observe(chatContainer, {
      childList: true,
      subtree: true,
    });

    console.log('[GmeetStayer] 💬 Chat observer active — monitoring for Google links.');
  }

  /**
   * Scan a DOM element (chat container or new message node) for Google service links.
   */
  function scanChatForLinks(element) {
    if (!isChatMonitorEnabled) return;

    // Method 1: Find <a> tags with Google service URLs
    const anchors = element.querySelectorAll('a[href]');
    for (const a of anchors) {
      const href = a.href;
      if (isGoogleServiceLink(href)) {
        openLinkIfNew(href);
      }
    }

    // Method 2: Scan raw text for URL patterns (in case links aren't auto-linked)
    const textContent = element.textContent || '';
    for (const pattern of GOOGLE_LINK_PATTERNS) {
      const matches = textContent.match(pattern);
      if (matches) {
        for (const url of matches) {
          openLinkIfNew(url);
        }
      }
    }
  }

  /**
   * Check if a URL is a Google service link we care about.
   */
  function isGoogleServiceLink(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return (
      lower.includes('forms.gle/') ||
      lower.includes('docs.google.com/forms/') ||
      lower.includes('docs.google.com/document/') ||
      lower.includes('docs.google.com/spreadsheets/') ||
      lower.includes('docs.google.com/presentation/') ||
      lower.includes('drive.google.com/')
    );
  }

  /**
   * Open a link via background.js if it hasn't been opened in this session.
   */
  function openLinkIfNew(url) {
    // Clean URL (remove trailing whitespace/punctuation)
    url = url.replace(/[\s.,;!?)]+$/, '');

    if (openedLinksThisSession.has(url)) return;
    openedLinksThisSession.add(url);

    console.log(`[GmeetStayer] 🔗 Google link detected in chat: ${url}`);

    chrome.runtime.sendMessage({ type: 'OPEN_FORM_LINK', url }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response?.success) {
        console.log(`[GmeetStayer] ✅ Opened: ${url}`);
      } else {
        console.log(`[GmeetStayer] ⏭️ Already opened: ${url}`);
      }
    });
  }

  // ═══════════════════════════════════════════════════
  //  INITIALIZATION
  // ═══════════════════════════════════════════════════

  // Load initial state
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response) {
      isEnabled = response.enabled;
      isChatMonitorEnabled = response.chatMonitorEnabled;
      // Load already-opened links into session memory
      if (response.openedLinks) {
        response.openedLinks.forEach((url) => openedLinksThisSession.add(url));
      }
    }
  });

  // Listen for state changes
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATE_CHANGED') {
      isEnabled = message.enabled;
      console.log(`[GmeetStayer] ${isEnabled ? '✅ Enabled' : '⏸️ Disabled'}`);
    }
    if (message.type === 'CHAT_MONITOR_CHANGED') {
      isChatMonitorEnabled = message.enabled;
      console.log(`[GmeetStayer] Chat Monitor: ${isChatMonitorEnabled ? '✅ ON' : '⏸️ OFF'}`);
      if (isChatMonitorEnabled) {
        autoOpenChatPanel();
      }
    }
  });

  // Start main observer for "alone" dialogs
  function startMainObserver() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      const hasNewNodes = mutations.some((m) => m.addedNodes.length > 0);
      if (hasNewNodes) {
        setTimeout(scanAndDismiss, 300);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    console.log('[GmeetStayer] 👀 Main MutationObserver active.');
  }

  function startPeriodicScan() {
    if (intervalId) return;
    intervalId = setInterval(scanAndDismiss, 1500);
  }

  function init() {
    console.log('[GmeetStayer] 🚀 v1.1 Initialized on', window.location.href);
    startMainObserver();
    startPeriodicScan();
    setTimeout(scanAndDismiss, 2000);

    // Auto-open chat panel after a delay (let Meet finish loading)
    setTimeout(autoOpenChatPanel, 5000);
  }

  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
