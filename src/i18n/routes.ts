// Bản đồ URL song ngữ. Mọi link nội bộ đi qua đây để vi/en luôn khớp nhau:
//   vi: /  /gioi-thieu/  /blog/  /blog/2/  /blog/<slug>/  /blog/danh-muc/<slug>/
//   en: /en/  /en/about/  /en/blog/  /en/blog/2/  /en/blog/<slug>/  /en/blog/category/<slug>/
// getRelativeLocaleUrl lo phần tiền tố locale + dấu "/" cuối theo astro.config (trailingSlash, build.format),
// nên link nội bộ, canonical, hreflang và sitemap dùng cùng một dạng URL.
import { getRelativeLocaleUrl } from 'astro:i18n'
import type { Locale } from '../lib/cms'

const segments = {
  about: { vi: 'gioi-thieu', en: 'about' },
  category: { vi: 'blog/danh-muc', en: 'blog/category' },
} as const satisfies Record<string, Record<Locale, string>>

const localize = (locale: Locale, path: string) => getRelativeLocaleUrl(locale, path)
const seg = (value: string) => encodeURIComponent(value)

export const routes = {
  home: (locale: Locale) => localize(locale, ''),
  about: (locale: Locale) => localize(locale, segments.about[locale]),
  blog: (locale: Locale, page = 1) => localize(locale, page > 1 ? `blog/${page}` : 'blog'),
  post: (locale: Locale, slug: string) => localize(locale, `blog/${seg(slug)}`),
  category: (locale: Locale, slug: string) => localize(locale, `${segments.category[locale]}/${seg(slug)}`),
  rss: (locale: Locale) => (locale === 'vi' ? '/rss.xml' : '/en/rss.xml'),
}

/** Đường dẫn tương đương của cùng một trang ở từng ngôn ngữ (undefined = không có bản tương đương) */
export type Alternates = Partial<Record<Locale, string>>

/** Chuẩn hoá path để so sánh (bỏ query/hash, luôn có "/" cuối) */
export function normalizePath(path: string): string {
  const clean = path.split(/[?#]/)[0] || '/'
  return clean.endsWith('/') ? clean : `${clean}/`
}

/**
 * Link trong menu lấy từ CMS: link nội bộ kiểu "/blog" được thêm "/" cuối cho khớp dạng URL của site
 * (tránh redirect); link ngoài, mailto:, file (có phần mở rộng), query/hash giữ nguyên.
 */
export function normalizeNavHref(href: string): string {
  const value = href.trim()
  if (!value.startsWith('/') || value.startsWith('//')) return value
  if (/[?#]/.test(value)) return value
  const last = value.split('/').pop() ?? ''
  if (last.includes('.')) return value
  return normalizePath(value)
}

/**
 * Link nội bộ dạng path tiếng Việt (menu CMS thường chỉ nhập /blog, /gioi-thieu…) → trang tương đương
 * ở `locale`, vd en: /gioi-thieu → /en/about/, /blog/danh-muc/x → /en/blog/category/x/.
 * Giữ nguyên (chỉ chuẩn hoá như normalizeNavHref): link ngoài, mailto:, #…, file (có phần mở rộng),
 * link đã có /en/, path lạ ngoài bản đồ URL ở trên. Query/hash được giữ lại sau path đã đổi.
 */
export function localizeHref(href: string, locale: Locale): string {
  const value = normalizeNavHref(href)
  if (locale === 'vi' || !value.startsWith('/') || value.startsWith('//')) return value

  const cut = value.search(/[?#]/)
  const path = cut < 0 ? value : value.slice(0, cut)
  const suffix = cut < 0 ? '' : value.slice(cut)
  const parts = path.split('/').filter(Boolean)
  if (parts[0] === 'en' || parts.at(-1)?.includes('.')) return value

  let decoded: string[]
  try {
    // routes.* tự encode slug → giải mã trước để không bị encode 2 lần
    decoded = parts.map((part) => decodeURIComponent(part))
  } catch {
    return value
  }
  const target = localizeViPath(decoded, locale)
  return target ? `${target}${suffix}` : value
}

/** Các segment của một path vi → route tương ứng ở `locale`; không nhận ra → null */
function localizeViPath(parts: string[], locale: Locale): string | null {
  const [first, second, third, ...rest] = parts
  if (rest.length > 0) return null
  if (first === undefined) return routes.home(locale)
  if (first === segments.about.vi) return second === undefined ? routes.about(locale) : null
  if (first !== 'blog') return null
  if (second === undefined) return routes.blog(locale)
  if (third !== undefined) return `blog/${second}` === segments.category.vi ? routes.category(locale, third) : null
  // /blog/2 là trang phân trang (bài có slug toàn số bị bỏ khi build, xem static-paths.ts)
  if (/^\d+$/.test(second)) return routes.blog(locale, Number(second))
  return routes.post(locale, second)
}

export function isExternal(href: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(href)
}
