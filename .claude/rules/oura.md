## Oura API constraints (agreement effective 2026-06-08)
Source: https://cloud.ouraring.com/legal/api-agreement

- NEVER send Oura data, or anything derived from it, to an LLM or AI API.
  Code in server/src/ai/ (and server/src/routes/ai.ts) must not import from
  server/src/integrations/oura/, directly or indirectly; lint and server/src/ai/boundary.test.ts check.
- NEVER call the live Oura API or read real Oura data (DB rows, logs, .env tokens)
  during development. Use synthetic fixtures in server/tests/fixtures/oura/, and the demo
  database (npm run db:seed:demo, DATABASE_URL ending in _demo).