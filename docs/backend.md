# Chaptify Backend

## Architecture

The backend is split between the Nuxt/Nitro API process and a separate worker process.
The API accepts uploads, creates durable SQLite jobs, exposes public job status, streams ready
downloads, and reports health. The worker polls SQLite for queued jobs, claims one atomically,
runs `ffprobe` and `ffmpeg`, creates a ZIP archive, sends Mailgun completion email through a
durable retry path, and runs cleanup.

Runtime files live under `NUXT_STORAGE_ROOT`:

```text
<storage-root>/
    database/chaptify.sqlite
    jobs/<internal-job-id>/
        source/
        chapters/
        output/
```

The storage root must be writable by both API and worker. It is never served statically.

## API Endpoints

- `POST /api/jobs` accepts multipart form fields `file`, `email`, and an optional `outputFormat`
  (`mp3` or `m4b`; defaults to the uploaded format), streams one `.mp3` or `.m4b` upload to disk,
  validates queue and size limits, creates a queued job, and returns `202`.
- `GET /api/jobs/:jobId` returns safe public status, progress, email status, and public errors.
- `GET /api/download/:token` streams a ready ZIP while the signed email credential is valid.
- `POST /api/jobs/:jobId/download` accepts the same-tab browser access credential in the request
  body and streams the ready ZIP as an attachment.
- `GET /api/health` verifies API runtime, SQLite access, and writable storage.
- `POST /api/contact` validates a contact-form submission (name, email, topic, message) and
  forwards it via Mailgun to `NUXT_CONTACT_RECIPIENT` with the sender's address as Reply-To.
  Nothing is persisted; the route is rate limited per IP (`NUXT_CONTACT_RATE_LIMIT` per hour).

The status endpoint never returns download tokens, submitted email addresses, internal paths, or
provider diagnostics.

## States

Processing states are `queued`, `processing`, `ready`, `failed`, and `expired`.

Email states are `pending`, `sent`, and `failed`. Email delivery is independent of processing:
a Mailgun failure never changes a `ready` job to `failed`.

Completion email delivery is at-least-once. If the worker exits after Mailgun accepts a request but
before success is recorded, a later retry may send a duplicate email. Duplicate emails are safe
because they point to the same logical signed download URL for the same ready job.

## Upload History

Every upload also inserts one permanent row into the `upload_history` SQLite table for
operator-facing analysis (there is no public endpoint for it). Each row records the book name
inferred from the uploaded filename, file size, source/output formats, the recipient email, the
current processing and email statuses, the public error code for failures, and upload/completion
timestamps. After the worker probes the file, the row is enriched with the total duration, the
embedded chapter count, and the author/title tags when present; anything unavailable stays `NULL`
so history can be filtered and sorted.

Unlike the `jobs` table — which anonymizes emails and filenames as part of cleanup — upload
history is intentionally never cleaned up or anonymized. It permanently retains uploader email
addresses and book names, which is a deliberate retention/privacy trade-off; deleting rows by hand
(or adding a retention job later) is the operator's call. History writes are best-effort
bookkeeping: a failed history write logs a warning and never fails an upload or a job transition.

## Processing

This version requires embedded chapter metadata. Files without valid embedded chapters fail with
`NO_CHAPTERS_FOUND`. Silence detection, AI detection, manual chapter editing, accounts, external
object storage, Redis, and multi-node workers are intentionally out of scope.

The worker uses `ffprobe` to validate media, chapters, codec, and container, then `ffmpeg` to write
the first audio stream into one ordered file per chapter in the job's requested output format
(`.mp3` or `.m4b`). When the source codec already matches the requested format (MP3 for `.mp3`,
AAC for `.m4b`) the audio is stream-copied without re-encoding; otherwise each chapter is
re-encoded (libmp3lame or aac at 128 kbps). Chapter files explicitly drop inherited chapter
tables, non-audio streams, cover-art video, subtitles, data streams, inherited title metadata,
and unsupported stream layouts. Chapter filenames are sanitized and duplicate names are made
deterministic.

After ZIP creation succeeds, the source file and intermediate chapter files are deleted. The ZIP
remains available until the configured retention period expires.

## Cleanup

Cleanup runs on worker startup, periodically in the worker loop, and can be run independently with
`npm run cleanup:dev` or `npm run cleanup:start` after a production build. Expired ready jobs have
their ZIP and remaining job directory removed, credentials invalidated, and status changed to
`expired`. Failed jobs are anonymized and lose their retained files. Abandoned upload files and
orphan job directories are removed best-effort. Cleanup is idempotent and refuses to remove paths
outside `NUXT_STORAGE_ROOT`.

## Local Startup

Start the API:

```bash
npm run dev
```

Start the worker in another shell:

```bash
npm run worker:dev
```

Run cleanup once:

```bash
npm run cleanup:dev
```

Production worker JavaScript is generated by:

```bash
npm run build
npm run api:start
npm run worker:start
npm run cleanup:start
```

## Docker Startup

The Compose file starts one API service and one worker service from the same image:

```bash
docker compose up --build
```

The API service owns the image build. Worker and cleanup reference the same `chaptify:latest`
image with different commands, which avoids concurrent duplicate image exports during
`docker compose build`. All services mount the `chaptify-storage` volume at `/data/chaptify`. The
worker exposes no HTTP port. The API health check calls `/api/health`.

Repeatable local smoke checks are available with:

```bash
npm run smoke:docker
```

## Environment

Required production values:

- `NUXT_SITE_URL`: externally accessible origin used in email links (e.g. `https://chaptify.org`).
- `NUXT_STORAGE_ROOT`: writable shared API/worker storage root.
- `NUXT_MAILGUN_BASE_URL`
- `NUXT_MAILGUN_DOMAIN`
- `NUXT_MAILGUN_KEY`
- `NUXT_MAILGUN_SENDER`
- `NUXT_DOWNLOAD_SIGNING_SECRET`: server-only secret, at least 32 random characters, required for
  restart-safe emailed download links.

Operational defaults:

- `NUXT_MAX_UPLOAD_BYTES=1610612736`
- `NUXT_MAX_QUEUED_JOBS=10`
- `NUXT_MAX_CONCURRENT_UPLOADS=2`
- `NUXT_PER_IP_UPLOAD_LIMIT=5`
- `NUXT_PER_IP_JOB_LIMIT=5`
- `NUXT_DOWNLOAD_RATE_LIMIT=30`
- `NUXT_STORAGE_RESERVATION_MULTIPLIER=4`
- `NUXT_STORAGE_RESERVATION_SAFETY_BYTES=268435456`
- `NUXT_STORAGE_RESERVATION_TTL_MINUTES=120`
- `NUXT_ORPHAN_JOB_DIRECTORY_MIN_AGE_MINUTES=30`
- `NUXT_CLEANUP_INTERVAL_SECONDS=300`
- `NUXT_BROWSER_DOWNLOAD_GRANT_LIFETIME_SECONDS=60`
- `NUXT_BROWSER_DOWNLOAD_GRANT_USED_GRACE_SECONDS=300`
- `NUXT_WORKER_CONCURRENCY=1`
- `NUXT_JOB_RETENTION_HOURS=12`
- `NUXT_MAX_AUDIOBOOK_DURATION_SECONDS=108000`
- `NUXT_MAX_CHAPTERS=300`
- `NUXT_JOB_PROCESSING_TIMEOUT_SECONDS=14400`
- `NUXT_FFPROBE_TIMEOUT_SECONDS=30`
- `NUXT_FFMPEG_CHAPTER_TIMEOUT_SECONDS=1200`
- `NUXT_EMAIL_RETRY_ATTEMPTS=3`
- `NUXT_EMAIL_RETRY_BASE_DELAY_SECONDS=60`
- `NUXT_EMAIL_RETRY_MAX_DELAY_SECONDS=3600`
- `NUXT_CONTACT_RATE_LIMIT=5`

`NUXT_MAILGUN_BCC` is optional. Completion emails are sent to the email submitted with the upload.

`NUXT_CONTACT_RECIPIENT` is the operator inbox that receives contact-form submissions. When it is
unset, `POST /api/contact` fails with a generic delivery error and the rest of the app is
unaffected.

`NUXT_SITE_URL` is deliberately distinct from Nuxt's reserved `NUXT_APP_BASE_URL` (the route path
prefix, `app.baseURL`). The reserved variable should stay unset unless the app is served under a
subpath; the site URL is only ever read by the backend to build absolute email links.

## Operational Assumptions

This backend is designed for one API instance and one worker service sharing one SQLite database
and local storage volume on a small VPS. In-memory or local limits are not distributed across
multiple hosts.

Durable controls include queued/processing capacity, job state, retry state, signed email-link
verification inputs, expiration state, and storage reservations in SQLite. Storage reservations are
created atomically before a job is accepted and account for source bytes, generated chapters,
partial/final ZIP output, and a safety margin. They survive API restart and are released on
rejection, failure cleanup, expiration cleanup, or abandoned-reservation recovery. In-memory
controls include active upload slots, per-IP upload/job counters, and download request counters;
they reset on process restart and are intended as single-instance abuse dampening, not distributed
rate limiting.

Forwarded headers are not trusted by default. Deployment behind a reverse proxy or CDN will need an
explicit trusted-proxy policy before `X-Forwarded-*` style headers are used for client identity.
