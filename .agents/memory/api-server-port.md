---
name: API Server PORT configuration
description: The API Server workflow needs PORT set explicitly — artifact.toml localPort doesn't auto-inject PORT for dev scripts
---

**Rule:** Always include `PORT=8080` (or the assigned port) explicitly in the workflow command for the API server dev script.

**Why:** The `artifact.toml` `localPort = 8080` tells the proxy which port to route to, but does NOT automatically inject a `PORT` env var into the dev process. The `[services.env]` block only works for production. In development, the command must set PORT explicitly.

**How to apply:** Workflow command should be:
`fuser -k 8080/tcp 2>/dev/null; sleep 1; PORT=8080 pnpm --filter @workspace/api-server run dev`

The `fuser -k` prefix kills any previous process holding the port before restarting.
