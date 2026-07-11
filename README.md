# Chaptify

## Installation

### Prerequisites
- Run `cp .env.example .env`, and update the `.env` file as necessary.

Then run the following commands

-   Run `npm install` to install the project dependencies.

### Run the development server:

-   Run `npm run dev` or `nuxt dev` to start the development server.
  -   Open http://localhost:3000/

## Linting

-   `npm run format-check` - checks for formatting errors.
-   `npm run format` - auto-formats all files.
-   `npm run lint` - checks for Typescript errors.
-   `npm run type-check` - runs Nuxt type checking.
-   `npm run test` - runs backend tests.

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
