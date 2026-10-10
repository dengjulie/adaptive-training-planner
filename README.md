# Adaptive Training Planner (working title)

A training planner that builds a plan from your real training history, puts it on your Google Calendar, and adapts it every day based on your Oura readiness and the workouts you complete or miss.

> **Status:** early development. Personal project, currently single-user.

## Features

- **Baseline from your history.** Pulls past workouts, training load, sleep, and HRV to establish current fitness and your normal recovery ranges.
- **Goal-based plans.** Race on a date, faster at a distance, consistency, or weight. Sessions are scheduled around the days and times you're actually free.
- **Daily adaptation.** Each morning the plan adjusts to your readiness and to what you completed or missed.
- **Calendar sync.** Sessions live on a dedicated Google Calendar and update automatically when the plan changes.
- **Check-ins and progress tests.** Weekly check-ins, benchmark tests every 4 to 6 weeks, and an optional weight trend.

## Integrations

| Source | What we use | Notes |
|---|---|---|
| **COROS** (official MCP, OAuth) | Activities, laps, FIT files, training load, VO2max, sleep, sleep HRV | Self-service, no approval needed. No webhooks, so we poll. 50 FIT file downloads per account per day. Raw time-series queries are limited to 7-day windows. |
| **Oura API v2** (OAuth) | Daily readiness, sleep, HRV, resting heart rate | Gen3 and newer rings need an active Oura membership. Personal access tokens were deprecated in December 2025. |
| **Google Calendar API** (OAuth) | Free/busy lookups, creating and updating events | Writes only to a dedicated "Training" calendar, never to personal events. |

**Why not Strava?** Strava's API policy limits caching to 7 days, bans combining Strava data with other data, and bans AI use. COROS provides the same workouts directly, without those restrictions.

## How it works

### 1. Baseline

- **From COROS (last 8 to 12 weeks):** weekly hours and distance per sport, sessions per week, longest session, intensity mix, training load, VO2max.
- **From Oura:** rolling 30-day ranges for readiness, HRV, and resting heart rate.

### 2. Goal intake

- Goal type and target date
- Available days and time windows, checked against calendar free/busy
- Preferred long-session day

### 3. Plan generation (rules-based)

- Phases counted back from the goal date: base, build, peak, taper
- Conservative weekly volume progression, with a recovery week every 3 to 4 weeks
- No back-to-back hard days
- Long session on the preferred day

### 4. Daily adaptation job

Runs every morning:

1. Fetch today's Oura readiness and yesterday's COROS activities.
2. Match activities to planned sessions. A manual "done" tap is the fallback.
3. Apply the adaptation rules:
   - **Readiness below personal baseline:** today's hard session becomes easy or rest.
   - **Two low-readiness days in a row:** reduce the rest of the week.
   - **Training load rising quickly:** trim the next few sessions.
   - **Missed key session:** reschedule it within the week if that doesn't create back-to-back hard days. Otherwise drop it.
   - **Several missed sessions:** rebuild next week from actual volume, not planned volume.
4. Update the affected calendar events.
5. Send a short morning note explaining any changes.

### 5. Check-ins and progress tests

- **Weekly check-in:** effort, soreness, motivation, and a free-text note.
- **Benchmark every 4 to 6 weeks,** matched to the goal: 5K or 30-minute run test, 20-minute bike test, or swim time trial.
- **Passive trend:** COROS VO2max and race predictions between tests.
- **Weight (optional):** manual entry or smart scale, shown as a weekly average rather than daily numbers.

## Where AI is used

| Allowed | Not allowed |
|---|---|
| Goal intake conversation | Sending Oura API data to an LLM |
| Summarizing check-in notes | Training any model on Oura data |
| Explaining plan changes in plain language | Recreating Oura's readiness score |
| Reasoning over COROS data (its MCP is built for AI clients) | |

Readiness-based adjustments are deterministic code rules. If an LLM ever needs Oura data, it must come through Oura's MCP server, and data fetched that way can't be stored.

## Data handling

- Store only what features need. For Oura, keep a rolling 60 days of daily readiness and HRV and delete older records.
- Delete a user's data when they disconnect an integration.
- Encrypt OAuth tokens at rest.

## Oura API quirks

- The detailed sleep endpoint treats `end_date` as exclusive, so a single-day query returns nothing. Pad date ranges.
- It returns several sleep records per day (long sleep, naps, rest). Use the long sleep, or a nap's HRV becomes the night's value.
- Assign sleep to the day you wake up, not the night it started.

## Roadmap

- [ ] OAuth for COROS, Oura, and Google Calendar
- [ ] Baseline page
- [ ] Structured goal form
- [ ] Rules-based plan generator (running first)
- [ ] Calendar writer
- [ ] Daily adaptation job
- [ ] Weekly check-ins and benchmark tests
- [ ] Multisport plans (swim, bike, run)
- [ ] Conversational goal intake
- [ ] Push workouts to the COROS watch (once COROS ships plan writing)

## Getting started

### Prerequisites

- **Node 24+** and **Postgres** (e.g. `brew install postgresql@17`).
- **COROS:** an account with a watch synced to the COROS app. There is nothing to register; the app registers itself with COROS the first time you connect.
- **Oura:** an account (active membership for Gen3 and newer rings) and an API application from the [Oura developer portal](https://developer.ouraring.com) with the `daily` scope and the redirect URI `http://localhost:5173/auth/oura/callback`.
- **Google:** a Cloud project with the Calendar API enabled and an OAuth client of type *Web application* with the redirect URI `http://localhost:5173/auth/google/callback`. Under Data Access, add `openid`, `email`, `https://www.googleapis.com/auth/calendar.app.created` and `https://www.googleapis.com/auth/calendar.freebusy`. For personal use, set the OAuth app to "In production". Testing-mode refresh tokens expire after 7 days.

### Setup

```bash
npm install
cp .env.example .env    # fill it in; generate the two secrets with: openssl rand -base64 32
createdb train_smarter
npm run db:migrate
npm run dev             # web on http://localhost:5173, API on http://localhost:8787
```

Sign in with Google (this also connects the Training calendar), then connect Oura and COROS from the Connections page.

### Environment variables

All variables are documented in [`.env.example`](.env.example). Notes:

- `APP_URL` is the origin the browser uses. In development, Vite proxies `/api` and `/auth` to the API server, so OAuth redirect URIs use the Vite origin.
- `COROS_MCP_URL` must be the regional endpoint for your account: `mcpus`, `mcpeu` or `mcpcn`. The `mcp.coros.com` gateway advertises the US server as its resource, which MCP clients reject.
- If COROS rejects the `localhost` redirect after login, set `APP_URL=http://127.0.0.1:5173`, open the app at that address, and update the Google and Oura redirect URIs to match.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Web (Vite) and API (Node, restarts on change) together |
| `npm test` | Unit tests, plus token-refresh tests against a `train_smarter_test` database that is created automatically |
| `npm run typecheck`, `npm run lint` | TypeScript and Oxlint across both workspaces |
| `npm run db:generate`, `npm run db:migrate` | Create a migration from `server/src/db/schema.ts`, and apply migrations |
| `npm run job:daily` | The morning job. Schedule it with cron, e.g. `30 6 * * * cd /path/to/train-smarter && npm run job:daily` |
| `npm run build`, then `NODE_ENV=production npm start` | Production: the API server also serves the built web app |

### Stack

- `web/`: React, TypeScript, Vite, TanStack Query, React Router.
- `server/`: Node 24 running TypeScript directly (no build step), Hono, Drizzle ORM on Postgres.
- Each integration lives in `server/src/integrations/<provider>/`: OAuth, API client, routes, and disconnect cleanup.

## Before opening this to other users

- **Oura:** approval is reportedly required beyond 10 users, and charging users requires Oura's written consent.
- **Google:** Calendar scopes require brand verification. Unverified apps are capped at 100 users.
- **COROS:** review the COROS API terms. The Partner API adds webhooks and pushing workouts to watches.
- **Safety:** cap weekly progression and add clear disclaimers.

## Disclaimer

This app suggests training adjustments based on general rules. It is not medical advice. Stop and consult a professional if you have pain, an injury, or health concerns.

## References

- [COROS MCP (GitHub)](https://github.com/coroslab/coros-mcp)
- [COROS: Developer access through MCP](https://support.coros.com/hc/en-us/articles/53181619102996)
- [COROS: Partner API](https://support.coros.com/hc/en-us/articles/53181766856724)
- [Oura API and MCP Agreement](https://cloud.ouraring.com/legal/api-agreement)
- [Google OAuth verification for Calendar scopes (Nylas)](https://developer.nylas.com/docs/cookbook/use-cases/build/fix-google-access-denied/)
- [Strava API Policy](https://www.strava.com/legal/api_policy)
