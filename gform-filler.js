// GmeetStayer — Google Forms Auto-Filler (v1.1)
// Injected into docs.google.com/forms/* pages.
// Features:
//   Layer 1: Auto-fill profile data (name, email, NIM, etc.)
//   Layer 2: Use Gemini AI for dynamic/quiz questions
//   Optional: Auto-submit

(function GmeetStayerFormFiller() {
  'use strict';

  // ═══════════════════════════════════════════════════
  //  PROFILE FIELD MATCHERS
  // ═══════════════════════════════════════════════════

  // Each matcher: { keys: [...keywords], profileField: 'fieldName' }
  const PROFILE_MATCHERS = [
    {
      keys: ['nama lengkap', 'nama', 'full name', 'name', 'your name', 'nama anda', 'nama peserta', 'nama mahasiswa'],
      profileField: 'name',
    },
    {
      keys: ['email', 'e-mail', 'alamat email', 'email address', 'email anda', 'your email'],
      profileField: 'email',
    },
    {
      keys: ['nim', 'nrp', 'npm', 'nip', 'nik', 'nomor induk', 'student id', 'id number', 'nomor mahasiswa', 'no. mahasiswa'],
      profileField: 'nim',
    },
    {
      keys: ['no hp', 'no. hp', 'nomor hp', 'no telepon', 'no. telepon', 'nomor telepon',
             'whatsapp', 'no wa', 'no. wa', 'phone', 'phone number', 'mobile',
             'nomor whatsapp', 'kontak', 'contact number', 'nomor handphone', 'no handphone'],
      profileField: 'phone',
    },
    {
      keys: ['instansi', 'universitas', 'kampus', 'sekolah', 'perguruan tinggi',
             'institution', 'university', 'school', 'organization', 'organisasi',
             'asal', 'asal instansi', 'asal universitas', 'divisi', 'jurusan',
             'department', 'faculty', 'fakultas', 'prodi', 'program studi'],
      profileField: 'institution',
    },
  ];

  // ═══════════════════════════════════════════════════
  //  UTILITIES
  // ═══════════════════════════════════════════════════

  function normalize(text) {
    return (text || '').toLowerCase().replace(/[*_#]/g, '').replace(/\s+/g, ' ').trim();
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response);
        }
      });
    });
  }

  // ═══════════════════════════════════════════════════
  //  FORM DOM PARSING
  // ═══════════════════════════════════════════════════

  /**
   * Wait until the Google Form has finished rendering.
   */
  async function waitForFormLoad() {
    for (let i = 0; i < 20; i++) {
      const formEl = document.querySelector('form');
      const questions = document.querySelectorAll('[role="listitem"], [data-params]');
      if (formEl && questions.length > 0) return true;
      await sleep(500);
    }
    // Even if no questions detected, proceed (might be a single-page form)
    return !!document.querySelector('form');
  }

  /**
   * Get the form title.
   */
  function getFormTitle() {
    // Google Forms title is typically in a header element
    const titleEl =
      document.querySelector('[role="heading"][aria-level="1"]') ||
      document.querySelector('.freebirdFormviewerViewHeaderTitle') ||
      document.querySelector('[data-item-id] [role="heading"]') ||
      document.querySelector('h1');
    return titleEl?.textContent?.trim() || document.title || 'Untitled Form';
  }

  /**
   * Get the form description.
   */
  function getFormDescription() {
    const descEl =
      document.querySelector('.freebirdFormviewerViewHeaderDescription') ||
      document.querySelector('[role="heading"][aria-level="1"]')?.parentElement?.querySelector('span:not([role])');
    return descEl?.textContent?.trim() || '';
  }

  /**
   * Scan all questions on the form and return structured data.
   */
  function scanQuestions() {
    const questions = [];
    // Google Forms question containers
    const containers = document.querySelectorAll(
      '[role="listitem"], [data-params], .freebirdFormviewerViewNumberedItemContainer'
    );

    const seen = new Set();
    for (const container of containers) {
      // Avoid duplicate containers (some elements match multiple selectors)
      if (seen.has(container)) continue;
      // Check if this is a descendant of an already-seen container
      let isDuplicate = false;
      for (const s of seen) {
        if (s.contains(container) || container.contains(s)) {
          isDuplicate = true;
          break;
        }
      }
      if (isDuplicate) continue;
      seen.add(container);

      const question = parseQuestion(container);
      if (question) {
        questions.push(question);
      }
    }

    return questions;
  }

  /**
   * Parse a single question container into structured data.
   */
  function parseQuestion(container) {
    // Find the question title
    const titleEl =
      container.querySelector('[role="heading"]') ||
      container.querySelector('[data-initial-value]')?.closest('[role="listitem"]')?.querySelector('span') ||
      container.querySelector('.freebirdFormviewerComponentsQuestionBaseTitle');

    // Broader search: first significant text element
    let title = titleEl?.textContent?.trim();
    if (!title) {
      const spans = container.querySelectorAll('span');
      for (const span of spans) {
        const t = span.textContent?.trim();
        if (t && t.length > 2 && !t.match(/^[*]$/)) {
          title = t;
          break;
        }
      }
    }
    if (!title) return null;

    // Determine question type and find input elements
    const question = {
      title,
      titleNormalized: normalize(title),
      container,
      type: 'unknown',
      options: [],
      inputEl: null,
      filled: false,
    };

    // Text input (short answer)
    const textInput = container.querySelector('input[type="text"]:not([aria-hidden="true"]), input:not([type]):not([aria-hidden="true"])');
    if (textInput) {
      question.type = 'short_answer';
      question.inputEl = textInput;
      if (textInput.value) question.filled = true;
      return question;
    }

    // Textarea (paragraph)
    const textarea = container.querySelector('textarea');
    if (textarea) {
      question.type = 'paragraph';
      question.inputEl = textarea;
      if (textarea.value) question.filled = true;
      return question;
    }

    // Radio buttons (multiple choice)
    const radioGroup = container.querySelector('[role="radiogroup"]');
    if (radioGroup) {
      question.type = 'multiple_choice';
      const radios = radioGroup.querySelectorAll('[role="radio"], [data-value]');
      for (const radio of radios) {
        const label = radio.getAttribute('data-value') ||
                      radio.getAttribute('aria-label') ||
                      radio.textContent?.trim();
        if (label) {
          question.options.push({ element: radio, label: label.trim() });
        }
      }
      // Check if already selected
      const checked = radioGroup.querySelector('[aria-checked="true"]');
      if (checked) question.filled = true;
      return question;
    }

    // Checkboxes
    const checkboxGroup = container.querySelector('[role="group"]');
    if (checkboxGroup) {
      const checkboxes = checkboxGroup.querySelectorAll('[role="checkbox"]');
      if (checkboxes.length > 0) {
        question.type = 'checkbox';
        for (const cb of checkboxes) {
          const label = cb.getAttribute('data-answer-value') ||
                        cb.getAttribute('aria-label') ||
                        cb.textContent?.trim();
          if (label) {
            question.options.push({ element: cb, label: label.trim() });
          }
        }
        const checked = checkboxGroup.querySelector('[aria-checked="true"]');
        if (checked) question.filled = true;
        return question;
      }
    }

    // Dropdown
    const dropdown = container.querySelector('[role="listbox"]');
    if (dropdown) {
      question.type = 'dropdown';
      const options = dropdown.querySelectorAll('[role="option"]');
      for (const opt of options) {
        const label = opt.getAttribute('data-value') || opt.textContent?.trim();
        if (label && label !== 'Choose' && label !== 'Pilih') {
          question.options.push({ element: opt, label: label.trim() });
        }
      }
      return question;
    }

    // Linear scale
    const scaleGroup = container.querySelector('[role="radiogroup"]') ||
                       container.querySelector('.freebirdFormviewerComponentsQuestionScaleRoot');
    if (!scaleGroup && container.querySelectorAll('[role="radio"]').length > 0) {
      question.type = 'linear_scale';
      const radios = container.querySelectorAll('[role="radio"]');
      for (const radio of radios) {
        const label = radio.getAttribute('data-value') ||
                      radio.getAttribute('aria-label') ||
                      radio.textContent?.trim();
        if (label) {
          question.options.push({ element: radio, label: label.trim() });
        }
      }
      return question;
    }

    // If we got here, it's a text/unknown type — try to find any input
    const anyInput = container.querySelector('input, textarea');
    if (anyInput) {
      question.type = anyInput.tagName === 'TEXTAREA' ? 'paragraph' : 'short_answer';
      question.inputEl = anyInput;
      if (anyInput.value) question.filled = true;
    }

    return question;
  }

  // ═══════════════════════════════════════════════════
  //  LAYER 1: PROFILE MATCHING & FILLING
  // ═══════════════════════════════════════════════════

  /**
   * Match profile fields to questions and fill them.
   */
  function fillProfileQuestions(questions, profile) {
    let filledCount = 0;

    for (const question of questions) {
      if (question.filled) continue;
      if (!question.titleNormalized) continue;

      for (const matcher of PROFILE_MATCHERS) {
        const profileValue = profile[matcher.profileField];
        if (!profileValue) continue;

        const matched = matcher.keys.some((key) =>
          question.titleNormalized.includes(key)
        );

        if (matched) {
          const success = fillQuestion(question, profileValue);
          if (success) {
            question.filled = true;
            question.filledBy = 'profile';
            filledCount++;
            console.log(`[GmeetStayer] 📝 Profile-filled: "${question.title}" → "${profileValue}"`);
          }
          break;
        }
      }
    }

    return filledCount;
  }

  // ═══════════════════════════════════════════════════
  //  LAYER 2: GEMINI AI ANSWERING
  // ═══════════════════════════════════════════════════

  /**
   * Send unanswered questions to Gemini and fill responses.
   */
  async function fillWithGemini(questions, formTitle, formDesc) {
    const unanswered = questions.filter((q) => !q.filled && q.type !== 'unknown');
    if (unanswered.length === 0) return 0;

    // Build prompt
    let prompt = `You are helping fill out a Google Form.\n`;
    prompt += `Form Title: "${formTitle}"\n`;
    if (formDesc) prompt += `Form Description: "${formDesc}"\n`;
    prompt += `\nPlease answer the following questions. Be concise, relevant, and natural.\n`;
    prompt += `For multiple choice / checkbox / dropdown, respond with the EXACT text of the best option.\n`;
    prompt += `For linear scale, respond with a number.\n\n`;
    prompt += `Respond ONLY with valid JSON in this format:\n`;
    prompt += `{"answers": {"0": "answer for question 0", "1": "answer for question 1", ...}}\n\n`;
    prompt += `Questions:\n`;

    unanswered.forEach((q, idx) => {
      prompt += `${idx}. "${q.title}" (Type: ${q.type}`;
      if (q.options.length > 0) {
        prompt += `, Options: [${q.options.map((o) => `"${o.label}"`).join(', ')}]`;
      }
      prompt += `)\n`;
    });

    console.log('[GmeetStayer] 🤖 Sending questions to Gemini AI...');
    updateBanner('🤖 Asking Gemini AI...', 'loading');

    const response = await sendMessage({ type: 'GEMINI_REQUEST', prompt });

    if (!response?.success) {
      console.error('[GmeetStayer] ❌ Gemini error:', response?.error);
      updateBanner(`❌ Gemini AI error: ${response?.error || 'Unknown'}`, 'error');
      return 0;
    }

    // Parse Gemini's JSON response
    let answers;
    try {
      const text = response.text;
      // Extract JSON from response (Gemini might wrap it in markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      const parsed = JSON.parse(jsonMatch[0]);
      answers = parsed.answers;
    } catch (err) {
      console.error('[GmeetStayer] ❌ Failed to parse Gemini response:', err);
      updateBanner('❌ Failed to parse AI response', 'error');
      return 0;
    }

    // Fill answers
    let filledCount = 0;
    for (const [idxStr, answer] of Object.entries(answers)) {
      const idx = parseInt(idxStr);
      if (idx >= 0 && idx < unanswered.length && answer) {
        const question = unanswered[idx];
        const success = fillQuestion(question, answer);
        if (success) {
          question.filled = true;
          question.filledBy = 'gemini';
          filledCount++;
          console.log(`[GmeetStayer] 🤖 AI-filled: "${question.title}" → "${answer}"`);
        }
      }
    }

    return filledCount;
  }

  // ═══════════════════════════════════════════════════
  //  FILLING LOGIC (Works for all question types)
  // ═══════════════════════════════════════════════════

  /**
   * Fill a single question with a value.
   */
  function fillQuestion(question, value) {
    try {
      switch (question.type) {
        case 'short_answer':
        case 'paragraph':
          return fillTextInput(question, value);

        case 'multiple_choice':
        case 'linear_scale':
          return selectRadioOption(question, value);

        case 'checkbox':
          return selectCheckboxOption(question, value);

        case 'dropdown':
          return selectDropdownOption(question, value);

        default:
          // Try text input as fallback
          if (question.inputEl) {
            return fillTextInput(question, value);
          }
          return false;
      }
    } catch (err) {
      console.error(`[GmeetStayer] Error filling "${question.title}":`, err);
      return false;
    }
  }

  /**
   * Fill a text input or textarea with a value.
   */
  function fillTextInput(question, value) {
    const input = question.inputEl;
    if (!input) return false;

    // Focus the input
    input.focus();
    input.click();

    // Use native setter to bypass React/Closure overrides
    const nativeSetter =
      Object.getOwnPropertyDescriptor(
        input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      )?.set;

    if (nativeSetter) {
      nativeSetter.call(input, value);
    } else {
      input.value = value;
    }

    // Dispatch events to trigger Google Forms' internal handlers
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));

    return true;
  }

  /**
   * Select a radio button option (exact or best match).
   */
  function selectRadioOption(question, value) {
    const normalizedValue = normalize(value);

    // Exact match first
    for (const opt of question.options) {
      if (normalize(opt.label) === normalizedValue) {
        opt.element.click();
        return true;
      }
    }

    // Partial match
    for (const opt of question.options) {
      if (normalize(opt.label).includes(normalizedValue) || normalizedValue.includes(normalize(opt.label))) {
        opt.element.click();
        return true;
      }
    }

    // For linear scale, try numeric match
    if (question.type === 'linear_scale') {
      const numValue = value.replace(/\D/g, '');
      for (const opt of question.options) {
        if (opt.label === numValue) {
          opt.element.click();
          return true;
        }
      }
    }

    // Click first option as last resort (better than nothing for required fields)
    if (question.options.length > 0) {
      question.options[0].element.click();
      return true;
    }

    return false;
  }

  /**
   * Select checkbox options (can select multiple).
   */
  function selectCheckboxOption(question, value) {
    const normalizedValue = normalize(value);
    let selected = false;

    for (const opt of question.options) {
      const normalizedLabel = normalize(opt.label);
      if (normalizedValue.includes(normalizedLabel) || normalizedLabel.includes(normalizedValue)) {
        if (opt.element.getAttribute('aria-checked') !== 'true') {
          opt.element.click();
        }
        selected = true;
      }
    }

    return selected;
  }

  /**
   * Select a dropdown option.
   */
  function selectDropdownOption(question, value) {
    const normalizedValue = normalize(value);

    // First, click the dropdown to open it
    const dropdown = question.container.querySelector('[role="listbox"]');
    if (dropdown) {
      dropdown.click();
    }

    // Wait a bit for dropdown to render, then select
    setTimeout(() => {
      for (const opt of question.options) {
        if (normalize(opt.label) === normalizedValue || normalize(opt.label).includes(normalizedValue)) {
          opt.element.click();
          return;
        }
      }
      // Select first non-empty option as fallback
      if (question.options.length > 0) {
        question.options[0].element.click();
      }
    }, 300);

    return true;
  }

  // ═══════════════════════════════════════════════════
  //  UI: NOTIFICATION BANNER
  // ═══════════════════════════════════════════════════

  let bannerEl = null;

  function createBanner() {
    if (bannerEl) return;

    bannerEl = document.createElement('div');
    bannerEl.id = 'gmeetstayer-banner';
    bannerEl.innerHTML = `
      <style>
        #gmeetstayer-banner {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 99999;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          color: #f1f5f9;
          padding: 12px 20px;
          font-family: 'Segoe UI', -apple-system, sans-serif;
          font-size: 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
          border-bottom: 2px solid #4ade80;
          transform: translateY(-100%);
          transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }
        #gmeetstayer-banner.visible {
          transform: translateY(0);
        }
        #gmeetstayer-banner .banner-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        #gmeetstayer-banner .banner-logo {
          font-weight: 700;
          color: #4ade80;
        }
        #gmeetstayer-banner .banner-text {
          color: #cbd5e1;
        }
        #gmeetstayer-banner .banner-text em {
          color: #4ade80;
          font-style: normal;
          font-weight: 600;
        }
        #gmeetstayer-banner .banner-close {
          background: rgba(255,255,255,0.1);
          border: none;
          color: #94a3b8;
          font-size: 18px;
          cursor: pointer;
          padding: 4px 10px;
          border-radius: 6px;
          transition: all 0.2s;
        }
        #gmeetstayer-banner .banner-close:hover {
          background: rgba(255,255,255,0.2);
          color: #f1f5f9;
        }
        #gmeetstayer-banner.error {
          border-bottom-color: #f87171;
        }
        #gmeetstayer-banner.error .banner-logo {
          color: #f87171;
        }
        #gmeetstayer-banner.loading .banner-logo::after {
          content: '';
          display: inline-block;
          width: 12px;
          height: 12px;
          border: 2px solid #4ade80;
          border-top-color: transparent;
          border-radius: 50%;
          animation: gmeetstayer-spin 0.8s linear infinite;
          margin-left: 8px;
          vertical-align: middle;
        }
        @keyframes gmeetstayer-spin {
          to { transform: rotate(360deg); }
        }
      </style>
      <div class="banner-left">
        <span class="banner-logo">🛡️ GmeetStayer</span>
        <span class="banner-text" id="gmeetstayer-banner-text">Analyzing form...</span>
      </div>
      <button class="banner-close" id="gmeetstayer-banner-close">✕</button>
    `;
    document.body.appendChild(bannerEl);

    document.getElementById('gmeetstayer-banner-close').addEventListener('click', () => {
      bannerEl.classList.remove('visible');
    });

    // Animate in
    requestAnimationFrame(() => {
      bannerEl.classList.add('visible');
    });
  }

  function updateBanner(text, state = 'default') {
    createBanner();
    const textEl = document.getElementById('gmeetstayer-banner-text');
    if (textEl) textEl.innerHTML = text;
    bannerEl.className = 'visible';
    if (state === 'error') bannerEl.classList.add('error');
    if (state === 'loading') bannerEl.classList.add('loading');
    bannerEl.id = 'gmeetstayer-banner';
    bannerEl.classList.add('visible');
  }

  // ═══════════════════════════════════════════════════
  //  AUTO-SUBMIT
  // ═══════════════════════════════════════════════════

  function clickSubmitButton() {
    // Google Forms submit button selectors
    const submitBtn =
      document.querySelector('[role="button"][jsname="M2UYVd"]') || // Common Google Forms submit
      document.querySelector('div[role="button"]:last-of-type') ||
      [...document.querySelectorAll('[role="button"]')].find(
        (el) => {
          const t = normalize(el.textContent);
          return t === 'submit' || t === 'kirim' || t === 'send' || t === 'enviar';
        }
      );

    if (submitBtn) {
      console.log('[GmeetStayer] 📤 Auto-submitting form...');
      submitBtn.click();
    }
  }

  // ═══════════════════════════════════════════════════
  //  MAIN FLOW
  // ═══════════════════════════════════════════════════

  async function main() {
    // 1. Check if auto-fill is enabled
    const state = await sendMessage({ type: 'GET_STATE' });
    if (!state?.autoFillEnabled) {
      console.log('[GmeetStayer] ⏸️ Auto-fill is disabled.');
      return;
    }

    const profile = state.profile || {};
    const hasProfile = Object.values(profile).some((v) => v);
    const hasGeminiKey = !!state.geminiApiKey;

    if (!hasProfile && !hasGeminiKey) {
      console.log('[GmeetStayer] ⚠️ No profile data and no Gemini key configured. Skipping.');
      return;
    }

    // 2. Wait for form to load
    updateBanner('📋 Analyzing form...', 'loading');
    const loaded = await waitForFormLoad();
    if (!loaded) {
      updateBanner('⚠️ Could not detect form fields.', 'error');
      return;
    }

    await sleep(1000); // Extra wait for form rendering

    // 3. Scan questions
    const formTitle = getFormTitle();
    const formDesc = getFormDescription();
    const questions = scanQuestions();
    console.log(`[GmeetStayer] 📋 Found ${questions.length} questions in "${formTitle}"`);

    if (questions.length === 0) {
      updateBanner('⚠️ No fillable questions detected.', 'error');
      return;
    }

    let totalFilled = 0;

    // 4. Layer 1: Profile matching
    if (hasProfile) {
      const profileFilled = fillProfileQuestions(questions, profile);
      totalFilled += profileFilled;
      console.log(`[GmeetStayer] 📝 Profile filled ${profileFilled} fields.`);
    }

    // 5. Layer 2: Gemini AI
    if (hasGeminiKey) {
      const geminiFilled = await fillWithGemini(questions, formTitle, formDesc);
      totalFilled += geminiFilled;
      console.log(`[GmeetStayer] 🤖 Gemini filled ${geminiFilled} fields.`);
    }

    // 6. Show result
    const unfilled = questions.filter((q) => !q.filled).length;
    if (totalFilled > 0) {
      const profileCount = questions.filter((q) => q.filledBy === 'profile').length;
      const geminiCount = questions.filter((q) => q.filledBy === 'gemini').length;
      let summary = `✅ Filled <em>${totalFilled}</em> of ${questions.length} fields`;
      if (profileCount > 0) summary += ` · 📝 Profile: ${profileCount}`;
      if (geminiCount > 0) summary += ` · 🤖 AI: ${geminiCount}`;
      if (unfilled > 0) summary += ` · ⚠️ ${unfilled} unfilled`;
      updateBanner(summary, 'default');
    } else {
      updateBanner('⚠️ Could not fill any fields. Please check your profile settings.', 'error');
    }

    // 7. Auto-submit if enabled
    if (state.autoSubmit && totalFilled > 0 && unfilled === 0) {
      updateBanner('📤 Auto-submitting in 3 seconds...', 'loading');
      await sleep(3000);
      clickSubmitButton();
    }
  }

  // ─── Start ───
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(main, 1500));
  } else {
    setTimeout(main, 1500);
  }
})();

