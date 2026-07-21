# Chaptify Deployment Runbook

This is an ordered go-live runbook for a single-VPS production deployment of Chaptify:

- **VPS**: Hetzner Cloud, EU region (Falkenstein/Nuremberg/Helsinki), Ubuntu 24.04 LTS.
- **Domain**: registered at any third-party registrar, DNS delegated to Cloudflare.
- **Email**: Mailgun (EU region).
- **Deploy**: the repo's Docker Compose stack (API + worker + cleanup, one image, shared volume, plain HTTP on `:3000`), fronted by a Caddy reverse proxy that terminates TLS.

Execute the phases top to bottom. Every provider-specific number is cited inline; a consolidated **Sources** list is at the end. Prices and plan limits are dated where they are plan/version-dependent. Verified as of **2026-07-21**.

---

## Key architectural decision (read before Phase 1)

> **Chaptify accepts uploads up to 1.6 GB** (`NUXT_MAX_UPLOAD_BYTES=1610612736`). Cloudflare's **proxied** (orange-cloud) request-body limit is **100 MB on Free and Pro, 200 MB on Business, 500 MB on Enterprise** — anything larger is rejected at the edge with HTTP `413` and the request never reaches the origin ([Cloudflare 413 docs](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-413/)). The limit is only raised beyond 500 MB on Enterprise. **A 1.6 GB upload cannot pass through a proxied Cloudflare record on any non-Enterprise plan.**
>
> **Decision: serve the Chaptify application hostname as a DNS-only "grey-cloud" record** so uploads connect straight to the VPS and bypass Cloudflare's body limit entirely. DNS-only records return your origin IP and traffic skips Cloudflare's proxy layer ([Cloudflare proxy status](https://developers.cloudflare.com/dns/proxy-status/)).
>
> **Trade-off**: the app hostname loses Cloudflare's proxy benefits — WAF, CDN/caching, DDoS mitigation, and origin-IP hiding — and exposes the VPS IP publicly. Mitigate with the Hetzner Cloud Firewall + `ufw` + fail2ban (Phase 2) and Chaptify's own per-IP rate limits. You may still proxy the marketing/apex hostname (orange-cloud) for those pages; only the hostname that handles uploads must be grey-cloud.
>
> This choice drives the DNS topology (Phase 1/5), the TLS strategy (Phase 4 — Caddy gets Let's Encrypt certs directly because there is no Cloudflare proxy in front of the app), and the trusted-proxy config (Phase 3 — a single local proxy, so `NUXT_TRUST_PROXY=true`).
>
> The alternative — keeping the app orange-cloud and requiring users to upload in <100 MB chunks, or buying Enterprise — is not viable for this app and is not covered here.

---

## Phase R — Repository preparation (do this now, before the domain)

Local, committed changes that make the repo deployable. They add a **production-only** path without
altering local development, `npm run smoke:docker`, or CI. Everything here is doable and verifiable
before buying the domain or the VPS — re-applying this phase from scratch reproduces the deployable
state. It is listed first precisely so a from-zero rebuild has the recipe in one place.

### R.0 One base file, one production overlay

| Environment | Command | App HTTP port | Public TLS / proxy |
|-------------|---------|---------------|--------------------|
| Local dev (default) | `npm run dev` + `npm run worker:dev` (2nd shell) | Nitro dev `:3000` | none |
| Local Docker / smoke | `docker compose up` / `npm run smoke:docker` | `127.0.0.1:3000` | none |
| CI | `.github/workflows/ci.yml` (base file only) | `127.0.0.1:3000` | none |
| **Production** | base **+** `docker-compose.prod.yml` (see R.4) | `127.0.0.1:3000` (VPS loopback only) | **Caddy on 80/443, automatic HTTPS** |

Production is an **explicit overlay**, deliberately **not** named `docker-compose.override.yml`:
Compose auto-merges an override file into *every* plain `docker compose` call, which would silently
change local dev, the smoke test, and CI. A differently-named overlay applies only when you ask for
it (`-f …` or `COMPOSE_FILE`), so the base file — and everything that depends on it — stays untouched.

### R.1 Base: bind the app port to loopback (`docker-compose.yml`)

Change the published port from `3000:3000` to `127.0.0.1:3000:3000`. The container's plain-HTTP port
is then reachable only on the local loopback, never a public interface. Local Docker
(`localhost:3000`) and the smoke test (`127.0.0.1:3000`) are unaffected; on the VPS it keeps the app
off the internet so Caddy is the only public entrypoint. This is the single change to the committed
base file.

### R.2 Production overlay (`docker-compose.prod.yml`, new)

Adds one `caddy` service (`caddy:2-alpine`) that publishes 80/443, terminates TLS with an automatic
Let's Encrypt certificate, and reverse-proxies to the app over the internal compose network as
`chaptify:3000`. It inherits the base `chaptify` / `worker` / `cleanup` services and the
`chaptify-storage` volume unchanged, and persists issued certs in a `caddy-data` volume. It reads
`DOMAIN` from `.env` and fails fast if unset.

### R.3 Caddy config (`caddy/Caddyfile`, new)

Automatic HTTPS for `{$DOMAIN}` → `reverse_proxy chaptify:3000`, with **no request-body cap** so
1.6 GB uploads pass through (the app enforces its own limit). Mounted read-only into the Caddy
container.

### R.4 `.env` — `DOMAIN` and the overlay shortcut

`.env.example` gains `DOMAIN` (blank locally) and a commented `COMPOSE_FILE`. On the VPS, set both:

```dotenv
DOMAIN=chaptify.org
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
```

With `COMPOSE_FILE` set, every `docker compose …` command on the VPS transparently includes the
overlay, so the runbook's plain `docker compose` commands "just work" in production. Locally the
variable is unset, so dev / smoke / CI use the base file alone. (You can always pass
`-f docker-compose.yml -f docker-compose.prod.yml` explicitly instead.)

### R.5 Verify the artifact deploys clean

Run the repo's full gate so a broken build is caught here, not on the box:

```bash
npm run format && npm run lint && npm run type-check && npm run build && npm run test
docker compose config                                                                      # base still valid
DOMAIN=example.com docker compose -f docker-compose.yml -f docker-compose.prod.yml config   # overlay valid
npm run smoke:docker                                                                       # optional: full container round-trip
```

### R.6 Backup script (`deploy/backup.sh`, staged for Phase 7)

A WAL-safe SQLite `.backup` run from a throwaway Alpine container against the storage volume, with
local-snapshot pruning and a clearly marked hook for shipping the snapshot off-box. Version-controlled
but inert until scheduled via cron on the VPS (Phase 7).

---

## Phase 0 — Prerequisites

Collect before you start:

- A registered domain (any registrar). This runbook uses `chaptify.org`, app on the apex, marketing optionally on `www`.
- A Cloudflare account (free plan is sufficient).
- A Mailgun account, EU region.
- An SSH keypair. Generate one if needed: `ssh-keygen -t ed25519 -C "chaptify-deploy"`.
- Local tools: `git`, `ssh`, and the project checked out.

Generate the download-link signing secret now (used in Phase 3). It must be at least 32 random characters ([`NUXT_DOWNLOAD_SIGNING_SECRET`](backend.md)):

```bash
openssl rand -hex 32   # 64 hex chars, comfortably over the 32-char minimum
```

Keep it secret and stable — rotating it invalidates all outstanding emailed download links.

---

## Phase 1 — Domain and DNS onboarding to Cloudflare

You are delegating DNS to Cloudflare (a nameserver change at the registrar). The flow is registrar-agnostic ([Cloudflare full-setup docs](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)):

1. In the Cloudflare dashboard, **Add a domain** → enter the apex (`chaptify.org`) → choose the **Free** plan.
2. Cloudflare scans and imports existing DNS records. Review them; you will finalize the record set in Phase 5.
3. Cloudflare assigns **two nameservers** (e.g. `xxx.ns.cloudflare.com`). Copy them.
4. At your **registrar**, **disable DNSSEC** if currently enabled, then replace the domain's nameservers with the two Cloudflare nameservers.
5. Wait for activation. The zone is **Active** when Cloudflare emails you and the dashboard shows "Active" (propagation up to 24 h) ([Cloudflare full-setup docs](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)).

Do not create the app A/AAAA records yet — you need the VPS IP first (Phase 2). Mailgun records come in Phase 6.

---

## Phase 2 — Provision and harden the VPS

### 2.1 Recommended server type

**Recommendation: Hetzner Cloud `CX33` — 4 vCPU (Intel/AMD), 8 GB RAM, 80 GB NVMe SSD, 20 TB traffic, 1 IPv4, EU location.** Post the 15 June 2026 price adjustment this is **€8.49/month** ([Hetzner price-adjustment docs, June 2026](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/); specs on the [Hetzner cost-optimized page](https://www.hetzner.com/cloud/cost-optimized), CX plans include 20 TB traffic + 1 IPv4 per the [new-CX-plans press release](https://www.hetzner.com/pressroom/new-cx-plans/)).

Justification:

- **CPU**: `NUXT_WORKER_CONCURRENCY=1` means one FFmpeg re-encode runs at a time; `convert` jobs always re-encode (mp3⇄m4b never share a codec) and audiobooks can be up to 30 h (`NUXT_MAX_AUDIOBOOK_DURATION_SECONDS=108000`). 4 vCPU lets FFmpeg use multiple threads for a single long transcode while the API and SQLite stay responsive.
- **Disk (the binding constraint)**: worst-case working set is driven by 1.6 GB uploads. Chaptify reserves `source × NUXT_STORAGE_RESERVATION_MULTIPLIER (4)` + `NUXT_STORAGE_RESERVATION_SAFETY_BYTES (256 MB)` ≈ **~6.7 GB per active job**, and up to `NUXT_MAX_QUEUED_JOBS (10)` uploaded source files (~1.6 GB each) can sit on disk awaiting processing (~16 GB). Add the OS + Docker image (~5 GB) and nightly SQLite backups. **80 GB is comfortable**; the 40 GB `CX23` (€5.49/mo) is only safe if you lower `NUXT_MAX_QUEUED_JOBS`.
- **RAM**: FFmpeg transcoding and SQLite are not memory-hungry; 8 GB is ample headroom for the three containers.

Alternatives (all EU, same 20 TB traffic; prices are post-June-2026 per the [price-adjustment docs](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)):

| Type | Arch | vCPU | RAM | Disk | €/mo | Note |
|------|------|------|-----|------|------|------|
| `CX23` | Intel/AMD | 2 | 4 GB | 40 GB | 5.49 | Cheapest; tighten `NUXT_MAX_QUEUED_JOBS` for the 40 GB disk |
| **`CX33`** | **Intel/AMD** | **4** | **8 GB** | **80 GB** | **8.49** | **Recommended** |
| `CAX21` | Ampere ARM64 | 4 | 8 GB | 80 GB | 10.49 | Valid ARM alternative (see below); currently pricier than CX33 |
| `CX43` | Intel/AMD | 8 | 16 GB | 160 GB | 15.99 | Headroom for higher concurrency/volume |

**ARM (CAX) is fully supported** but currently costs more than the equivalent CX. The runtime image builds cleanly on arm64: `node:22-alpine3.24` is a multi-arch official image (amd64 + arm64v8) ([Docker Hub node](https://hub.docker.com/_/node)), and the Dockerfile's only extra runtime dependency, `ffmpeg`, is in Alpine's community repo for aarch64. If you choose CAX, build the image on the ARM box (or `docker buildx --platform linux/arm64`). Given CX33 is cheaper today, x86 is the default recommendation.

> Prices exclude VAT and may carry a small IPv4 address surcharge depending on Hetzner's current terms — confirm the exact line items in the Hetzner Console at order time. (The specific IPv4 monthly fee was not verified against a primary source for this document.)

### 2.2 Create the server

In the Hetzner Cloud Console: **Add Server** → location **Falkenstein / Nuremberg / Helsinki** (EU) → image **Ubuntu 24.04** → type **CX33** → add your **SSH key** (do not use a root password) → create. Note the assigned public IPv4 (and IPv6).

### 2.3 Hetzner Cloud Firewall

Attach a Hetzner Cloud Firewall to the server allowing only inbound **22/tcp (SSH)**, **80/tcp (HTTP, for ACME)**, **443/tcp (HTTPS)** — see [Hetzner Cloud Firewall docs](https://docs.hetzner.com/cloud/firewalls/overview/). This is a network-edge filter independent of the on-host `ufw`; run both (defense in depth). Do **not** open `3000`.

### 2.4 Host hardening (Ubuntu 24.04)

SSH in as root using your key, then create an admin user and lock down SSH:

```bash
adduser deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
```

Edit `/etc/ssh/sshd_config` (or a drop-in in `/etc/ssh/sshd_config.d/`) to enforce key-only auth and disable root login, then reload — see the [sshd_config manual](https://manpages.ubuntu.com/manpages/noble/en/man5/sshd_config.5.html):

```
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
```

```bash
systemctl reload ssh
```

Host firewall with `ufw` ([Ubuntu UFW guide](https://help.ubuntu.com/community/UFW)):

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Automatic security updates ([Ubuntu automatic updates guide](https://documentation.ubuntu.com/server/how-to/software/automatic-updates/)):

```bash
apt update && apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

fail2ban for SSH brute-force protection:

```bash
apt install -y fail2ban
systemctl enable --now fail2ban
```

### 2.5 Install Docker Engine + Compose (official repo)

Follow the [official Docker Engine install for Ubuntu](https://docs.docker.com/engine/install/ubuntu/) (adds Docker's apt repo and installs `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, `docker-compose-plugin`). Then enable non-root Docker for the `deploy` user ([Docker post-install](https://docs.docker.com/engine/install/linux-postinstall/)):

```bash
usermod -aG docker deploy   # log out/in for the group to take effect
```

From here on, work as `deploy`, not root.

---

## Phase 3 — Deploy the Chaptify stack

### 3.1 Get the code and write the production `.env`

```bash
sudo mkdir -p /opt/chaptify && sudo chown deploy:deploy /opt/chaptify
git clone <your-repo-url> /opt/chaptify
cd /opt/chaptify
cp .env.example .env
```

Edit `.env` for production. Required values ([backend.md](backend.md)):

```dotenv
NODE_ENV=production

# Public HTTPS origin used in completion-email download links.
# MUST be the https domain. Do NOT set NUXT_APP_BASE_URL (Nuxt's reserved route-prefix var).
NUXT_SITE_URL=https://chaptify.org

# Storage root INSIDE the container (Compose sets this to /data/chaptify already).
NUXT_STORAGE_ROOT=/data/chaptify

# Mailgun (EU region — note the EU base URL).
NUXT_MAILGUN_BASE_URL=https://api.eu.mailgun.net
NUXT_MAILGUN_DOMAIN=mg.chaptify.org
NUXT_MAILGUN_KEY=<your-mailgun-sending-api-key>
NUXT_MAILGUN_SENDER=Chaptify <noreply@mg.chaptify.org>

# 32+ random chars from `openssl rand -hex 32` (Phase 0). Keep stable.
NUXT_DOWNLOAD_SIGNING_SECRET=<generated-secret>

# Single local reverse proxy in front of the app (see 3.2).
NUXT_TRUST_PROXY=true

# Production Docker overlay (Phase R): the public host Caddy serves + requests a cert for, and the
# shortcut that makes every `docker compose` command on the VPS include the prod overlay.
DOMAIN=chaptify.org
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml

# Optional: contact-form inbox. Leave unset to disable /api/contact.
NUXT_CONTACT_RECIPIENT=you@chaptify.org
```

`NUXT_MAX_UPLOAD_BYTES` stays at its 1.6 GB default. The remaining operational defaults in `.env.example` are fine for a single VPS.

> **`NUXT_SITE_URL` must be the public HTTPS origin** — it is the only thing that builds absolute links in completion emails. It is deliberately **not** `NUXT_APP_BASE_URL`, which is Nuxt's reserved route-path-prefix variable and must stay unset unless the app is served under a subpath ([backend.md](backend.md)).

### 3.2 Trusted-proxy configuration (`NUXT_TRUST_PROXY`)

Chaptify's per-IP rate limits key on the client IP. By default (`NUXT_TRUST_PROXY=""`) the app trusts only the direct socket peer. Behind a reverse proxy the socket peer is the proxy, so **every client would collapse to one IP and the rate limits would misfire** unless you configure trust. The resolver (`server/utils/backend/rate-limits.ts`) understands three modes; it reads **`X-Forwarded-For`** only (not `CF-Connecting-IP`), so the proxy must populate `X-Forwarded-For` correctly:

**(a) App behind only a local Caddy on the same host — the recommended topology.** Set:

```dotenv
NUXT_TRUST_PROXY=true
```

`true` takes the **right-most `X-Forwarded-For` hop**. Caddy's `reverse_proxy` appends the real client IP as the right-most entry, so this yields the correct client. This is safe **only because the app's HTTP port is never publicly reachable** — the base compose binds it to loopback (R.1) and the production overlay puts Caddy in front as the sole public entrypoint (Phase 3.3 / Phase 4). If the app port were exposed to the internet, an attacker could connect directly and forge `X-Forwarded-For`, and `true` would blindly trust the forged right-most value. (Using `true` rather than a `127.0.0.1` trust list also sidesteps a Docker quirk: Caddy runs as a compose service and reaches the app over the internal bridge network, so the app sees the request arriving from Caddy's container IP — not `127.0.0.1` — which an IP-list mode would otherwise have to enumerate.)

**(b) App behind Caddy *and* the Cloudflare proxy (only if you orange-cloud the app hostname — NOT recommended here because of the upload limit).** Cloudflare sends the real client in `CF-Connecting-IP` and appends its own edge IP to `X-Forwarded-For` when proxying ([Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/)). Since Chaptify reads only `X-Forwarded-For`, have Caddy rewrite it from Cloudflare's header so the app sees a clean single client IP:

```
# inside the site block
reverse_proxy 127.0.0.1:3000 {
    header_up X-Forwarded-For {http.request.header.Cf-Connecting-Ip}
}
```

Then keep `NUXT_TRUST_PROXY=true` (right-most hop = the client IP Caddy just set). Restrict Caddy to Cloudflare's IP ranges (Hetzner/`ufw` firewall or Cloudflare Authenticated Origin Pulls) so `CF-Connecting-IP` cannot be spoofed by a direct connection.

> **Spoofing warning**: never set `NUXT_TRUST_PROXY=true` while the app is reachable by anything other than a trusted proxy. If multiple untrusted hops are possible, use the **CIDR/IP list mode** instead (e.g. `NUXT_TRUST_PROXY=127.0.0.1,::1,172.16.0.0/12`): the app then trusts `X-Forwarded-For` only when the socket peer is a listed proxy and walks the header right-to-left returning the first non-trusted hop, which defeats injected left-most entries.

### 3.3 The app port is never public

This is already handled by the repo assets from **Phase R**, so there is nothing to configure by hand here — just understand the posture:

- The **base `docker-compose.yml`** binds the app to `127.0.0.1:3000:3000` (loopback only), so the container's plain-HTTP port is never reachable from a public interface ([Compose ports reference](https://docs.docker.com/reference/compose-file/services/#ports)). Local dev and `npm run smoke:docker` are unaffected.
- The **production overlay `docker-compose.prod.yml`** adds Caddy as a compose service that reaches the app over the internal network as `chaptify:3000` and is the only service publishing public ports (80/443).

The internet can therefore reach Chaptify only through Caddy over HTTPS; the plain-HTTP port stays confined to the VPS loopback. This is also what makes `NUXT_TRUST_PROXY=true` safe (3.2).

### 3.4 Build and start

With `COMPOSE_FILE` set in `.env` (R.4), plain `docker compose` commands already include the prod overlay, so this brings up the app **and** Caddy:

```bash
cd /opt/chaptify
docker compose up --build -d
docker compose ps                       # chaptify, worker, cleanup, caddy
docker compose logs -f chaptify caddy   # watch for "listening on :3000" and Caddy startup
```

The image is Node 22 Alpine + FFmpeg, runs as the non-root `appuser`, and the API container healthcheck hits `/api/health` (per the Dockerfile and `docker-compose.yml`). Confirm the app directly on the VPS loopback (bypassing Caddy):

```bash
curl -fsS http://127.0.0.1:3000/api/health && echo OK
```

---

## Phase 4 — TLS and reverse proxy (Caddy as a compose service)

Caddy is a container in the production overlay (`docker-compose.prod.yml`, Phase R) — there is **no host-level install**. Because the app hostname is **grey-cloud (DNS-only)**, there is no Cloudflare proxy in the request path, so Caddy obtains and serves a **Let's Encrypt** certificate directly and terminates TLS on the VPS.

Caddy's automatic HTTPS activates for any site address that is a domain name; it obtains certificates via ACME (Let's Encrypt, with ZeroSSL failover) using the **HTTP-01 challenge on port 80** or the **TLS-ALPN-01 challenge on port 443**, both requiring the domain's A/AAAA records to point at the box and those ports open externally ([Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)). HTTP-01 places a token at `/.well-known/acme-challenge/` served over port 80 ([Let's Encrypt challenge types](https://letsencrypt.org/docs/challenge-types/)). Phase 1's firewall opened 80 and 443, and Phase 5 points DNS at the box — so ACME will succeed.

> Because the app record is DNS-only, HTTP-01 works normally. If you were to proxy the record through Cloudflare (orange-cloud), HTTP-01/TLS-ALPN-01 would hit Cloudflare instead of Caddy; you would then need the **DNS-01** challenge (a Cloudflare API token) or a **Cloudflare Origin CA** certificate ([Let's Encrypt challenge types](https://letsencrypt.org/docs/challenge-types/); [Cloudflare Origin CA](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/)). Not needed with the recommended grey-cloud topology.

### 4.1 How Caddy is wired

The `caddy` service (`caddy:2-alpine`) publishes 80/443, mounts the committed `caddy/Caddyfile` read-only, and persists issued certificates in the `caddy-data` volume so they survive restarts. It reverse-proxies to the app over the internal compose network — `reverse_proxy chaptify:3000` — so the app's own port never needs to be public ([Caddy reverse_proxy directive](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)). `DOMAIN` (from `.env`) fills the site address.

The committed `caddy/Caddyfile`:

```caddyfile
{$DOMAIN} {
    encode zstd gzip
    reverse_proxy chaptify:3000
}
```

Notes:

- Caddy sets `X-Forwarded-For` (right-most = real client), `X-Forwarded-Proto`, and `X-Forwarded-Host` on the upstream request by default, which is exactly what `NUXT_TRUST_PROXY=true` consumes (3.2).
- Caddy **streams request bodies and imposes no default body-size cap**, so 1.6 GB uploads pass through to the app (which enforces its own `NUXT_MAX_UPLOAD_BYTES`). Do **not** add a restrictive `request_body { max_size ... }` directive, or you will re-introduce the very limit you grey-clouded to avoid.
- Caddy redirects HTTP→HTTPS automatically, so plain-HTTP visitors are upgraded at the origin.
- To also serve `www`, add it to the site line (`{$DOMAIN}, www.{$DOMAIN} { … }`) and create the matching DNS record (Phase 5).

Caddy starts with the stack (`docker compose up -d`, overlay included via `COMPOSE_FILE`). Certificate issuance completes once DNS resolves to the box (Phase 5); watch it with `docker compose logs -f caddy`. After editing the Caddyfile, reload with:

```bash
docker compose restart caddy
```

---

## Phase 5 — Cloudflare DNS records

Create the records below in the Cloudflare zone. **Proxy status is the critical column.** The app hostname MUST be **DNS-only (grey cloud)** so 1.6 GB uploads bypass Cloudflare's body limit (see Key architectural decision).

| Name | Type | Value | Proxy | Purpose |
|------|------|-------|-------|---------|
| `chaptify.org` (apex) | `A` | `<VPS IPv4>` | **DNS only (grey)** | App — must bypass Cloudflare body limit |
| `chaptify.org` (apex) | `AAAA` | `<VPS IPv6>` | **DNS only (grey)** | App over IPv6 (omit if no IPv6) |
| `www` | `A` / `CNAME` | `<VPS IPv4>` or `chaptify.org` | grey if it serves the app; orange only if it is a separate static marketing page | See note |
| SSL/TLS mode | — | **Full (strict)** *if any record is proxied*; irrelevant for grey-cloud (Caddy's LE cert is served directly) | — | Encryption mode |

Notes:

- **www / marketing split**: if `www` (or a separate `app.` host) is the upload endpoint, keep it **grey**. You may orange-cloud a *separate* static marketing hostname that never handles uploads to gain Cloudflare's CDN/WAF there.
- **SSL/TLS mode** ([Cloudflare SSL modes](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/)): for a **grey-cloud** record the browser talks directly to Caddy's Let's Encrypt certificate — the zone SSL/TLS mode does not apply to that hostname. For any **orange-cloud** hostname you keep, use **Full (strict)** (edge↔origin HTTPS with certificate validation against a public CA like Let's Encrypt, or a [Cloudflare Origin CA](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/) cert). Never use **Flexible** (edge→origin is plain HTTP) or **Full** (no cert validation) for a production origin — Cloudflare recommends Full or Full (strict) ([Cloudflare SSL modes](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/)).
- **Always Use HTTPS**: for any proxied hostname, enable it in SSL/TLS → Edge Certificates ([Cloudflare Always Use HTTPS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/)). For grey-cloud, Caddy already redirects HTTP→HTTPS at the origin.

Once the app A/AAAA records resolve to the VPS, reload Caddy (or just wait) and it will complete ACME issuance. Confirm: `curl -I https://chaptify.org` returns a valid TLS response.

---

## Phase 6 — Mailgun sender-domain verification

Chaptify sends completion emails via Mailgun. You must verify the sending domain (`NUXT_MAILGUN_DOMAIN`, e.g. `mg.chaptify.org`) by adding DNS records. The app is configured for the **EU region** (`NUXT_MAILGUN_BASE_URL=https://api.eu.mailgun.net`); region affects only the API base URL, not the DNS record set ([Mailgun DNS FAQ](https://help.mailgun.com/hc/en-us/articles/360011565514-DNS-frequently-asked-questions)).

1. In the Mailgun dashboard (**EU region**), add the sending domain `mg.chaptify.org` and open its **Domain Verification & DNS** page.
2. Add the records Mailgun shows. The set is ([Mailgun domain verification](https://documentation.mailgun.com/docs/mailgun/user-manual/domains/domains-verify), [Mailgun setup guide](https://help.mailgun.com/hc/en-us/articles/32884700912923-Domain-Verification-Setup-Guide)):

| Name | Type | Value | Required | Purpose |
|------|------|-------|----------|---------|
| `mg.chaptify.org` | `TXT` | `v=spf1 include:mailgun.org ~all` | Yes | SPF (sender authorization) |
| `<key>._domainkey.mg.chaptify.org` | `TXT` | *(long public key from the Mailgun dashboard — per-domain)* | Yes | DKIM (signature) |
| `mg.chaptify.org` | `MX` | `mxa.mailgun.org` (priority 10) | Yes* | Receiving |
| `mg.chaptify.org` | `MX` | `mxb.mailgun.org` (priority 10) | Yes* | Receiving |
| `email.mg.chaptify.org` | `CNAME` | `mailgun.org` | Optional | Open/click tracking |

   \* The two MX records are part of Mailgun's standard verified set; they are only strictly needed if you also receive mail on the domain, but Mailgun lists them for full verification. The **tracking CNAME is optional** — add it only if you want open/click analytics.

   > The exact DKIM record **name and value are generated per domain** and shown in the Mailgun dashboard — copy them verbatim. This document cannot show your specific DKIM key.

3. Add these in **Cloudflare DNS**, all **DNS only (grey cloud)** — mail-authentication records must not be proxied ([Cloudflare proxy status](https://developers.cloudflare.com/dns/proxy-status/) recommends DNS-only for email records).
4. Back in Mailgun, click **Verify** (DNS propagation can take up to 24–48 h). A verified domain lifts the sandbox sending cap.
5. Set the matching values in `.env`: `NUXT_MAILGUN_DOMAIN=mg.chaptify.org`, `NUXT_MAILGUN_SENDER=Chaptify <noreply@mg.chaptify.org>`, `NUXT_MAILGUN_KEY=<sending key>`, then `docker compose up -d` to restart with the new config.

---

## Phase 7 — Backups

The **only state worth backing up is the SQLite database** at `/data/chaptify/database/chaptify.sqlite` — job files are ephemeral, but `upload_history` is permanent ([backend.md](backend.md)). SQLite runs in **WAL mode**, so a raw file copy can capture an inconsistent state; use SQLite's **online backup API** (`.backup`), which is safe under concurrent writers ([SQLite backup API](https://www.sqlite.org/backup.html), [SQLite WAL](https://www.sqlite.org/wal.html)).

The `node:22-alpine` image does not ship the `sqlite3` CLI, so run the backup from a throwaway Alpine container that mounts the same volume. Create `/opt/chaptify/backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
STAMP="$(date +%F-%H%M)"
mkdir -p /opt/chaptify/backups
docker run --rm \
    -v chaptify_chaptify-storage:/data \
    -v /opt/chaptify/backups:/backups \
    alpine:3.24 sh -c \
    "apk add --no-cache sqlite >/dev/null && \
     sqlite3 /data/database/chaptify.sqlite \".backup '/backups/chaptify-${STAMP}.sqlite'\""
# Ship off-box (choose a destination — see Open decisions), e.g.:
# rclone copy /opt/chaptify/backups/chaptify-${STAMP}.sqlite remote:chaptify-backups/
find /opt/chaptify/backups -name 'chaptify-*.sqlite' -mtime +14 -delete
```

> Confirm the Docker volume name first with `docker volume ls` — Compose prefixes it with the project directory (`chaptify_chaptify-storage` when the project dir is `chaptify`). Adjust the `-v` flag to match.

Make it executable and schedule a nightly cron for the `deploy` user:

```bash
chmod +x /opt/chaptify/backup.sh
crontab -e   # add:
# 15 3 * * *  /opt/chaptify/backup.sh >> /opt/chaptify/backups/backup.log 2>&1
```

**Ship the snapshot off the box** (object storage / another host) — a backup on the same VPS does not survive its loss. **Restore**: stop all services (`docker compose down`), copy a snapshot back to `database/chaptify.sqlite` in the volume, then `docker compose up -d`.

---

## Phase 8 — Go-live verification

1. **DNS / TLS**: `dig +short chaptify.org` returns the VPS IP; `curl -I https://chaptify.org` returns a valid cert and `200`. Optionally check the TLS grade at the [SSL Labs test](https://www.ssllabs.com/ssltest/).
2. **Health**: `curl -fsS https://chaptify.org/api/health` returns OK (verifies API runtime, SQLite access, writable storage).
3. **End-to-end**: from a browser, upload a real MP3/M4B with embedded chapters, submit an email, and confirm:
   - the job reaches `ready` (poll `GET /api/jobs/:jobId`);
   - the **worker** logs the FFmpeg run (`docker compose logs worker`);
   - the **completion email** arrives (check Mailgun logs if not) and its link points at `https://chaptify.org/...` (proves `NUXT_SITE_URL`);
   - the emailed download link streams the ZIP (split) / converted file (convert).
   - Test a **large upload near 1.6 GB** to confirm it is not rejected — proves the grey-cloud path bypasses Cloudflare's body limit.
4. **Client-IP correctness**: make a few requests and confirm the app's per-IP rate limiting keys on your real client IP, not the proxy. A quick check: from two different source IPs, verify the per-IP upload limit (`NUXT_PER_IP_UPLOAD_LIMIT=5`) is counted independently. If all clients share one counter, `NUXT_TRUST_PROXY` is wrong (see Phase 3.2).
5. **Port exposure**: from an external host, confirm `:3000` is closed (`nc -vz chaptify.org 3000` should fail) and only 22/80/443 are open.
6. **Cleanup/expiry**: confirm a ready job expires after `NUXT_JOB_RETENTION_HOURS` (default 12 h) and that `POST /api/jobs/:jobId/delete` purges on demand.

---

## Open decisions for the operator

- **Server size vs budget**: `CX33` (€8.49/mo, recommended) vs the cheaper `CX23` (€5.49/mo, 40 GB — requires lowering `NUXT_MAX_QUEUED_JOBS`) vs `CX43`/`CAX21` for more headroom. Confirm current prices and any IPv4 surcharge in the Hetzner Console.
- **Grey-cloud the app hostname**: strongly recommended (only way 1.6 GB uploads work on non-Enterprise Cloudflare). Decide whether to keep a *separate* orange-cloud marketing hostname for CDN/WAF on static pages.
- **Mailgun tracking CNAME**: optional open/click analytics — add `email.mg.chaptify.org → mailgun.org` only if you want it.
- **Backup destination**: choose an off-box target (S3/R2/Backblaze/another host) and wire it into `backup.sh`; decide the retention window (script defaults to 14 days locally).
- **`NUXT_CONTACT_RECIPIENT`**: set it to enable the contact form, or leave unset to disable `POST /api/contact`.
- **IPv6**: create the `AAAA` record only if you want the app reachable over IPv6.

---

## Sources

- Cloudflare upload/body-size limit per plan (413): https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-413/
- Cloudflare proxied vs DNS-only (orange/grey): https://developers.cloudflare.com/dns/proxy-status/
- Cloudflare full-setup / nameserver change: https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/
- Cloudflare SSL/TLS encryption modes: https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/
- Cloudflare Origin CA certificates: https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/
- Cloudflare HTTP headers (CF-Connecting-IP, X-Forwarded-For): https://developers.cloudflare.com/fundamentals/reference/http-headers/
- Cloudflare Always Use HTTPS: https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/
- Hetzner cost-optimized cloud servers (specs): https://www.hetzner.com/cloud/cost-optimized
- Hetzner regular-performance cloud servers (specs): https://www.hetzner.com/cloud/regular-performance
- Hetzner June 2026 price adjustment (current prices): https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- Hetzner new CX plans press release (specs, 20 TB traffic, 1 IPv4): https://www.hetzner.com/pressroom/new-cx-plans/
- Hetzner Cloud Firewall: https://docs.hetzner.com/cloud/firewalls/overview/
- Docker Engine install (Ubuntu): https://docs.docker.com/engine/install/ubuntu/
- Docker post-install (non-root): https://docs.docker.com/engine/install/linux-postinstall/
- Docker Compose ports reference: https://docs.docker.com/reference/compose-file/services/#ports
- Docker Hub node official image (multi-arch amd64/arm64): https://hub.docker.com/_/node
- Caddy automatic HTTPS: https://caddyserver.com/docs/automatic-https
- Caddy reverse_proxy directive: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- Caddy install: https://caddyserver.com/docs/install
- Let's Encrypt challenge types (HTTP-01 / DNS-01): https://letsencrypt.org/docs/challenge-types/
- Mailgun domain verification: https://documentation.mailgun.com/docs/mailgun/user-manual/domains/domains-verify
- Mailgun domain verification setup guide: https://help.mailgun.com/hc/en-us/articles/32884700912923-Domain-Verification-Setup-Guide
- Mailgun DNS FAQ (region vs DNS): https://help.mailgun.com/hc/en-us/articles/360011565514-DNS-frequently-asked-questions
- Ubuntu automatic security updates: https://documentation.ubuntu.com/server/how-to/software/automatic-updates/
- Ubuntu UFW guide: https://help.ubuntu.com/community/UFW
- OpenSSH sshd_config (Ubuntu 24.04 manpage): https://manpages.ubuntu.com/manpages/noble/en/man5/sshd_config.5.html
- SQLite online backup API: https://www.sqlite.org/backup.html
- SQLite write-ahead logging (WAL): https://www.sqlite.org/wal.html
</content>
</invoke>
