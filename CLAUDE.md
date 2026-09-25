# qkenn-site — site cá nhân song ngữ (Astro 7, static) cho https://qkenn.cloud

Nội dung (bài viết, trang About, menu, footer) lấy từ Payload CMS https://cms.qkenn.cloud **lúc build**.
CMS publish → GitHub `repository_dispatch` (event `cms-publish`) → workflow build lại site → rsync lên VPS.

## Commands
Chạy trong Docker `node:22-alpine` (Node host là 18):
`docker run --rm --network host -v "$PWD":/app -w /app node:22-alpine sh -c "corepack enable pnpm && <lệnh>"`
- Dev: `pnpm dev --host 127.0.0.1 --port 4321`
- Build: `pnpm build` (ra `dist/`)
- Type check: `pnpm check`
- Test: `pnpm test`

## Conventions
- vi là mặc định ở `/`, en ở `/en/` (Astro i18n, prefixDefaultLocale: false)
- URL: `/`, `/gioi-thieu`, `/blog`, `/blog/<slug>`, `/blog/danh-muc/<slug>` · en: `/en/`, `/en/about`, `/en/blog`, `/en/blog/<slug>`, `/en/blog/category/<slug>`
- Giao diện CHỈ lấy dữ liệu qua `src/lib/cms.ts` (hợp đồng dữ liệu, không đổi tên hàm/kiểu)
- Nội dung bài là `contentHtml` (HTML từ CMS, class `payload-richtext`) → `set:html`, style bằng Tailwind typography (`prose`)
- CMS không phản hồi → build FAIL (không deploy site rỗng)
- Tailwind 4 (CSS-first, `src/styles/global.css`), không thêm framework JS; chỉ dùng JS phía client khi thật cần (toggle dark mode)
- Version pin chính xác; pnpm 12 chặn package phát hành < 1 ngày (minimumReleaseAge) — không tắt chính sách này

## Architecture
- `src/lib/` dữ liệu CMS · `src/layouts/` layout · `src/components/` UI · `src/pages/` route · `src/styles/`
- `tests/` vitest · `deploy/` script phía VPS · `.github/workflows/` CI build + deploy
