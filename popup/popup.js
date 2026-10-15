// GmeetStayer — Popup Script (v1.1)
// Handles tabs, toggles, profile management, API key, and stats.

document.addEventListener('DOMContentLoaded', () => {
  // ─── DOM Elements ───
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  const toggleSwitch = document.getElementById('toggleSwitch');
  const statusDot = document.getElementById('statusDot');
  const statusLabel = document.getElementById('statusLabel');
  const statusDesc = document.getElementById('statusDesc');

  const chatMonitorToggle = document.getElementById('chatMonitorToggle');
  const autoFillToggle = document.getElementById('autoFillToggle');
  const autoSubmitToggle = document.getElementById('autoSubmitToggle');

  const saveCountEl = document.getElementById('saveCount');
  const formsOpenedEl = document.getElementById('formsOpened');
  const linkHistoryEl = document.getElementById('linkHistory');

  const profileName = document.getElementById('profileName');
  const profileEmail = document.getElementById('profileEmail');
  const profileNim = document.getElementById('profileNim');
  const profilePhone = document.getElementById('profilePhone');
  const profileInstitution = document.getElementById('profileInstitution');
  const saveProfileBtn = document.getElementById('saveProfileBtn');

  const geminiKey = document.getElementById('geminiKey');
  const toggleKeyVisibility = document.getElementById('toggleKeyVisibility');
  const saveKeyBtn = document.getElementById('saveKeyBtn');

  const resetBtn = document.getElementById('resetBtn');

  // ─── Tab Switching ───
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;

      tabBtns.forEach((b) => b.classList.remove('active'));
      tabContents.forEach((c) => c.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(`tab-${targetTab}`).classList.add('active');
    });
  });

  // ─── Load State ───
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
    if (chrome.runtime.lastError || !response) return;

    // Toggles
    toggleSwitch.checked = response.enabled;
    updateStatusUI(response.enabled);
    chatMonitorToggle.checked = response.chatMonitorEnabled;
    autoFillToggle.checked = response.autoFillEnabled;
    autoSubmitToggle.checked = response.autoSubmit;

    // Stats
    saveCountEl.textContent = response.saveCount || 0;
    formsOpenedEl.textContent = response.formsOpened || 0;

    // Link history
    renderLinkHistory(response.openedLinks || []);

    // Profile
    if (response.profile) {
      profileName.value = response.profile.name || '';
      profileEmail.value = response.profile.email || '';
      profileNim.value = response.profile.nim || '';
      profilePhone.value = response.profile.phone || '';
      profileInstitution.value = response.profile.institution || '';
    }

    // Gemini key
    geminiKey.value = response.geminiApiKey || '';
  });

  // ─── Toggle Handlers ───
  toggleSwitch.addEventListener('change', () => {
    const enabled = toggleSwitch.checked;
    chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled });
    updateStatusUI(enabled);
  });

  chatMonitorToggle.addEventListener('change', () => {
    chrome.runtime.sendMessage({ type: 'SET_CHAT_MONITOR', enabled: chatMonitorToggle.checked });
  });

  autoFillToggle.addEventListener('change', () => {
    chrome.runtime.sendMessage({ type: 'SET_AUTO_FILL', enabled: autoFillToggle.checked });
  });

  autoSubmitToggle.addEventListener('change', () => {
    chrome.runtime.sendMessage({ type: 'SET_AUTO_SUBMIT', enabled: autoSubmitToggle.checked });
  });

  // ─── Save Profile ───
  saveProfileBtn.addEventListener('click', () => {
    const profile = {
      name: profileName.value.trim(),
      email: profileEmail.value.trim(),
      nim: profileNim.value.trim(),
      phone: profilePhone.value.trim(),
      institution: profileInstitution.value.trim(),
    };

    chrome.runtime.sendMessage({ type: 'SAVE_PROFILE', profile }, () => {
      showToast('✅ Profile saved!');
      flashButton(saveProfileBtn);
    });
  });

  // ─── Gemini Key ───
  toggleKeyVisibility.addEventListener('click', () => {
    geminiKey.type = geminiKey.type === 'password' ? 'text' : 'password';
  });

  saveKeyBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'SET_GEMINI_KEY', key: geminiKey.value.trim() }, () => {
      showToast('✅ API key saved!');
      flashButton(saveKeyBtn);
    });
  });

  // ─── Reset Stats ───
  resetBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RESET_STATS' }, () => {
      saveCountEl.textContent = '0';
      formsOpenedEl.textContent = '0';
      renderLinkHistory([]);
      showToast('🔄 Stats reset!');
    });
  });

  // ─── UI Helpers ───
  function updateStatusUI(enabled) {
    if (enabled) {
      statusDot.className = 'status-dot active';
      statusLabel.textContent = 'Active';
      statusDesc.textContent = 'Monitoring Google Meet';
    } else {
      statusDot.className = 'status-dot inactive';
      statusLabel.textContent = 'Paused';
      statusDesc.textContent = 'Protection is disabled';
    }
  }

  function renderLinkHistory(links) {
    if (!links || links.length === 0) {
      linkHistoryEl.innerHTML = '<p class="empty-state">No links opened yet</p>';
      return;
    }

    // Show last 5 links (most recent first)
    const recentLinks = links.slice(-5).reverse();
    linkHistoryEl.innerHTML = recentLinks
      .map((url) => {
        // Shorten URL for display
        let display = url
          .replace(/^https?:\/\//, '')
          .replace(/^(docs\.google\.com|forms\.gle|drive\.google\.com)/, (m) => m);
        if (display.length > 40) display = display.substring(0, 40) + '…';
        return `<a class="link-item" href="${url}" target="_blank" title="${url}">${display}</a>`;
      })
      .join('');
  }

  function flashButton(btn) {
    btn.classList.add('saved');
    setTimeout(() => btn.classList.remove('saved'), 1200);
  }

  // ─── Toast ───
  let toastTimeout = null;
  function showToast(message) {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');

    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2000);
  }
});
