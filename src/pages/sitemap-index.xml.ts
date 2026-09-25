// Sitemap tự sinh (thay @astrojs/sitemap) → /sitemap-index.xml (tên được khai báo trong public/robots.txt).
// Danh sách URL + hreflang theo ĐÚNG quy tắc canonical/hreflang mà các view in trong <head>:
//  - URL en có nội dung dự phòng tiếng Việt (isFallback) có canonical về bản vi → không đưa vào sitemap
//  - hreflang vi/en/x-default(→vi) chỉ in cho cặp mà CẢ HAI bản đều là nội dung thật
//  - Trang chủ, /gioi-thieu/ ↔ /en/about/, /blog/ + /blog/N/, bài viết, danh-muc ↔ category; không có 404
// Đổi quy tắc hreflang/canonical ở HomeView, AboutView, BlogListView, PostView, CategoryView → sửa cả ở đây.
import type { APIRoute } from 'astro'
import { defaultLocale, getPage, getPosts, locales, type Locale } from '../lib/cms'
import { categoryPaths, lastPageOf, postPaths } from '../components/views/static-paths'
import { routes } from '../i18n/routes'
import { localeMeta, otherLocale } from '../i18n/ui'

interface SitemapUrl {
  path: string
  /** Cặp trang tương đương vi ↔ en (chỉ khi cả hai bản đều là nội dung thật) → hreflang */
  pair?: Record<Locale, string>
  lastmod?: string
}

const pairOf = (route: (locale: Locale) => string): Record<Locale, string> => ({ vi: route('vi'), en: route('en') })

async function collectUrls(): Promise<SitemapUrl[]> {
  const [postsVi, postsEn, aboutEn] = await Promise.all([getPosts('vi'), getPosts('en'), getPage('about', 'en')])
  const urls: SitemapUrl[] = []

  // HomeView: vi ↔ en luôn là một cặp
  const home = pairOf(routes.home)
  urls.push({ path: home.vi, pair: home }, { path: home.en, pair: home })

  // AboutView: bản en dự phòng → canonical về /gioi-thieu/, trang vi không khai báo hreflang en
  const about = pairOf(routes.about)
  if (aboutEn?.isFallback) urls.push({ path: about.vi })
  else urls.push({ path: about.vi, pair: about }, { path: about.en, pair: about })

  // BlogListView: trang N có cặp khi ngôn ngữ còn lại cũng có trang N
  const lastPage: Record<Locale, number> = { vi: lastPageOf(postsVi.length), en: lastPageOf(postsEn.length) }
  for (const locale of locales) {
    for (let n = 1; n <= lastPage[locale]; n++) {
      const paired = n <= lastPage[otherLocale(locale)]
      urls.push({ path: routes.blog(locale, n), pair: paired ? pairOf((l) => routes.blog(l, n)) : undefined })
    }
  }

  // PostView (cùng getStaticPaths với trang bài): bài en chưa dịch → bỏ; có cặp khi bản kia là bản dịch thật
  for (const locale of locales) {
    for (const { props } of await postPaths(locale)) {
      const { post, alternate } = props
      if (post.isFallback && locale !== defaultLocale) continue
      const paired = !!alternate && !alternate.isFallback
      urls.push({
        path: routes.post(locale, post.slug),
        pair: paired ? pairOf((l) => routes.post(l, post.slug)) : undefined,
        lastmod: Date.parse(post.updatedAt) > 0 ? post.updatedAt : undefined,
      })
    }
  }

  // CategoryView: chỉ danh mục có bài (trang rỗng là noindex); có cặp khi danh mục có bài ở cả hai ngôn ngữ
  for (const locale of locales) {
    for (const { props } of await categoryPaths(locale)) {
      const { category, posts, hasAlternate } = props
      if (posts.length === 0) continue
      urls.push({
        path: routes.category(locale, category.slug),
        pair: hasAlternate ? pairOf((l) => routes.category(l, category.slug)) : undefined,
      })
    }
  }

  return urls
}

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
const xml = (value: string) => value.replace(/[&<>"']/g, (c) => XML_ESCAPES[c])

export const GET: APIRoute = async ({ site }) => {
  const base = site ?? new URL('https://qkenn.cloud')
  const absolute = (path: string) => xml(new URL(path, base).href)
  const link = (lang: string, path: string) =>
    `    <xhtml:link rel="alternate" hreflang="${lang}" href="${absolute(path)}"/>`

  const body = (await collectUrls()).map((u) => {
    const lines = ['  <url>', `    <loc>${absolute(u.path)}</loc>`]
    if (u.lastmod) lines.push(`    <lastmod>${xml(u.lastmod)}</lastmod>`)
    if (u.pair) {
      const pair = u.pair
      lines.push(...locales.map((l) => link(localeMeta[l].htmlLang, pair[l])), link('x-default', pair[defaultLocale]))
    }
    lines.push('  </url>')
    return lines.join('\n')
  })

  const doc = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...body,
    '</urlset>',
    '',
  ].join('\n')
  return new Response(doc, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } })
}
