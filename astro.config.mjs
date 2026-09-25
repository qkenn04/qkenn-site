// @ts-check
import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'

// Site tĩnh: mọi dữ liệu lấy từ Payload CMS lúc build (xem src/lib/cms.ts)
export default defineConfig({
  site: 'https://qkenn.cloud',
  output: 'static',
  trailingSlash: 'ignore',
  i18n: {
    locales: ['vi', 'en'],
    defaultLocale: 'vi',
    routing: { prefixDefaultLocale: false }, // vi ở /, en ở /en/
  },
  image: {
    // Ảnh bài viết nằm trên CMS (R2 phía sau)
    remotePatterns: [{ protocol: 'https', hostname: 'cms.qkenn.cloud' }],
  },
  integrations: [
    sitemap({
      i18n: { defaultLocale: 'vi', locales: { vi: 'vi-VN', en: 'en-US' } },
    }),
  ],
  vite: { plugins: [tailwindcss()] },
})
