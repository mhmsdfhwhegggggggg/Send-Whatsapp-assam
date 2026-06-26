---
name: WhatsApp library choice
description: @whiskeysockets/baileys is blocked by Replit security policy; use whatsapp-web.js instead
---

**Rule:** Use `whatsapp-web.js` for WhatsApp automation in Replit projects.

**Why:** @whiskeysockets/baileys (v6.x) is blocked by Replit's package security policy with a 403 Forbidden error. whatsapp-web.js v1.34+ is available and works correctly.

**How to apply:** In wa-worker/package.json, use `"whatsapp-web.js": "^1.34.7"` instead of Baileys. The API is different — uses `Client` + `LocalAuth` instead of `makeWASocket` + `useMultiFileAuthState`.
