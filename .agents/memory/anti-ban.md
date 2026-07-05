---
name: Anti-ban architecture
description: How to correctly apply stealth to whatsapp-web.js + Puppeteer to avoid WA account bans
---

## The correct stealth approach

Launch `puppeteer-extra` + `puppeteer-extra-plugin-stealth` as a **separate browser first**, get its `wsEndpoint`, then pass `browserWSEndpoint` to `whatsapp-web.js` Client options.

**Why:** Stealth patches are applied at browser launch time, before WhatsApp Web loads any JavaScript. If you let wwejs manage its own browser and only try to patch after, WA JS may already have fingerprinted the session.

**How to apply:** In `artifacts/wa-worker/src/index.js`, `_doInit()` function.

## webVersionCache must be "local" not "none"

`"none"` forces a fresh download of WhatsApp Web on every session restart — real browsers cache assets. WhatsApp detects the absence of cache as a bot signal.

**Why:** Real Android Chrome caches WA Web JS bundles between sessions. `"none"` is a unique fingerprint.

## Session init queue

Never initialize two WhatsApp sessions at the same time from the same IP. Use a sequential Promise queue with 5–12s gaps between inits.

**Why:** Multiple simultaneous Puppeteer launches from one IP is a strong bot signal.

## Per-account proxy

Each account MUST have its own residential proxy. Sharing an IP across accounts causes immediate ban of all accounts on that IP.

**How to apply:** `proxy` column in `accountsTable` → passed as `--proxy-server=` to Puppeteer launch args.

## Launch args to avoid

- `--single-process` — most obvious bot flag
- `--disable-extensions` — real Chrome has extensions
- `--disable-blink-features` should only be `AutomationControlled`, not a broad list
