---
name: WhatsApp library choice and Chromium path
description: whatsapp-web.js works in Replit with system Chromium; Baileys packages are blocked
---

**Rule:** Use `whatsapp-web.js` with system Chromium installed via `installSystemDependencies({ packages: ["chromium"] })`.

**Why:** @whiskeysockets/baileys and @adiwajshing/baileys are both blocked by Replit's package security policy (protobufjs dependency returns 403). whatsapp-web.js works correctly once system Chromium is available.

**Chromium path (as of June 2026):**
`/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium`

Use `which chromium` to find the current path in case it changes after Nix updates.

**Import fix:** whatsapp-web.js exports differ between ESM/CJS - always try both:
```js
const Client = m.Client ?? m.default?.Client;
const LocalAuth = m.LocalAuth ?? m.default?.LocalAuth;
```

**Performance:** QR code appears in ~19 seconds after session.initialize() is called. Pre-load the module at startup with `loadWWebJS()` to shave a few seconds off the first session.

**Puppeteer args required for container:**
--no-sandbox, --disable-setuid-sandbox, --disable-dev-shm-usage, --single-process, --disable-gpu
