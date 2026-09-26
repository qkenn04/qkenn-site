// Dữ liệu có cấu trúc (JSON-LD, schema.org) cho Google: site/thương hiệu/tác giả là "qkenn".
// Hàm thuần (không phụ thuộc Astro) — nhận URL tuyệt đối đã tính sẵn ở layout/view, trả object để
// gộp vào 1 "@graph" mỗi trang. Các node tham chiếu nhau qua "@id" cố định:
//   <site>/#website (WebSite), <site>/#person (Person), <canonical>#article, <canonical>#breadcrumb.
import type { SiteSettings } from './cms'

export type JsonLdNode = Record<string, unknown>

/** Google cắt headline dài; schema.org khuyên ≤ 110 ký tự */
export const HEADLINE_MAX = 110

export const websiteId = (siteUrl: string) => `${siteUrl}#website`
export const personId = (siteUrl: string) => `${siteUrl}#person`

/** Bỏ khoá undefined/null, chuỗi rỗng và mảng rỗng → JSON gọn, không có giá trị vô nghĩa */
function compact<T extends JsonLdNode>(node: T): T {
  const out: JsonLdNode = {}
  for (const [key, value] of Object.entries(node)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim() === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    out[key] = value
  }
  return out as T
}

const clean = (value: string | null | undefined): string | undefined => {
  const v = value?.replace(/\s+/g, ' ').trim()
  return v ? v : undefined
}

/** Cắt theo code point (không tách đôi emoji/surrogate), thêm "…" khi vượt `max` */
export function truncateHeadline(text: string, max = HEADLINE_MAX): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim())
  if (chars.length <= max) return chars.join('')
  return `${chars.slice(0, max - 1).join('').trimEnd()}…`
}

/** URL hồ sơ mạng xã hội cho `sameAs`: chỉ http(s) (bỏ mailto:, link nội bộ), không trùng */
export function profileUrls(socials: SiteSettings['socials'] | null | undefined): string[] {
  const urls: string[] = []
  for (const item of socials ?? []) {
    const url = item?.url?.trim()
    if (!url || !/^https?:\/\//i.test(url)) continue
    try {
      const href = new URL(url).href
      if (!urls.includes(href)) urls.push(href)
    } catch {
      // URL hỏng: bỏ qua
    }
  }
  return urls
}

export interface SiteIdentity {
  /** URL gốc tuyệt đối, có "/" cuối, vd https://qkenn.cloud/ */
  siteUrl: string
  /** Tên site = bút danh chủ blog, vd "qkenn" */
  name: string
  alternateNames?: string[]
  /** Mô tả site (site settings) */
  description?: string | null
  /** Mô tả người (trang Giới thiệu) */
  personDescription?: string | null
  sameAs?: string[]
  inLanguage?: string[]
}

export function buildWebSite(site: SiteIdentity): JsonLdNode {
  return compact({
    '@type': 'WebSite',
    '@id': websiteId(site.siteUrl),
    url: site.siteUrl,
    name: site.name,
    alternateName: site.alternateNames,
    description: clean(site.description),
    inLanguage: site.inLanguage,
    publisher: { '@id': personId(site.siteUrl) },
  })
}

export function buildPerson(site: SiteIdentity): JsonLdNode {
  return compact({
    '@type': 'Person',
    '@id': personId(site.siteUrl),
    name: site.name,
    url: site.siteUrl,
    description: clean(site.personDescription),
    sameAs: site.sameAs,
  })
}

export interface BlogPostingInput {
  /** URL canonical tuyệt đối của bài */
  url: string
  title: string
  description?: string | null
  datePublished: string
  dateModified?: string | null
  /** 'vi' | 'en' — bài chưa dịch (isFallback) phải truyền 'vi' */
  inLanguage: string
  /** URL ảnh tuyệt đối (og → hero); không có → bỏ trường image */
  image?: string | null
  sections?: string[]
  keywords?: string[]
}

export function buildBlogPosting(siteUrl: string, post: BlogPostingInput): JsonLdNode {
  const person = { '@id': personId(siteUrl) }
  const sections = (post.sections ?? []).map((s) => clean(s)).filter((s): s is string => !!s)
  const keywords = (post.keywords ?? []).map((s) => clean(s)).filter((s): s is string => !!s)
  return compact({
    '@type': 'BlogPosting',
    '@id': `${post.url}#article`,
    headline: truncateHeadline(post.title),
    description: clean(post.description),
    datePublished: post.datePublished,
    dateModified: post.dateModified || post.datePublished,
    inLanguage: post.inLanguage,
    mainEntityOfPage: post.url,
    url: post.url,
    image: post.image || undefined,
    author: person,
    publisher: person,
    isPartOf: { '@id': websiteId(siteUrl) },
    articleSection: sections.length > 1 ? sections : sections[0],
    keywords: keywords.length ? keywords.join(', ') : undefined,
  })
}

export interface Crumb {
  name: string
  /** URL tuyệt đối */
  url: string
}

/** BreadcrumbList; `id` thường là `<canonical>#breadcrumb` */
export function buildBreadcrumbList(id: string, crumbs: Crumb[]): JsonLdNode {
  return {
    '@type': 'BreadcrumbList',
    '@id': id,
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: clean(c.name) ?? c.url,
      item: c.url,
    })),
  }
}

/** Danh sách bài (dạng "summary page" của Google: ListItem chỉ có position + url, kèm name) */
export function buildItemList(id: string, items: Crumb[]): JsonLdNode {
  return {
    '@type': 'ItemList',
    '@id': id,
    itemListElement: items.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: c.url,
      name: clean(c.name),
    })),
  }
}

export function buildGraph(nodes: JsonLdNode[]): JsonLdNode {
  return { '@context': 'https://schema.org', '@graph': nodes }
}

/**
 * JSON an toàn để nhét vào <script type="application/ld+json">: chuỗi từ CMS không thể đóng thẻ
 * (`</script>`), mở comment (`<!--`) hay xuống dòng kiểu JS (U+2028/2029). JSON.parse cho ra đúng giá trị gốc.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
