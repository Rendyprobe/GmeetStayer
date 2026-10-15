# 🛡️ GmeetStayer

**Stay in Google Meet even when you're the only one.**

GmeetStayer is a lightweight Chrome extension that automatically dismisses the *"Are you still here?"* dialog in Google Meet, so you never get kicked out of a meeting — even when you're alone.

---

## ✨ Features

- **Auto-dismiss dialogs** — Detects and clicks the "Stay" button automatically
- **Multi-language support** — Works with English, Indonesian, Spanish, French, German, Portuguese, Japanese, and Korean
- **Toggle on/off** — Easy switch in the popup to enable or disable
- **Statistics tracking** — See how many times GmeetStayer saved you
- **Lightweight** — Uses MutationObserver with a minimal periodic fallback, no heavy CPU usage
- **Clean UI** — Modern dark-themed popup with smooth animations

## 🚀 Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **"Load unpacked"**
5. Select the `GmeetStayer` folder
6. Done! The extension icon will appear in your toolbar

## 🎯 How It Works

When you're the only person in a Google Meet call, Google shows a warning dialog saying something like:
> *"You're the only one here. The call will end soon."*

GmeetStayer monitors the page using:
1. **MutationObserver** — Instantly reacts when new elements (like dialogs) appear
2. **Periodic scan** — A fallback check every 5 seconds in case the observer misses anything

When the dialog is detected, the extension automatically clicks the **"Stay"** button.

## 📁 Project Structure

```
GmeetStayer/
├── manifest.json       # Chrome Extension Manifest V3
├── background.js       # Service worker for state management
├── content.js          # Content script injected into Google Meet
├── popup/
│   ├── popup.html      # Popup UI markup
│   ├── popup.css       # Popup styles (dark theme)
│   └── popup.js        # Popup interaction logic
├── icons/
│   ├── icon16.png      # Toolbar icon (16x16)
│   ├── icon48.png      # Extensions page icon (48x48)
│   └── icon128.png     # Chrome Web Store icon (128x128)
└── README.md           # This file
```

## 🛠️ Development

No build tools needed! This is a pure HTML/CSS/JS Chrome extension.

To test changes:
1. Make your edits
2. Go to `chrome://extensions/`
3. Click the 🔄 refresh button on the GmeetStayer card
4. Open or refresh a Google Meet tab

## 📄 License

MIT — Free to use, modify, and distribute.

