---
name: Worker security
description: WA Worker HTTP server authentication — WORKER_SECRET shared secret
---

## WORKER_SECRET shared secret

Both `artifacts/wa-worker` and `artifacts/api-server` read `process.env.WORKER_SECRET`.

- Worker: checks `X-Worker-Secret` header on every request except `GET /healthz`
- Client (`worker-client.ts`): auto-sends the header via `workerHeaders()`
- Worker → API inbound: also sends the header when calling `POST /api/inbound`

**Why:** Worker exposes session creation, deletion, and message-send over HTTP. If reachable beyond trusted private network, anyone who can reach it can send messages or destroy sessions.

**How to apply:** Set `WORKER_SECRET=<strong-random>` in both service envs. Dev fallback: if unset, worker logs a warning but allows all traffic (never do this in production).
