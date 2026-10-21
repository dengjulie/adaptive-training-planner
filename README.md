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
| **Oura API v2** (OAuth) | Everything the API offers: readiness, sleep (stages, heart rate, HRV), activity, heart rate, stress, resilience, SpO2, cardiovascular age, VO2 max, workouts, sessions, tags, rest mode, ring, and profile | Gen3 and newer rings need an active Oura membership. Personal access tokens were deprecated in December 2025. |
| **Google Calendar API** (OAuth) | Free/busy lookups, creating and updating events | Writes only to a dedicated "Training" calendar, never to personal events. |

**Why not Strava?** Strava's API policy limits caching to 7 days, bans combining Strava data with other data, and bans AI use. COROS provides the same workouts directly, without those restrictions.

## How it works

### 1. Baseline

- **From COROS (last 8 to 12 weeks):** weekly hours and distance per sport, sessions per week, longest session, intensity mix, training load, VO2max.
- **From Oura:** rolling 30-day ranges for readiness, HRV, and resting heart rate. A day's normal range is the mean of the 30 days before it, plus or minus one standard deviation, once those days hold at least 14 values (`server/src/integrations/oura/baseline.ts`). The Recovery page charts each metric against it.

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

1. Fetch today's Oura readiness and the last two weeks of COROS activities.
2. Match activities to planned sessions (same day, a run within 40% of the planned length); past sessions with no match are missed. A manual "done" tap is the fallback.
3. Give the next two weeks of sessions free slots in your training windows, around busy time on your primary calendar, moving a session to another free training day when its own is full.
4. Apply the adaptation rules (`server/src/plan/adapt.ts`):
   - **Readiness below personal baseline:** today's hard session becomes an easy run at 70% of its length; other sessions shorten. Two standard deviations below: rest.
   - **Two low-readiness days in a row:** the rest of the week is 20% shorter.
   - *Not yet:* training load rising quickly; rescheduling a missed key session; rebuilding a week after several missed sessions.
5. Update the affected calendar events.
6. *Not yet:* send a short morning note explaining any changes. For now the plan page shows each change and its reason.

Every step is idempotent: running the morning twice gives the same plan. The plan page's "Run this morning's check" button runs it on demand.

### 5. Check-ins and progress tests

- **Weekly check-in:** effort, soreness, motivation, and a free-text note.
- **Benchmark every 4 to 6 weeks,** matched to the goal: 5K or 30-minute run test, 20-minute bike test, or swim time trial.
- **Passive trend:** COROS VO2max and race predictions between tests.
- **Weight (optional):** manual entry or smart scale, shown as a weekly average rather than daily numbers.

## Where AI is used

| Allowed | Not allowed |
|---|---|
| Goal intake conversation (built: `server/src/ai/goalIntake.ts`) | Sending Oura API data, or anything derived from it, to an LLM |
| Summarizing check-in notes | Training any model on Oura data |
| Explaining plan changes that don't come from readiness (missed sessions, calendar moves) | Recreating Oura's readiness score |
| Reasoning over COROS data (its MCP is built for AI clients) | Explaining readiness-based changes with an LLM: they're Oura-derived, so fixed templates explain them |

Readiness-based adjustments are deterministic code rules. If an LLM ever needs Oura data, it must come through Oura's MCP server, and data fetched that way can't be stored.

Claude Code in this repo connects to the COROS MCP server (`.mcp.json`): approve it when Claude Code asks, then sign in to COROS from `/mcp`. Like `COROS_MCP_URL`, the URL must be your account's regional endpoint. Oura's MCP server isn't connected: Oura hasn't published its address, and Claude Code keeps session transcripts, while the agreement forbids storing data from that server (§3(m)). Third-party Oura MCP servers wrap the REST API, which the agreement forbids feeding to an LLM (§4(d)).

## Architecture: keeping Oura data away from AI

The Oura agreement forbids sending Oura data, or anything derived from it, to an AI model. A session eased because of low readiness is derived from Oura, and so is the sentence explaining why. So the plan is stored in two layers, and only the first may reach an AI model:

```
 goal + COROS history + calendar free/busy
              │
              ▼
   base plan (planned_sessions)  ──────────────►  AI goal intake may read
   generate.ts · schedule.ts · match.ts            (COROS volume + your words)
              │
              ▼
   Oura overlay (plan_adjustments)  ── adapt.ts: fixed rules, template reasons
              │                         purged with Oura retention,
              ▼                         deleted when Oura is disconnected
   what you see: plan page, Training calendar (session only, no readiness values)
```

The boundary is enforced, not just documented:

- **Lint:** `server/.oxlintrc.json` makes any import of Oura code, the readiness rules, or the plan service from `src/ai/` or `src/routes/ai.ts` an error.
- **Import graph:** `server/src/ai/boundary.test.ts` walks every module the AI code reaches, directly or not, and fails if any path leads to Oura code. A positive control proves the walker finds paths.
- **On the wire:** `server/src/routes/ai.test.ts` stores Oura data with canary values and readiness adjustments for a user, runs the goal intake, and checks the request sent to Anthropic carries none of it, while it does carry the COROS summary.
- **Narrow inputs:** the intake takes only the conversation, today's date, and five COROS volume numbers. The client sends only the conversation; the server builds the rest.

Other decisions worth knowing:

- **The planner is pure functions plus one I/O module.** `generate`, `schedule`, `adapt`, and `match` in `server/src/plan/` take data and return data; `service.ts` does the database, COROS, Oura, and calendar work. The generator is checked with property tests over 240 goal, availability, and fitness combinations (no back-to-back hard days, at most 10% weekly growth, recovery weeks, one race).
- **Calendar sync is idempotent.** Each event carries the session's ID as a private property, and the app stores a hash of what the event shows, so only changed events are written.
- **Slots use the base session's length.** Adjustments only shorten sessions, so a slot never depends on Oura data.
- **Development never touches real data.** Tests and the demo use seeded synthetic fixtures (`server/tests/fixtures/`), and the demo seed refuses any database whose name doesn't end in `_demo`.

## Data handling

- COROS workouts aren't stored, except the ID and duration of a run that completes a planned session, and the weekly volume summary a plan starts from (`goals.baseline`).
- Store only what features use. For Oura that's everything the API returns: the Oura data page shows all of it and the planner builds on it. Documents are kept as Oura sends them (`oura_records`) for a rolling year, then deleted; the readiness rules read the values derived from them (`oura_daily`). The Oura API agreement requires that the app uses what it requests and keeps it only as long as strictly necessary, so drop a scope (`server/src/integrations/oura/oauth.ts`) if its data stops being used, and keep `OURA_RETENTION_DAYS` and PRIVACY.md in step.
- Delete a user's data when they disconnect an integration.
- Encrypt OAuth tokens at rest.

## Oura API quirks

- The detailed sleep endpoint treats `end_date` as exclusive, so a single-day query returns nothing. Pad date ranges.
- It returns several sleep records per day (long sleep, naps, rest). Use the long sleep, or a nap's HRV becomes the night's value.
- Assign sleep to the day you wake up, not the night it started.
- Time series (`heartrate`, `ring_battery_level`) take `start_datetime` and `end_datetime` instead of dates, and Oura has rejected long ranges, so the app asks for 30 days at a time. Their timestamps are UTC; the app stores them one record per day in the user's timezone.
- A token without a collection's scope gets a 401 whose detail mentions the scope. Refreshing can't fix that, so the sync skips that collection and the Oura data page asks the user to reconnect, unless it's readiness or sleep, which the rules need.
- Postgres stores JSON objects with their keys reordered, so don't rely on the order Oura sends fields in (contributors, for one).

## Roadmap

- [x] OAuth for COROS, Oura, and Google Calendar
- [ ] Baseline page (Oura ranges are on the Recovery page; the COROS baseline is only summarized on the plan page)
- [x] Structured goal form
- [x] Rules-based plan generator (running first)
- [x] Calendar writer
- [x] Daily adaptation job (two readiness rules and session matching; the morning note and the load and missed-session rules are still to come)
- [ ] Weekly check-ins and benchmark tests
- [ ] Multisport plans (swim, bike, run)
- [x] Conversational goal intake
- [ ] Push workouts to the COROS watch (once COROS ships plan writing)

## Getting started

### Prerequisites

- **Node 24+** and **Postgres** (e.g. `brew install postgresql@17`).
- **COROS:** an account with a watch synced to the COROS app. There is nothing to register; the app registers itself with COROS the first time you connect.
- **Oura:** an account (active membership for Gen3 and newer rings) and an API application from the [Oura developer portal](https://developer.ouraring.com) with every scope enabled (`email`, `personal`, `daily`, `heartrate`, `workout`, `tag`, `session`, `spo2`, `heart_health`) and the redirect URI `http://localhost:5173/auth/oura/callback`. After upgrading from a version that asked only for `daily`, run `npm run db:migrate` and reconnect Oura to grant the rest; the first sync after connecting brings in the past year.
- **Google:** a Cloud project with the Calendar API enabled and an OAuth client of type *Web application* with the redirect URI `http://localhost:5173/auth/google/callback`. Under Data Access, add `openid`, `email`, `https://www.googleapis.com/auth/calendar.app.created` and `https://www.googleapis.com/auth/calendar.freebusy`. For personal use, set the OAuth app to "In production". Testing-mode refresh tokens expire after 7 days.

### Setup

```bash
npm install
cp .env.example .env    # fill it in; generate the two secrets with: openssl rand -base64 32
createdb train_smarter
npm run db:migrate
npm run dev             # web on http://localhost:5173, API on http://localhost:8787
```

Sign in with Google (this also connects the Training calendar), then connect Oura and COROS from the Connections page, and set a goal on the Plan page.

### Try it without real accounts (demo mode)

A demo user with synthetic data only: 60 days of made-up Oura readiness ending in two low days, a half-marathon plan that started two weeks ago, and made-up COROS runs (one session missed). No Google, Oura, or COROS account is needed, and nothing real is read.

```bash
createdb train_smarter_demo
export DATABASE_URL=postgresql://localhost:5432/train_smarter_demo DEMO_MODE=true
npm run db:seed:demo    # creates the demo user; re-run to reset it to today
npm run dev             # then open http://localhost:5173/auth/demo
```

The seed refuses databases whose name doesn't end in `_demo`. `DEMO_MODE` can't be turned on in production. To try the goal chat, also set `ANTHROPIC_API_KEY`.

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
| `npm run job:daily` | The morning job. Schedule it with cron, e.g. `30 6 * * * cd /path/to/train-smarter && npm run job:daily`. `-- --user <email>` runs it for one user |
| `npm run db:seed:demo` | Creates or resets the demo user in a `*_demo` database (see "Try it without real accounts") |
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
