# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read these first

- `AGENTS.md` — the authoritative, detailed convention guide (architecture rules, Nuxt/Vue/TypeScript/ESLint/Prettier conventions, security, Docker, completion requirements). Follow it. When it conflicts with the actual config files (`package.json`, `nuxt.config.ts`, `eslint.config.mjs`, `prettier.config.mjs`), the config files win.
- `docs/backend.md` — API endpoints, job/email states, storage layout, cleanup, and the full list of `NUXT_*` environment variables with defaults.

Note: `AGENTS.md` claims "No automated test command is currently defined." That is stale — `npm run test` (Vitest) now exists (see below).

## Commands

```bash
npm run dev            # API + frontend (`nuxi dev`; loads .env natively)
npm run worker:dev     # worker process, in a SECOND shell — required to process queued jobs
npm run cleanup:dev    # run cleanup once

npm run test           # Vitest (tests/backend.test.ts, tests/frontend.test.ts)
npm run lint           # ESLint
npm run type-check     # nuxt typecheck (strict)
npm run format         # Prettier --write
npm run format-check   # Prettier --check (no writes)

npm run build          # nuxt build + esbuild bundles for worker/cleanup/start
npm run api:start      # run built API (.output/start.mjs)
npm run smoke:docker   # docker smoke test (scripts/docker-smoke.mjs)
```

Run a single Vitest test: `npx vitest run tests/backend.test.ts` or filter by name with `npx vitest run -t "<name>"`.

Before completing a change, run: `npm run format`, `npm run lint`, `npm run type-check`, `npm run build` (and `npm run test`). For Docker-related changes, also build/start the container.

Local development needs BOTH `npm run dev` and `npm run worker:dev` running — the API only queues jobs; the separate worker does the FFmpeg processing and email.

## Architecture (big picture)

Chaptify accepts one MP3/M4B audiobook upload plus an email, splits its embedded chapters into per-chapter audio files, ZIPs them, and emails a temporary download link. Nuxt 4 + Nitro + Vue 3 + SQLite (`better-sqlite3`) + FFmpeg + Mailgun.

Two processes share state; there is no in-memory job queue:

- **API process** (`server/api/`) — streams the upload to disk, creates a durable **queued** SQLite job, returns a public job ID + browser access token. It never runs FFmpeg during a request.
- **Worker process** (`server/worker.ts`, `server/utils/backend/worker.ts`) — atomically claims queued jobs from SQLite, runs `ffprobe`/`ffmpeg`, builds the ZIP, stores token hashes, sends the Mailgun email, and runs cleanup on startup + on a loop.

Both share `NUXT_STORAGE_ROOT`, which holds `database/chaptify.sqlite` and `jobs/<id>/{source,chapters,output}`. SQLite is the coordination layer (job state, storage reservations, retry state, rate-limit durability). The storage root is never served statically.

### The three-directory boundary (never cross it)

- `app/` — Nuxt frontend (pages, components, composables, frontend utils).
- `server/` — Nitro API, worker, persistence, media processing, email, cleanup.
- `shared/` — schemas/types/constants/pure helpers safe for both runtimes, via barrel exports (`shared/utils/{schemas,types,constants}/index.ts`).

Never import `app/` ↔ `server/`. Put code in `shared/` only when both runtimes use it.

### Token/trust model (three distinct identifiers)

1. **Public job ID** — safe to expose; used in `GET /api/jobs/:jobId` status URLs.
2. **Browser access token** — lets the same browser session download via `POST /api/jobs/:jobId/download`.
3. **Email download token** — embedded only in the emailed `GET /api/download/:token` link.

Raw tokens are never persisted — only SHA-256 hashes. Status responses never leak tokens, email addresses, internal paths, or provider errors.

### Key behaviors to preserve

- Processing states: `queued` → `processing` → `ready` / `failed` / `expired`. Email states (`pending`/`sent`/`failed`) are independent — a Mailgun failure must never flip a `ready` job to `failed`. Completion email is at-least-once (duplicates are safe).
- Embedded chapters are required; files without them fail with `NO_CHAPTERS_FOUND`. Silence/AI detection is intentionally out of scope.
- ZIPs expire after `NUXT_JOB_RETENTION_HOURS` (default 12h). Cleanup is idempotent and refuses to touch paths outside `NUXT_STORAGE_ROOT`.
- FFmpeg/ffprobe: invoke with argument arrays via the wrapper in `server/utils/backend/process.ts`; never `shell: true`, never interpolate user input, never trust uploaded filenames/MIME.
- Designed for a single API + single worker on one VPS; per-IP counters and upload slots are in-memory (reset on restart), while capacity/reservations/state are durable in SQLite.

### Runtime config notes

`NUXT_SITE_URL` is the public origin used in emailed download links (runtimeConfig `siteUrl`). It is intentionally NOT named `NUXT_APP_BASE_URL` — that name is reserved by Nuxt for the route path prefix (`app.baseURL`) and must stay unset unless the app is served under a subpath. `npm run api:start` (`server/start.ts`) loads `.env` and fail-fast validates production config for the bare-Node processes (API/worker/cleanup), which do not autoload `.env`. All server config is read via `useRuntimeConfig()`; Mailgun secrets must stay server-only (never `runtimeConfig.public`).

## Conventions worth remembering (see AGENTS.md for the rest)

- Prettier: 100 cols, 4-space indent, double quotes, semicolons, no trailing commas, no spaces inside braces, one Vue attribute per line.
- Filenames are kebab-case (ESLint-enforced; only `README.md` is exempt).
- Strict TypeScript; explicit `any` is an ESLint error — prefer `unknown` for unvalidated input. No `@ts-ignore`.
- Zod validates all untrusted server input; prefer shared schemas and infer types from them.
- Nuxt UI is the component system — don't hand-roll controls it already provides, and don't add another UI framework. Preserve light/dark color mode.
- npm only; don't regenerate `package-lock.json` without instruction. `npm run clean` deletes it — use only when explicitly asked.
- Pre-commit hook (`simple-git-hooks` + `lint-staged`) runs Prettier + ESLint on staged files; fix failures rather than bypassing.
