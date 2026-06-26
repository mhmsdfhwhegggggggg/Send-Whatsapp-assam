---
name: Workflow restart pattern for port conflicts
description: When restarting a workflow that binds a port, the old process must be killed first
---

**Rule:** Prefix workflow commands with `fuser -k <port>/tcp 2>/dev/null; sleep 1;` when port conflicts are expected.

**Why:** Replit's workflow runner may not always kill the previous process before starting the new one, causing EADDRINUSE errors. This is especially common with the API server on port 8080.

**How to apply:** Full command pattern:
`fuser -k 8080/tcp 2>/dev/null; sleep 1; PORT=8080 pnpm --filter @workspace/api-server run dev`
