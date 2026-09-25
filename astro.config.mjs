// @ts-check
import { defineConfig } from 'astro/config'
import tailwindcss from '@tailwindcss/vite'

// Site tĩnh: mọi dữ liệu lấy từ Payload CMS lúc build (xem src/lib/cms.ts).
// Sitemap do src/pages/sitemap-index.xml.ts sinh (không dùng @astrojs/sitemap: nó không biết trang en
// nào là bản dự phòng chưa dịch, cũng không ghép được /gioi-thieu/ ↔ /en/about/, danh-muc ↔ category).
export default defineConfig({
  site: 'https://qkenn.cloud',
  output: 'static',
  trailingSlash: 'ignore',
  i18n: {
    locales: ['vi', 'en'],
    defaultLocale: 'vi',
    routing: { prefixDefaultLocale: false }, // vi ở /, en ở /en/
  },
  vite: { plugins: [tailwindcss()] },
})
