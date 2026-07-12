# Chaptify

## Installation

### Prerequisites

- Run `cp .env.example .env`, and update the `.env` file as necessary.

Then run the following commands

- Run `npm install` to install the project dependencies.

### Run the development server:

- Run `npm run dev` or `nuxt dev` to start the development server.
- Open http://localhost:3000/

## Linting

- `npm run format-check` - checks for formatting errors.
- `npm run format` - auto-formats all files.
- `npm run lint` - checks for Typescript errors.
- `npm run type-check` - runs Nuxt type checking.
- `npm run test` - runs backend tests.

## Backend

The backend accepts one MP3 or M4B upload plus an email address, stores a durable SQLite job, and
uses a separate worker process to split embedded chapters with FFmpeg, create a ZIP, and send a
temporary Mailgun download link.

Run the API locally with:

```bash
npm run dev
```

Run the built API with:

```bash
npm run build
npm run api:start
```

Run the worker locally in a second shell with:

```bash
npm run worker:dev
```

See [docs/backend.md](docs/backend.md) for endpoint details, job states, storage layout, Docker
startup, Mailgun setup, and known limitations.

## Frontend workflow

The main page is a focused upload experience for one audiobook at a time:

- Choose exactly one `.m4b` or `.mp3` audiobook with embedded chapter metadata.
- Enter the email address that should receive the completion link.
- Submit the multipart upload using backend fields named `file` and `email`.
- Keep the browser tab open while upload progress is transferring.
- After upload completes, the page polls `GET /api/jobs/:jobId` for queued, processing, ready,
  failed, or expired status.
- The finished ZIP is delivered by email. The frontend never receives or constructs the download
  token.
- Download links and generated ZIP files expire after 12 hours by default.

The upload form validates file extensions and email format for user guidance, but the API remains
authoritative for upload size, supported media, queue capacity, chapter metadata, and storage
availability. Files without embedded chapter markers fail with `NO_CHAPTERS_FOUND`; silence-based
or AI chapter detection is not implemented.

Active job recovery uses `sessionStorage` and stores only the public job ID. Email addresses,
filenames, internal errors, download tokens, and temporary URLs are not persisted in browser
storage.

For local development, run the Nuxt API and frontend with `npm run dev`. Start `npm run worker:dev`
in a second shell to process queued uploads and send completion emails.

## Developer architecture

Chaptify is split by runtime boundary. `app/` contains the Nuxt UI, upload workflow, browser
download action, polling, and session restore behavior. `server/` contains Nitro API routes,
SQLite persistence, Mailgun delivery, storage cleanup, and the worker-only FFmpeg pipeline.
`shared/` contains schemas, public response types, constants, and pure helpers used by both sides.

The API process and worker process share `NUXT_STORAGE_ROOT` and the SQLite database under that
root. The API never runs FFmpeg during an upload request: it streams the multipart file into
temporary storage, moves it into a private per-job directory, creates a queued SQLite job, and
returns a public job ID plus a browser job-access token. The worker claims queued jobs from SQLite,
inspects embedded chapters with `ffprobe`, stream-copies chapter audio with FFmpeg, creates a ZIP,
stores only token hashes, and then sends the Mailgun completion email.

There are three identifiers with different trust levels. The public job ID is safe to expose in
status URLs. The browser job-access token lets the same browser session download a ready ZIP from
`POST /api/jobs/:jobId/download`. The email download token is embedded only in the emailed
`GET /api/download/:token` link. Raw tokens are never persisted; only SHA-256 hashes are stored.

Ready ZIP files expire after the configured retention period. Cleanup runs in the worker on startup
and during the polling loop, removes expired or failed job files from the shared storage root, and
marks expired jobs so old tokens stop resolving. Docker Compose runs one API service and one worker
service from the same image, with both services mounting the same `chaptify-storage` volume.

Start in these files for common changes:

- Frontend upload, polling, restore, and browser-download behavior:
  `app/pages/index.vue`, `app/composables/use-job-upload.ts`, and
  `app/composables/use-job-status.ts`.
- API request/response behavior: `server/api/jobs/`, `server/api/download/[token].get.ts`, and
  `shared/utils/schemas/api.ts`.
- Queue, job states, and token lookup rules: `server/utils/backend/database.ts` and
  `server/utils/backend/ids.ts`.
- Worker, cleanup, FFmpeg, ZIP, and Mailgun behavior: `server/utils/backend/worker.ts`,
  `server/utils/backend/media.ts`, `server/utils/backend/archive.ts`,
  `server/utils/backend/cleanup.ts`, and `server/utils/backend/mailgun.ts`.
- Runtime storage and Docker startup: `server/utils/backend/config.ts`, `Dockerfile`, and
  `docker-compose.yml`.

## How to update dependencies

### Minor version updates

Update packages to the latest safe version as follows:

1. Run `npm outdated` to check for outdated packages.
2. Run `npm update` to update _all_ the outdated packages.

- If you want to update _only_ a specific package, run `npm update <package-name>`.

3. Run `npm outdated` again to check if there are still outdated packages.

### Major version updates

Major version updates should be done with caution, as they may introduce breaking changes.

You can do so by using the `@latest`. e.g. `npm install <packagename>@latest`

### Alternative

As an alternative, you can also use [npm-check-updates](https://github.com/raineorshine/npm-check-updates).
