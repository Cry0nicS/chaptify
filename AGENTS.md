# AI Agent Guidelines: Chaptify

This file defines the architecture, conventions, and verification requirements for AI coding agents working in the `chaptify` codebase.

Chaptify is a Nuxt 4 application built with Vue 3, TypeScript, Nitro, Nuxt UI, Tailwind CSS, Zod, Mailgun, and Docker.

## Source of truth

Before changing code, inspect the existing implementation and configuration files. The repository configuration is authoritative when it differs from this document.

Important configuration files include:

- `package.json`
- `nuxt.config.ts`
- `eslint.config.mjs`
- `prettier.config.mjs`
- `.editorconfig`
- `Dockerfile`
- Docker Compose configuration, when present
- `.env.example`, when present

Do not introduce conventions that conflict with these files.

## Architecture and project structure

- `app/`: Frontend Nuxt application, including components, pages, layouts, composables, middleware, assets, and frontend-only utilities.
- `server/`: Nitro backend, including API routes, server middleware, file processing, email delivery, job handling, persistence, scheduled cleanup, and server-only utilities.
- `shared/`: Runtime-independent schemas, types, constants, and pure helpers that are safe to use from both `app/` and `server/`.
- `public/`: Static files served directly without processing.

Place code in `shared/` only when it is used by both frontend and backend code, or is intentionally safe for both runtimes.

Never import code from `app/` into `server/`, or from `server/` into `app/`.

Use existing barrel exports where applicable:

- `shared/utils/types/index.ts`
- `shared/utils/schemas/index.ts`
- `shared/utils/constants/index.ts`

Do not create new barrel files unless they simplify an established import pattern and do not introduce circular dependencies.

## Nuxt conventions

- Use Nuxt 4 directory conventions.
- Use the Vue Composition API.
- Use `<script setup lang="ts">`.
- Place `<script setup>` before `<template>`.
- Use Nuxt auto-imports for Nuxt APIs, Vue APIs, and project composables when supported.
- Do not add explicit imports for auto-imported APIs unless required by tooling, tests, or type resolution.
- Use `definePageMeta` for page metadata and route middleware.
- Use `useSeoMeta` for SEO metadata unless the project already provides a dedicated abstraction.
- Prefer `useFetch` or `useAsyncData` for Nuxt-managed data fetching.
- Use `$fetch` for imperative requests such as uploads, form submissions, job actions, and polling.
- Keep API and server logic under `server/`.
- Do not implement server behavior in frontend composables or components.
- Respect the configured Nuxt compatibility date.
- Do not disable strict TypeScript checking.

## Vue components and composables

- Keep components focused on rendering and user interaction.
- Extract reusable stateful logic into composables.
- Extract pure logic into utilities.
- Keep page components thin when logic can be delegated to feature components or composables.
- Use explicit prop and emit types.
- Avoid mutating props.
- Avoid `any`. The ESLint configuration treats explicit `any` as an error.
- Prefer `unknown` for unvalidated external values.
- Use discriminated unions for stateful workflows such as upload and processing states.

## Nuxt UI, Tailwind, and icons

Nuxt UI is the primary component system.

- Prefer Nuxt UI components over custom implementations.
- Do not recreate buttons, form controls, alerts, progress indicators, dropdowns, dialogs, or layout primitives when a suitable Nuxt UI component exists.
- Follow the existing Nuxt UI theme and color-mode configuration.
- The application supports color mode and defaults to the system preference, with dark mode as the fallback.
- Preserve light-mode and dark-mode behavior.
- Prefer Tailwind utility classes for local styling.
- Avoid scoped CSS unless Nuxt UI and Tailwind cannot reasonably express the required behavior.
- Do not add another UI framework.
- Preserve responsive behavior and accessibility.
- Prefer responsive CSS for device-aware presentation. Do not add a device-detection module unless behavior (not styling) genuinely requires it.

Use Iconify icons through Nuxt UI:

- `i-lucide-*` for general interface icons
- `i-simple-icons-*` for brand icons

Provide accessible text or labels for icon-only controls.

## Formatting

Prettier is the formatting authority.

The current configuration uses:

- 100-character print width
- 4-space indentation
- Spaces, not tabs
- Double quotes
- Semicolons
- No trailing commas
- No spaces inside object braces
- One HTML or Vue attribute per line
- LF line endings
- Final newline at the end of files
- Tailwind class sorting through `prettier-plugin-tailwindcss`

Do not describe or apply single quotes, 2-space indentation, or omitted semicolons in this repository.

The `.editorconfig` uses 4-space indentation for most files and 2-space indentation for YAML files.

Run Prettier instead of manually reproducing formatting rules.

The configured commands do not format every possible file type. When changing files not covered by `npm run format`, such as Markdown, YAML, or some configuration files, follow `.editorconfig` and the nearest existing file style.

## ESLint

ESLint combines Nuxt ESLint with `@antfu/eslint-config`.

The configuration currently:

- Enables TypeScript, Vue, and JSONC support
- Uses Antfu's less-opinionated mode
- Disables Antfu stylistic formatting so Prettier remains authoritative
- Prohibits explicit `any`
- Requires kebab-case filenames
- Exempts only `README.md` from the filename rule
- Uses 4-space indentation in Vue templates
- Disables Vue self-closing enforcement
- Requires the global Node.js `process` object rather than importing it
- Ignores `public/**` and `tsconfig.json`
- Does not require sorted keys in `package.json`

Use kebab-case for new source filenames, including Vue components and TypeScript modules, unless an existing framework convention requires otherwise.

Do not add ESLint disable comments merely to avoid fixing a valid issue. A disable comment must be narrowly scoped and explain why it is required.

## TypeScript

- TypeScript strict mode is enabled.
- Nuxt type checking is enabled.
- Avoid `any`.
- Prefer `unknown` until a value has been validated or narrowed.
- Define explicit types for API inputs, API responses, persisted records, job states, and external-provider responses.
- Reuse shared schemas and inferred types instead of duplicating structures.
- Handle nullable and optional values explicitly.
- Do not use `@ts-ignore`.
- Use `@ts-expect-error` only for a known, documented incompatibility and ensure the expected error still exists.
- Do not weaken compiler settings to make a change pass.

## Validation

Zod is the project validation library.

Validate all untrusted input on the server, including:

- Request bodies
- Query parameters
- Route parameters
- Uploaded file metadata
- Email addresses
- Job identifiers
- Download tokens
- Chapter metadata
- Environment-dependent configuration
- Data returned by external providers when its shape is not guaranteed

Prefer shared Zod schemas when the same contract is required by the app and server. Infer TypeScript types from schemas where practical.

Client-side validation improves usability but never replaces server-side validation.

## Nitro API conventions

Server API routes belong in `server/api/`.

Use appropriate HTTP methods and status codes:

- `POST` for uploads, job creation, and state-changing commands
- `GET` for job status and downloads
- `DELETE` for cancellation or explicit deletion
- `400` for malformed or invalid input
- `404` for missing or expired resources
- `409` for invalid job-state transitions
- `413` for uploads exceeding the configured limit
- `415` for unsupported media types
- `422` for structurally valid input that cannot be processed
- `429` for rate limits
- `500` for unexpected server failures
- `503` when processing capacity is temporarily unavailable

Return consistent API error objects. Do not expose stack traces, environment variables, internal paths, provider credentials, or raw provider error responses.

Do not keep an HTTP request open for the full audiobook-processing duration. Create a job, persist its state, and let the frontend poll or otherwise retrieve status.

## Runtime configuration and environment variables

Access secrets only through Nuxt server runtime configuration.

The project currently defines these server-only runtime values:

- `NUXT_MAILGUN_BASE_URL`
- `NUXT_MAILGUN_DOMAIN`
- `NUXT_MAILGUN_KEY`
- `NUXT_MAILGUN_SENDER`
- `NUXT_MAILGUN_BCC`

No public runtime configuration (`runtimeConfig.public`) is currently defined.

Rules:

- Never move Mailgun values into `runtimeConfig.public`.
- Never expose server secrets to frontend code.
- Use `useRuntimeConfig()` in the appropriate Nuxt runtime.
- Validate required production configuration during startup or before first use.
- Keep `.env.example` synchronized when environment variables are added, removed, or renamed.
- Never commit `.env` files containing real credentials.
- Docker build arguments are not an acceptable mechanism for embedding secrets into the image.
- Supply production secrets at container runtime.

## Mailgun

Mailgun is the transactional email provider and `mailgun.js` is already installed.

- Send email only from server code.
- Use a dedicated server-side Mailgun service abstraction.
- Do not instantiate provider clients throughout unrelated handlers.
- Do not call Mailgun directly from frontend code.
- Do not expose Mailgun API responses to users.
- Treat email delivery status separately from processing status.
- A Mailgun failure must not invalidate a successfully generated ZIP file.
- Record a safe, minimal error state for failed email delivery.
- Do not log full recipient addresses, credentials, download tokens, or complete temporary links.
- Download emails must state that the link expires after 12 hours.

## Audiobook processing

Chaptify accepts one M4B or MP3 audiobook and, depending on the chosen flow, either splits it into a ZIP containing one audio file per detected chapter (`split` jobs, `POST /api/jobs`) or converts the whole file to the other format — mp3 ⇄ m4b (`convert` jobs, `POST /api/convert`). Both flows share the same durable-job pipeline, distinguished by a `kind` column.

The rules below describe the split flow. Conversion differs deliberately: it has no chapter requirement (any valid mp3/m4b is accepted, including songs and clips), always re-encodes (the two formats never share a codec), and is a faithful repackage that *preserves* metadata, cover art, and embedded chapters rather than stripping them. It produces a single output file, not a ZIP.

- Prefer embedded chapter metadata.
- Inspect media using `ffprobe`.
- Process media using FFmpeg.
- Prefer stream copying when the source codec and output format permit it.
- Avoid re-encoding unless required for compatibility or explicitly selected behavior.
- Preserve chapter order.
- Prefix output filenames with zero-padded chapter numbers.
- Sanitize chapter titles before using them as filenames.
- Reject malformed, encrypted, DRM-protected, or unsupported files with a clear error.
- Generate all internal paths and filenames on the server.
- Never trust the uploaded filename or browser-supplied MIME type.
- Never interpolate user-controlled values into shell commands.
- Invoke FFmpeg and ffprobe with argument arrays using `spawn`, `execFile`, or an established process wrapper.
- Never use `shell: true`.
- Apply execution timeouts, output limits, and cancellation handling.
- Limit concurrent processing according to available CPU, memory, and disk capacity.

The frontend must represent these states clearly:

- Uploading
- Queued
- Processing
- Ready
- Failed
- Expired

## Temporary files and downloads

- Uploads and generated files are temporary.
- Do not store user files permanently.
- Keep the ZIP available for 12 hours after it becomes ready.
- Protect downloads with an unguessable, cryptographically secure token.
- A token must grant access only to its associated ZIP.
- Validate token expiry and job state before serving a file.
- Do not reveal internal paths in responses or download headers.
- Delete source files as soon as they are no longer required.
- Delete ZIP files and related job data after expiration.
- Clean files after success, failure, cancellation, process termination, and timeout.
- Implement periodic cleanup for abandoned jobs and files.
- Cleanup operations must be idempotent.
- Prevent path traversal and symlink-based escapes.
- Check available disk capacity before accepting or processing large jobs.

## Docker

Docker is part of the supported development and deployment environment.

- Treat the existing `Dockerfile` and Docker Compose configuration as the source of truth.
- Inspect them before changing build, runtime, path, user, port, volume, or health-check behavior.
- Keep build-time and runtime dependencies separate where the existing image structure permits it.
- FFmpeg and ffprobe must be available in the runtime container.
- Do not install production requirements only in a discarded build stage.
- Do not bake secrets, `.env` files, uploads, ZIP files, logs, or databases into the image.
- Store temporary and persistent runtime data only in explicitly configured writable paths.
- Preserve any configured Docker volumes when changing paths.
- Run the application as a non-root user when supported by the current container setup.
- Do not change exposed ports or container service names without updating all dependent configuration.
- Add or preserve a useful health check for the deployed application.
- Ensure the container handles termination signals so active jobs can stop safely and cleanup can run.
- Keep `.dockerignore` aligned with the repository. It should exclude development dependencies, build output, secrets, uploads, generated archives, logs, and local runtime data.
- Do not use bind-mounted source code in the production deployment.
- Validate both the normal Nuxt build and the Docker build after container-related changes.

Do not assume a Docker Compose filename or service name. Inspect the repository and use the existing names.

## Dependencies and package management

The repository uses npm and `package-lock.json`.

- Use npm.
- Do not switch package managers.
- Do not remove or regenerate `package-lock.json` without explicit instruction.
- Use `npm ci` in CI and reproducible Docker builds when a lockfile is available.
- Do not add a dependency when Nuxt, Node.js, Nuxt UI, Zod, Mailgun, or an existing package already provides the needed behavior.
- New dependencies must be maintained, compatible with the project license, and justified by the implementation.
- Do not update unrelated dependencies while implementing a feature.
- Do not manually edit generated dependency metadata unless necessary.

The `clean` script deletes `node_modules`, `.nuxt`, and `package-lock.json`. Use it only when explicitly requested or when the environment cannot be recovered with safer steps. If it is used, review and intentionally regenerate the lockfile before committing anything.

## Git hooks

The repository uses `simple-git-hooks` and `lint-staged`.

The pre-commit hook runs:

```bash
npx lint-staged
```

Staged supported files are checked with Prettier, and staged JavaScript, TypeScript, and Vue files are checked with ESLint.

Do not bypass hooks to conceal validation failures. When a hook fails, fix the underlying issue.

## Commands

Use the scripts defined in `package.json`:

```bash
npm run dev
npm run build
npm run preview
npm run generate
npm run format
npm run format-check
npm run lint
npm run type-check
```

Use `npm run generate` only for features compatible with static generation. Server API routes, processing workers, Mailgun delivery, temporary downloads, and FFmpeg processing require a server runtime and must not be designed as static-only functionality.

## Testing and verification

`npm run test` runs the Vitest suite (`tests/backend/*.test.ts` grouped by scope, plus
`tests/frontend.test.ts`; shared backend fixtures live in `tests/backend/helpers.ts`). The
synthetic media tests require `ffmpeg`/`ffprobe` on the PATH. Do not claim that tests passed
unless they were actually run.

Before completing a normal code change, run:

```bash
npm run format
npm run lint
npm run type-check
npm run build
```

Use `npm run format-check` when verifying formatting without modifying files.

For Docker-related changes, also build the image using the repository's existing Docker command and validate that the container starts successfully.

When tests are added, cover at least:

- Shared pure helpers
- Zod input validation
- Job-state transitions
- Filename sanitization
- Download-token creation and expiry
- API handlers
- Cleanup behavior
- Processing failure paths
- Email failure handling

If a verification command cannot run, report that clearly. Do not claim completion while relevant checks fail.

## Change discipline

- Inspect the current implementation before modifying it.
- Follow established patterns instead of creating parallel abstractions.
- Keep changes limited to the requested task.
- Do not refactor unrelated code.
- Do not modify generated files such as `.nuxt/**`.
- Do not commit secrets, temporary uploads, generated ZIP files, runtime databases, logs, or build output.
- Update documentation and `.env.example` when behavior or configuration changes.
- Preserve backward compatibility unless the task explicitly requires a breaking change.
- Clearly document migrations and new environment variables.
- Do not silently change retention periods, file-size limits, supported formats, ports, storage paths, or public API contracts.
- Do not weaken security, validation, cleanup, linting, or type checking to make an implementation easier.

## Completion requirements

A task is complete only when:

- The requested behavior is implemented.
- Relevant error and edge states are handled.
- Server inputs are validated.
- Security and cleanup implications are addressed.
- Formatting passes.
- Linting passes.
- Type checking passes.
- The Nuxt production build passes.
- Relevant tests pass, when a test suite exists.
- The Docker image builds and starts when container behavior changed.
- No secrets or generated runtime files are included.
- Documentation and environment examples are updated when required.
- The final response summarizes the changes, verification performed, and remaining limitations.
