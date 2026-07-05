---
name: Campaign runner tiering
description: Tiered daily limits + kill switch behavior in campaign-runner.ts
---

## Tiered daily limits

`getDailyLimit(acc, settings)` returns the right daily cap based on account age and replies:

| Tier | Condition | Limit setting |
|------|-----------|---------------|
| NEW  | effectiveDay < warmUpDaysThreshold (default 7) | newAccountDailyLimit (20) |
| WARM | effectiveDay >= warmUpDaysThreshold | warmAccountDailyLimit (80) |
| HOT  | effectiveDay >= hotDaysThreshold (30) AND totalReplies >= hotReplyThreshold (20) | hotAccountDailyLimit (150) |

`effectiveDay = max(ageDays, warmUpDay)` so manual override via `warmUpDay` is respected.

**Why:** Old code used a single flat limit, ignoring account age. New accounts sending 80 messages/day on day 1 get banned immediately.

## Kill switch: per-message, not per-batch

Kill switch is checked:
1. At the top of the while loop (stops between batches)
2. **Inside** the per-message for loop (stops mid-batch within current message)

**Why:** A batch can be 20+ messages. Mid-batch kill switch check means campaigns halt within seconds of toggling, not after the entire current batch completes.

## Phone normalization for opt-out

`normalizePhone(raw)` strips `[\s\-\+\(\)]` before comparing against opt-out set. Applied at both the DB read side and the check side.

**Why:** Storage format varies ("+966501234567" vs "966501234567" vs "0501234567"). Without normalization, opted-out users can still receive messages if their phone is stored in a different format.

## extra.ts must be mounted in routes/index.ts

`artifacts/api-server/src/routes/extra.ts` contains:
- `POST /inbound` — receives inbound messages from WA Worker
- `POST /kill-switch` — toggles emergency stop
- Opt-out management

It must be added to `routes/index.ts` or inbound STOP detection silently fails.
