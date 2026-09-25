// HỢP ĐỒNG DỮ LIỆU giữa site và Payload CMS.
// Giao diện (src/pages, src/components) CHỈ import từ file này — không gọi fetch CMS ở chỗ khác.
// Tên hàm + kiểu dữ liệu export bên dưới là cố định (UI dựa vào đó).
//
// Nguyên tắc:
// - CMS lỗi / không phản hồi → throw (build FAIL, không deploy site rỗng). Chỉ getPage trả null khi
//   collection/trang chưa có (404/403/400).
// - Mọi GET giống nhau trong 1 lần build được gộp (memo theo URL) → nhiều trang gọi getPosts('vi')
//   chỉ tốn 1 lượt request.
// - isFallback: Payload bật fallback vi cho en. Muốn biết bài đã dịch chưa thì hỏi thêm 1 request
//   với `fallback-locale=none` (chỉ lấy title): bài chưa dịch sẽ không có title ở locale đó.

export type Locale = 'vi' | 'en'
export const locales: Locale[] = ['vi', 'en']
export const defaultLocale: Locale = 'vi'

export interface ImageSize {
  url: string
  width: number
  height: number
}

export interface Media {
  url: string
  alt: string
  width: number
  height: number
  sizes: {
    thumbnail: ImageSize | null
    card: ImageSize | null
    hero: ImageSize | null
    og: ImageSize | null
  }
}

export interface Category {
  id: number
  slug: string
  title: string
}

export interface Seo {
  title: string | null
  description: string | null
  image: Media | null
}

export interface Post {
  id: number
  slug: string
  title: string
  excerpt: string | null
  /** HTML đã render sẵn từ CMS, bọc trong <div class="payload-richtext"> */
  contentHtml: string
  coverImage: Media | null
  categories: Category[]
  publishedAt: string // ISO
  updatedAt: string // ISO
  meta: Seo
  /** true khi bài CHƯA dịch sang locale được yêu cầu (nội dung đang là bản vi) */
  isFallback: boolean
}

export interface Page {
  id: number
  /** slug cố định, không đổi theo ngôn ngữ, vd 'about' */
  slug: string
  title: string
  contentHtml: string
  meta: Seo
  isFallback: boolean
}

export interface SiteSettings {
  siteName: string
  tagline: string | null
  description: string | null
  nav: { label: string; href: string }[]
  socials: { platform: 'github' | 'linkedin' | 'facebook' | 'x' | 'email'; url: string }[]
  footerText: string | null
}

export const CMS_URL = (import.meta.env.CMS_URL ?? 'https://cms.qkenn.cloud').replace(/\/$/, '')

// ---------------------------------------------------------------------------------------------
// Cấu hình
// ---------------------------------------------------------------------------------------------

const SITE = 'qkenn'
const PAGE_SIZE = 100
/** Chặn vòng lặp vô hạn nếu API trả hasNextPage sai */
const MAX_PAGES = 1000
const TIMEOUT_MS = 15_000
/** 2 lần thử lại (tổng 3 lần) khi lỗi mạng / 5xx */
const RETRY_DELAYS_MS = [500, 1500]
const RETRYABLE_STATUS = new Set([408, 429])
/** Payload đọc `fallback-locale` từ query; 'none' | 'false' | 'null' đều tắt fallback */
const NO_FALLBACK = 'none'
/** Build: nhớ suốt tiến trình. `astro dev`: chỉ gộp request trong vài giây để còn thấy bài mới */
const CACHE_TTL_MS = import.meta.env.DEV ? 5_000 : Number.POSITIVE_INFINITY
const EPOCH_ISO = new Date(0).toISOString()
const SOCIAL_PLATFORMS = ['github', 'linkedin', 'facebook', 'x', 'email'] as const
/** Scheme được phép cho link nav/socials lấy từ CMS (chặn javascript:, data:, vbscript:, ...) */
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
/** Base để parse link tương đối — chỉ dùng xác định scheme, không đổi giá trị link */
const LINK_BASE = 'https://qkenn.cloud'

// ---------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------

/** Lỗi khi gọi CMS. `status` = null khi lỗi mạng / timeout / body hỏng */
export class CmsError extends Error {
  readonly status: number | null
  readonly path: string

  constructor(message: string, opts: { path: string; status?: number | null; cause?: unknown }) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause })
    this.name = 'CmsError'
    this.status = opts.status ?? null
    this.path = opts.path
  }
}

interface CacheEntry {
  promise: Promise<unknown>
  expires: number
}

const cache = new Map<string, CacheEntry>()

/** Xoá bộ nhớ đệm request (dùng trong test, hoặc khi cần đọc lại CMS trong cùng tiến trình) */
export function clearCmsCache(): void {
  cache.clear()
}

/** GET `${CMS_URL}/api${path}` → JSON. Gộp request trùng, timeout, retry; lỗi → CmsError */
function api<T>(path: string): Promise<T> {
  const url = `${CMS_URL}/api${path}`
  const now = Date.now()
  const hit = cache.get(url)
  if (hit && hit.expires > now) return hit.promise as Promise<T>

  const promise = requestJson<T>(url, path)
  cache.set(url, { promise, expires: now + CACHE_TTL_MS })
  // Không nhớ request lỗi: lần gọi sau được thử lại
  promise.catch(() => {
    if (cache.get(url)?.promise === promise) cache.delete(url)
  })
  return promise
}

async function requestJson<T>(url: string, path: string): Promise<T> {
  const attempts = RETRY_DELAYS_MS.length + 1
  let lastError: CmsError | undefined

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await sleep(RETRY_DELAYS_MS[attempt - 2])

    let res: Response
    try {
      res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      lastError = new CmsError(`CMS network error on GET ${path}: ${describeError(err)}`, {
        path,
        cause: err,
      })
      continue
    }

    if (!res.ok) {
      const statusText = res.statusText ? ` ${res.statusText}` : ''
      const error = new CmsError(`CMS responded ${res.status}${statusText} on GET ${path}${await errorDetail(res)}`, {
        path,
        status: res.status,
      })
      if (res.status >= 500 || RETRYABLE_STATUS.has(res.status)) {
        lastError = error
        continue
      }
      throw error // 4xx: thử lại cũng vô ích
    }

    try {
      return (await res.json()) as T
    } catch (err) {
      // Body đứt giữa chừng / proxy trả HTML: coi như lỗi tạm thời
      lastError = new CmsError(`CMS returned an unreadable body on GET ${path}: ${describeError(err)}`, {
        path,
        status: res.status,
        cause: err,
      })
    }
  }

  const reason = lastError?.message ?? `CMS request failed on GET ${path}`
  throw new CmsError(`${reason} (gave up after ${attempts} attempts)`, {
    path,
    status: lastError?.status ?? null,
    cause: lastError,
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const cause = err.cause as { code?: unknown; message?: unknown } | undefined
  const causeText = cause && (cause.code ?? cause.message)
  return `${err.name}: ${err.message}${causeText ? ` (${String(causeText)})` : ''}`
}

/** Payload trả lỗi dạng {"errors":[{"message"}]} hoặc {"message"} — đưa vào message cho dễ debug */
async function errorDetail(res: Response): Promise<string> {
  try {
    const text = (await res.text()).trim()
    if (!text) return ''
    let message = text
    try {
      const body = JSON.parse(text) as { message?: unknown; errors?: { message?: unknown }[] }
      const fromBody = body.errors?.[0]?.message ?? body.message
      if (typeof fromBody === 'string') message = fromBody
    } catch {
      // không phải JSON: dùng text thô
    }
    return ` — ${message.replace(/\s+/g, ' ').slice(0, 200)}`
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------------------------
// Query string + phân trang
// ---------------------------------------------------------------------------------------------

type QueryParams = Record<string, string | number | undefined>

/** Giữ nguyên [ ] trong key (qs của Payload đọc được, log dễ đọc), encode phần còn lại */
function buildQuery(params: QueryParams): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    const k = encodeURIComponent(key).replace(/%5B/gi, '[').replace(/%5D/gi, ']')
    parts.push(`${k}=${encodeURIComponent(String(value))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

interface ListResponse {
  docs: unknown[]
  hasNextPage?: boolean
  nextPage?: number | null
}

async function fetchList(collection: string, params: QueryParams): Promise<ListResponse> {
  const path = `/${collection}${buildQuery(params)}`
  const data = await api<unknown>(path)
  if (!isObject(data) || !Array.isArray(data.docs)) {
    throw new CmsError(`CMS returned an unexpected list response on GET ${path} (no "docs" array)`, { path })
  }
  return { docs: data.docs, hasNextPage: data.hasNextPage === true, nextPage: num(data.nextPage) }
}

/** Đi hết các trang (hasNextPage/nextPage), mỗi trang PAGE_SIZE doc */
async function fetchAllDocs(collection: string, params: QueryParams): Promise<unknown[]> {
  const docs: unknown[] = []
  let page = 1
  for (let i = 0; i < MAX_PAGES; i++) {
    const res = await fetchList(collection, { ...params, limit: PAGE_SIZE, page })
    docs.push(...res.docs)
    if (!res.hasNextPage) return docs
    const next = res.nextPage ?? page + 1
    if (next <= page) {
      throw new CmsError(`CMS pagination did not advance on /${collection} (page ${page} → ${next})`, {
        path: `/${collection}`,
      })
    }
    page = next
  }
  throw new CmsError(`CMS pagination exceeded ${MAX_PAGES} pages on /${collection}`, { path: `/${collection}` })
}

/** Bộ lọc chung cho posts/pages của site này (public read vốn chỉ trả bài published — lọc thêm cho chắc) */
function publishedFilters(extra: QueryParams = {}): QueryParams {
  return {
    ...extra,
    'where[_status][equals]': 'published',
    'where[site][equals]': SITE,
  }
}

/**
 * id các doc CHƯA có bản dịch riêng ở `locale` (title rỗng khi tắt fallback).
 * Locale mặc định (vi) không bao giờ là fallback → không tốn request.
 */
async function findUntranslatedIds(
  collection: 'posts' | 'pages',
  locale: Locale,
  filters: QueryParams,
  opts: { all: boolean },
): Promise<Set<number>> {
  if (locale === defaultLocale) return new Set()
  const params: QueryParams = {
    locale,
    'fallback-locale': NO_FALLBACK,
    depth: 0,
    'select[title]': 'true',
    ...filters,
  }
  const docs = opts.all
    ? await fetchAllDocs(collection, params)
    : (await fetchList(collection, { ...params, limit: 1 })).docs
  const ids = new Set<number>()
  for (const doc of docs) {
    if (!isObject(doc)) continue
    const id = toId(doc.id)
    if (id !== null && str(doc.title) === null) ids.add(id)
  }
  return ids
}

function assertLocale(locale: string): asserts locale is Locale {
  if (!(locales as string[]).includes(locale)) {
    throw new Error(`Unsupported locale "${locale}" (expected one of: ${locales.join(', ')})`)
  }
}

// ---------------------------------------------------------------------------------------------
// Normalizer (thuần, export để test): chịu được null / thiếu field / relation chưa populate
// ---------------------------------------------------------------------------------------------

type Raw = Record<string, unknown>

function isObject(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Chuỗi khác rỗng (đã trim) hoặc null */
function str(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function num(value: unknown): number | null {
  const n =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  return Number.isFinite(n) ? n : null
}

function toId(value: unknown): number | null {
  const n = num(value)
  return n !== null && Number.isInteger(n) ? n : null
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

/** URL ảnh luôn tuyệt đối (production đã tuyệt đối; phòng khi CMS trả đường dẫn /api/media/...) */
function absoluteUrl(value: unknown): string | null {
  const url = str(value)
  if (!url) return null
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('//')) return `https:${url}`
  return `${CMS_URL}${url.startsWith('/') ? '' : '/'}${url}`
}

function normalizeImageSize(raw: unknown): ImageSize | null {
  if (!isObject(raw)) return null
  const url = absoluteUrl(raw.url)
  const width = num(raw.width)
  const height = num(raw.height)
  // Payload để url/width/height = null cho size không sinh được (vd og khi ảnh gốc < 1200px)
  if (!url || width === null || height === null || width <= 0 || height <= 0) return null
  return { url, width, height }
}

/** Media đã populate → Media; id (chưa populate), null, thiếu url → null */
export function normalizeMedia(raw: unknown): Media | null {
  if (!isObject(raw)) return null
  const url = absoluteUrl(raw.url)
  if (!url) return null
  const sizes = isObject(raw.sizes) ? raw.sizes : {}
  return {
    url,
    alt: str(raw.alt) ?? '',
    width: num(raw.width) ?? 0,
    height: num(raw.height) ?? 0,
    sizes: {
      thumbnail: normalizeImageSize(sizes.thumbnail),
      card: normalizeImageSize(sizes.card),
      hero: normalizeImageSize(sizes.hero),
      og: normalizeImageSize(sizes.og),
    },
  }
}

/** Category đã populate → Category; id trần (chưa populate) / thiếu slug → null */
export function normalizeCategory(raw: unknown): Category | null {
  if (!isObject(raw)) return null
  const id = toId(raw.id)
  const slug = str(raw.slug)
  if (id === null || !slug) return null
  return { id, slug, title: str(raw.title) ?? slug }
}

/** SEO (plugin-seo `meta`) → luôn đủ 3 khoá, mặc định null */
export function normalizeSeo(raw: unknown): Seo {
  if (!isObject(raw)) return { title: null, description: null, image: null }
  return {
    title: str(raw.title),
    description: str(raw.description),
    image: normalizeMedia(raw.image),
  }
}

/** Bỏ ký tự điều khiển ASCII (trình duyệt tự bỏ tab/xuống dòng trong URL: `java\tscript:` vẫn chạy) + trim */
function cleanLink(value: unknown): string | null {
  return typeof value === 'string' ? str(value.replace(/[\u0000-\u001F\u007F]/g, '')) : null
}

/**
 * Link từ CMS render thẳng vào href → chỉ nhận path nội bộ (`/...`, `#...`, `?...`) hoặc
 * http/https/mailto. Bỏ `//host`, `/\host` (protocol-relative). Parse bằng URL (WHATWG, cùng thuật toán
 * với trình duyệt) trên CHÍNH chuỗi trả về → trình duyệt hiểu scheme y như lúc kiểm tra. Không đạt → null.
 */
function safeLink(href: string | null): string | null {
  if (!href || /^[\\/]{2}/.test(href)) return null
  if (/^[/#?]/.test(href)) return href
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(href, LINK_BASE).protocol) ? href : null
  } catch {
    return null
  }
}

// contentHtml: sửa nhẹ markup ảnh (phòng hờ — sửa gốc nằm ở converter Lexical → HTML phía CMS).
// Payload escape mọi giá trị attribute (escape-html) → thẻ không chứa "<" ">" bên trong; `[^<>]*` giữ
// regex không bao giờ nuốt sang thẻ/nội dung khác.
const SOURCE_TAG = /(<source(?=[\s/>])[^<>]*>)(?:\s*<\/source\s*>)?/gi
const IMG_TAG = /<img(?=[\s/>])[^<>]*>/gi
const HTML_ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
/** Bản CROP của Media: thumbnail 400x300 (4:3) và og 1200x630 — không dành cho ảnh trong bài */
const CROPPED_SIZE_FILE = /-(?:400x300|1200x630)\.[a-z0-9]+(?![a-z0-9])/i

/** Attribute của 1 thẻ mở (tên viết thường → giá trị thô), đọc đúng giá trị trong ngoặc kép */
function tagAttributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>()
  const body = tag.replace(/^<[a-z0-9]+/i, '').replace(/\/?>$/, '')
  for (const m of body.matchAll(HTML_ATTRIBUTE)) {
    const name = m[1].toLowerCase()
    if (!attrs.has(name)) attrs.set(name, m[2] ?? m[3] ?? m[4] ?? '')
  }
  return attrs
}

/**
 * Upload trong rich text ra `<picture>` với mỗi size 1 `<source media="(max-width: Wpx)">` → màn nhỏ nhận
 * bản crop 400x300 / 1200x630 (méo khung, sai ảnh) → bỏ các <source> đó; <img> chưa có `loading` →
 * thêm loading="lazy" decoding="async" (ảnh trong bài thường nằm dưới ảnh bìa, ngoài màn hình đầu).
 */
function optimizeContentImages(html: string): string {
  if (!/<(?:img|source)(?=[\s/>])/i.test(html)) return html
  return html
    .replace(SOURCE_TAG, (all, open: string) =>
      CROPPED_SIZE_FILE.test(tagAttributes(open).get('srcset') ?? '') ? '' : all,
    )
    .replace(IMG_TAG, (tag) => {
      const attrs = tagAttributes(tag)
      if (attrs.has('loading')) return tag
      const extra = attrs.has('decoding') ? ' loading="lazy"' : ' loading="lazy" decoding="async"'
      return `<img${extra}${tag.slice('<img'.length)}`
    })
}

function contentHtml(value: unknown): string {
  return typeof value === 'string' ? optimizeContentImages(value) : ''
}

function normalizeCategories(raw: unknown): Category[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<number>()
  const out: Category[] = []
  for (const item of raw) {
    const category = normalizeCategory(item)
    if (category && !seen.has(category.id)) {
      seen.add(category.id)
      out.push(category)
    }
  }
  return out
}

/** Doc `posts` (depth=1) → Post. Không có id/slug (không route được) → null */
export function normalizePost(raw: unknown, isFallback = false): Post | null {
  if (!isObject(raw)) return null
  const id = toId(raw.id)
  const slug = str(raw.slug)
  if (id === null || !slug) return null
  const createdAt = isoDate(raw.createdAt)
  const updatedAt = isoDate(raw.updatedAt)
  const publishedAt = isoDate(raw.publishedAt)
  return {
    id,
    slug,
    title: str(raw.title) ?? '',
    excerpt: str(raw.excerpt),
    contentHtml: contentHtml(raw.contentHtml),
    coverImage: normalizeMedia(raw.coverImage),
    categories: normalizeCategories(raw.categories),
    publishedAt: publishedAt ?? updatedAt ?? createdAt ?? EPOCH_ISO,
    updatedAt: updatedAt ?? createdAt ?? publishedAt ?? EPOCH_ISO,
    meta: normalizeSeo(raw.meta),
    isFallback,
  }
}

/** Doc `pages` → Page. Không có id/slug → null */
export function normalizePage(raw: unknown, isFallback = false): Page | null {
  if (!isObject(raw)) return null
  const id = toId(raw.id)
  const slug = str(raw.slug)
  if (id === null || !slug) return null
  return {
    id,
    slug,
    title: str(raw.title) ?? '',
    contentHtml: contentHtml(raw.contentHtml),
    meta: normalizeSeo(raw.meta),
    isFallback,
  }
}

/**
 * Global `site-settings` → SiteSettings; bỏ mục nav/social thiếu dữ liệu, platform lạ hoặc link không an toàn
 * (xem safeLink). Email trần (`a@b.c`) → `mailto:a@b.c`.
 */
export function normalizeSiteSettings(raw: unknown): SiteSettings {
  const s = isObject(raw) ? raw : {}
  const nav: SiteSettings['nav'] = []
  for (const item of Array.isArray(s.nav) ? s.nav : []) {
    if (!isObject(item)) continue
    const label = str(item.label)
    const href = safeLink(cleanLink(item.href))
    if (label && href) nav.push({ label, href })
  }
  const socials: SiteSettings['socials'] = []
  for (const item of Array.isArray(s.socials) ? s.socials : []) {
    if (!isObject(item)) continue
    const platform = SOCIAL_PLATFORMS.find((p) => p === item.platform)
    const link = cleanLink(item.url)
    // Chưa có scheme thì mới thêm mailto: (Footer chỉ thêm khi thiếu mailto: → không bị lặp)
    const hasScheme = link !== null && /^[a-z][a-z0-9+.-]*:/i.test(link)
    const url = safeLink(platform === 'email' && link && !hasScheme ? `mailto:${link}` : link)
    if (platform && url) socials.push({ platform, url })
  }
  return {
    siteName: str(s.siteName) ?? 'qkenn',
    tagline: str(s.tagline),
    description: str(s.description),
    nav,
    socials,
    footerText: str(s.footerText),
  }
}

/** Mới nhất trước; cùng thời điểm thì id lớn trước (thứ tự ổn định giữa các lần build) */
function comparePosts(a: Post, b: Post): number {
  return Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || b.id - a.id
}

// ---------------------------------------------------------------------------------------------
// API công khai (hợp đồng với UI)
// ---------------------------------------------------------------------------------------------

/** Mọi bài đã publish của site qkenn, mới nhất trước */
export async function getPosts(locale: Locale): Promise<Post[]> {
  assertLocale(locale)
  const filters = publishedFilters()
  const [docs, untranslated] = await Promise.all([
    fetchAllDocs('posts', { locale, depth: 1, sort: '-publishedAt', ...filters }),
    findUntranslatedIds('posts', locale, filters, { all: true }),
  ])
  const seen = new Set<number>()
  const posts: Post[] = []
  for (const doc of docs) {
    const post = normalizePost(doc)
    if (!post || seen.has(post.id)) continue
    seen.add(post.id)
    post.isFallback = untranslated.has(post.id)
    posts.push(post)
  }
  return posts.sort(comparePosts)
}

/** 1 bài theo slug (query thẳng theo slug). Không có / chưa publish / thuộc site khác → null */
export async function getPost(slug: string, locale: Locale): Promise<Post | null> {
  assertLocale(locale)
  if (!slug) return null
  const filters = publishedFilters({ 'where[slug][equals]': slug })
  const [list, untranslated] = await Promise.all([
    fetchList('posts', { locale, depth: 1, limit: 1, ...filters }),
    findUntranslatedIds('posts', locale, filters, { all: false }),
  ])
  const post = normalizePost(list.docs[0])
  if (!post) return null
  post.isFallback = untranslated.has(post.id)
  return post
}

/** Mọi danh mục, sắp theo tên (theo locale) */
export async function getCategories(locale: Locale): Promise<Category[]> {
  assertLocale(locale)
  const docs = await fetchAllDocs('categories', { locale, depth: 0, sort: 'slug' })
  return normalizeCategories(docs).sort((a, b) => a.title.localeCompare(b.title, locale) || a.id - b.id)
}

/** Trang tĩnh quản lý trong CMS (collection `pages`), vd slug 'about'. Chưa có → null */
export async function getPage(slug: string, locale: Locale): Promise<Page | null> {
  assertLocale(locale)
  if (!slug) return null
  const filters = publishedFilters({ 'where[slug][equals]': slug })
  try {
    const [list, untranslated] = await Promise.all([
      fetchList('pages', { locale, depth: 1, limit: 1, ...filters }),
      findUntranslatedIds('pages', locale, filters, { all: false }),
    ])
    const page = normalizePage(list.docs[0])
    if (!page) return null
    page.isFallback = untranslated.has(page.id)
    return page
  } catch (err) {
    // Collection `pages` chưa có trên CMS (404 "Route not found") / chưa mở quyền đọc (403) /
    // chưa có field để lọc (400) → coi như chưa có trang. Lỗi mạng / 5xx vẫn làm build fail.
    if (err instanceof CmsError && (err.status === 400 || err.status === 403 || err.status === 404)) return null
    throw err
  }
}

export async function getSiteSettings(locale: Locale): Promise<SiteSettings> {
  assertLocale(locale)
  const path = `/globals/site-settings${buildQuery({ locale, depth: 1 })}`
  const data = await api<unknown>(path)
  if (!isObject(data)) {
    throw new CmsError(`CMS returned an unexpected response on GET ${path}`, { path })
  }
  return normalizeSiteSettings(data)
}
