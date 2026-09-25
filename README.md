# qkenn-site

Source of [qkenn.cloud](https://qkenn.cloud), a bilingual (Vietnamese / English) personal site.

It is a fully static [Astro 7](https://astro.build) site. All content (posts, categories, the About page,
menu, footer, social links) comes from a headless [Payload CMS](https://payloadcms.com) **at build time**.
The output is plain HTML/CSS with no server runtime. The only client-side JavaScript is for the dark-mode toggle.

## Routes

Vietnamese is the default locale and has no prefix. English lives under `/en/`.

| Page | Vietnamese | English |
|---|---|---|
| Home | `/` | `/en/` |
| About | `/gioi-thieu` | `/en/about` |
| Blog (paginated) | `/blog`, `/blog/2`, … | `/en/blog`, `/en/blog/2`, … |
| Post | `/blog/<slug>` | `/en/blog/<slug>` |
| Category | `/blog/danh-muc/<slug>` | `/en/blog/category/<slug>` |
| RSS | `/rss.xml` | `/en/rss.xml` |

Plus `/sitemap-index.xml` (with hreflang alternates) and `/404.html`.

## Development

Requirements: Node >= 22.12 and pnpm 12 (enabled via `corepack`). If your host Node is older, run everything in
Docker instead:

```sh
docker run --rm -it --network host -v "$PWD":/app -w /app node:22-alpine \
  sh -c "corepack enable pnpm && pnpm i --frozen-lockfile && pnpm dev --host 127.0.0.1 --port 4321"
```

| Command | What it does |
|---|---|
| `pnpm i --frozen-lockfile` | Install dependencies (versions are pinned exactly) |
| `pnpm dev` | Dev server at http://localhost:4321 |
| `pnpm build` | Build the static site into `dist/` |
| `pnpm preview` | Serve `dist/` locally |
| `pnpm check` | Type-check (`astro check`) |
| `pnpm test` | Unit tests (Vitest, `tests/`) |
| `bash deploy/test-receive.sh` | End-to-end test of the deploy receiver on a temp directory (Linux; needs GNU tar, flock, python3, xz, bzip2) |

The CMS endpoint comes from `CMS_URL` (see `.env.example`, default `https://cms.qkenn.cloud`). The CMS must be
reachable for `dev` and `build`. If it is down or returns bad data, **the build fails** on purpose, so an empty
site is never deployed.

## Project layout

```text
src/lib/cms.ts        data contract with the CMS (the only place that fetches content)
src/pages/            routes (vi at the root, en under en/), RSS, sitemap
src/layouts/          base layout (SEO head, hreflang, theme)
src/components/       UI components
src/i18n/             UI strings and vi <-> en route mapping
src/styles/           Tailwind 4 (CSS-first) + typography for CMS rich text
tests/                Vitest tests and CMS fixtures
deploy/               server-side receiver, its test, suggested nginx vhost, deploy guide
.github/workflows/    build + deploy pipeline
```

## Build and deploy

`.github/workflows/deploy.yml` runs on a push to `main`, when the CMS publishes or unpublishes content
(`workflow_dispatch` with `reason`/`slug` inputs), or manually. Other branches only build.

1. **Build job**: unit tests, receiver test, `pnpm build` against the live CMS, a sanity check of `dist/`,
   then pack `dist/` into `site.tar.gz`. A failure here never touches the server.
2. **Deploy job**: streams the tarball over SSH to the server. The deploy key is restricted to a
   **forced command** (`deploy/receive.sh`, installed as a root-owned copy), so it can only run
   `deploy <sha>`, `rollback …` or `list`. The server's host key is always verified against the
   `SSH_KNOWN_HOSTS` secret.
3. **Receiver**: validates the archive (size and entry limits, no links or special files, no path traversal,
   must contain `index.html`), extracts it into `releases/<UTC timestamp>-<sha>/`, then switches the
   `current` symlink with an atomic rename. nginx serves `current` and needs no reload. Visitors always
   see either the complete old version or the complete new one.
4. An optional Discord notification reports the result.

The five newest releases are kept, plus `current` and `previous`. Rolling back is instant and atomic:

```sh
ssh root@<vps-host> /usr/local/bin/qkenn-site-receive list
ssh root@<vps-host> /usr/local/bin/qkenn-site-receive rollback previous   # or a release id / commit sha
```

A rollback only lasts until the next deploy from `main`.

Server setup, GitHub secrets, CMS trigger and troubleshooting: see [deploy/README.md](deploy/README.md)
(in Vietnamese).
