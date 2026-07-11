# AI Agent Guidelines: Chaptify

This file defines the architecture, conventions, and verification requirements for AI coding agents working in the `chaptify` codebase.

Chaptify is built with Nuxt 4, Vue 3, TypeScript, Tailwind CSS, Nuxt UI, and Nitro.

## Architecture and project structure

* `app/`: Frontend Nuxt application, including components, pages, layouts, composables, middleware, and frontend-only utilities.
* `server/`: Nitro backend, including API routes, server middleware, database access, file processing, email delivery, job handling, and server-only utilities.
* `shared/`: Framework-agnostic code that is safe to use in both the frontend and backend, such as schemas, types, constants, and pure helper functions.
* `public/`: Static files that are served directly without processing.

Place code in `shared/` only when it is used by both `app/` and `server/`, or when it is intentionally designed to be runtime-independent.

Never import code from `app/` into `server/`, or from `server/` into `app/`.

Use the existing barrel exports where applicable:

* `shared/utils/types/index.ts`
* `shared/utils/schemas/index.ts`
* `shared/utils/constants/index.ts`

Do not create new barrel export files unless they simplify an existing import pattern.

## Vue and Nuxt conventions

* Use the Vue Composition API.
* Use `<script setup lang="ts">`.
* Place `<script setup>` before `<template>`.
* Use Nuxt auto-imports for Nuxt composables, Vue APIs, and project composables where supported.
* Do not add explicit imports for auto-imported APIs unless required by tooling or tests.
* Extract reusable business logic from `.vue` files into composables or utility modules.
* Keep components focused on presentation and user interaction.
* Use `definePageMeta` for page-level metadata and middleware.
* Use `useSeoMeta` or the existing SEO abstraction for metadata.
* Prefer `useFetch` or `useAsyncData` for Nuxt-managed data fetching.
* Use `$fetch` for imperative API requests such as form submissions and job actions.

## Nuxt UI and styling

The project uses Nuxt UI as its primary component system.

* Prefer Nuxt UI components over custom implementations.
* Do not recreate buttons, inputs, modals, alerts, progress indicators, dropdowns, or layout primitives when an appropriate Nuxt UI component exists.
* Follow existing component variants and application theme configuration.
* Prefer Tailwind utility classes for local layout and styling.
* Avoid scoped CSS unless the design cannot reasonably be implemented with Nuxt UI or Tailwind.
* Do not introduce another component library.
* Preserve responsive behavior and accessibility.

Use Iconify icons through Nuxt UI components:

* `i-lucide-*` for general interface icons
* `i-simple-icons-*` for brand icons

Icons must have an accessible label when their meaning is not already conveyed by nearby text.

## TypeScript conventions

* Use strict TypeScript.
* Avoid `any`.
* Prefer `unknown` when a value has not yet been validated.
* Define explicit types for API inputs, API responses, job states, and persisted records.
* Reuse shared types and schemas instead of defining equivalent structures independently.
* Use discriminated unions for stateful workflows where appropriate.
* Handle nullable and optional values explicitly.
* Do not suppress TypeScript errors with `@ts-ignore` unless the reason is documented and no safer alternative exists.

## Validation and API conventions

All untrusted input must be validated on the server.

This includes:

* Request bodies
* Query parameters
* Route parameters
* Uploaded file metadata
* Email addresses
* Job identifiers
* Download tokens
* Chapter metadata
* Environment-dependent configuration

Use the project’s existing schema validation library and shared schemas.

Server API routes belong in `server/api/`.

Use appropriate HTTP methods and status codes:

* `POST` for creating uploads or processing jobs
* `GET` for reading job state or downloading files
* `DELETE` for explicit cancellation or deletion
* `400` for invalid input
* `404` for missing or expired resources
* `409` for invalid job state transitions
* `413` for files exceeding the upload limit
* `429` for rate limits
* `500` for unexpected server errors

Do not expose internal filesystem paths, stack traces, environment variables, or provider responses to clients.

Return consistent API error objects using the project’s existing error format.

## Server and security rules

* Secrets must only be accessed through server runtime configuration.
* Never expose Mailgun credentials, signing secrets, database paths, or internal service URLs through public runtime configuration.
* Never trust filenames or MIME types supplied by the browser.
* Validate uploaded media using `ffprobe`.
* Generate server-side filenames and job identifiers.
* Sanitize all filenames included in ZIP archives.
* Never construct shell commands by concatenating user input.
* Invoke FFmpeg and ffprobe using argument arrays through `spawn`, `execFile`, or the project’s existing process wrapper.
* Do not use `shell: true`.
* Run file-processing operations with explicit timeouts and cancellation handling.
* Ensure temporary files are removed after successful processing, failed processing, cancellation, and expiration.
* Prevent path traversal when reading or writing files.
* Download links must use unguessable tokens and must expire after 12 hours.
* A download token must only provide access to its associated ZIP file.
* Do not log email addresses, access tokens, full download URLs, or sensitive file metadata unnecessarily.

## Audiobook processing rules

Chaptify accepts a single M4B or MP3 audiobook and produces a ZIP containing one audio file per chapter.

* Prefer embedded chapter metadata when available.
* Use FFmpeg and ffprobe for media inspection and processing.
* Prefer stream copying when the source codec and output format allow it.
* Avoid re-encoding unless required by the selected output format or precise cutting mode.
* Preserve chapter order.
* Prefix output files with zero-padded chapter numbers.
* Sanitize chapter names before using them as filenames.
* Reject unsupported, encrypted, malformed, or password-protected files with a clear error.
* Processing must happen asynchronously through the job worker.
* API requests must not remain open for the complete processing duration.
* The final ZIP must remain downloadable for 12 hours.
* Expired ZIP files and associated temporary files must be deleted automatically.
* Failed jobs must not leave uploaded or generated files on disk indefinitely.

The frontend must show clear states for:

* Uploading
* Queued
* Processing
* Ready
* Failed
* Expired

## Email delivery

Mailgun is used for transactional email.

* Email sending must happen on the server.
* Do not call Mailgun directly from frontend code.
* Use the existing Mailgun service abstraction.
* Email delivery failure must not invalidate an otherwise successful processing job.
* Record email delivery status separately from processing status.
* Download emails must contain the temporary download link and its expiration time.
* Do not include internal job IDs or filesystem information in emails.

## Formatting and linting

Formatting is governed by Prettier:

* 100-character print width
* Single quotes
* 2-space indentation
* No trailing commas

Linting is governed by `@nuxt/eslint`.

The project explicitly enforces:

* `commaDangle: 'never'`
* `braceStyle: '1tbs'`

Follow the existing formatting and lint configuration. Do not introduce conflicting local formatting rules.

## Dates, numbers, and locales

* Use `de-DE` for user-facing dates and numbers unless the surrounding feature explicitly requires another locale.
* Store timestamps in UTC.
* Use ISO 8601 timestamps for API payloads and persistence.
* Convert timestamps to the user-facing locale only in the frontend.
* Do not rely on the server’s local timezone.

## Dependencies

* Use the existing package manager and lockfile.
* Do not switch package managers.
* Do not remove or regenerate the lockfile without explicit instruction.
* Do not add a dependency when the same functionality is already available in Nuxt, Node.js, Nuxt UI, or an existing project dependency.
* New dependencies must be actively maintained, compatible with the project license, and justified by the implementation.
* Do not update unrelated dependencies while implementing a feature.

## Testing and verification

Before completing a change, run the checks relevant to the modified code:

```bash
npm run format
npm run lint
npm run type-check
```

Run existing automated tests when available.

Add or update tests for:

* Shared pure functions
* Input validation
* Job state transitions
* Filename sanitization
* Token expiration
* API handlers
* Cleanup behavior
* Processing failure paths

Do not claim a change is complete if linting, type checking, or relevant tests fail.

If a command cannot be run, state this clearly in the final response.

## Developer commands

```bash
npm run dev
npm run format
npm run lint
npm run type-check
```

Use `npm run clean` only when explicitly requested or when the normal build environment cannot be recovered. It may remove generated files, installed dependencies, or lockfiles.

## Change discipline

* Inspect the existing implementation before modifying it.
* Follow existing patterns instead of introducing parallel abstractions.
* Keep changes limited to the requested feature.
* Do not refactor unrelated code.
* Do not modify generated files.
* Do not commit secrets, temporary uploads, generated ZIP files, database files, logs, or build output.
* Update documentation when behavior, configuration, commands, or environment variables change.
* Preserve backward compatibility unless the task explicitly requires a breaking change.
* Clearly document any migration or new environment variable.

## Completion requirements

A task is complete only when:

* The requested behavior is implemented.
* Relevant error states are handled.
* Security and cleanup implications are addressed.
* Formatting passes.
* Linting passes.
* Type checking passes.
* Relevant tests pass.
* No secrets or generated files are included.
* The final response summarizes the implemented changes and identifies any remaining limitations.
