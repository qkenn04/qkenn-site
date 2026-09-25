// Test hợp đồng dữ liệu CMS (src/lib/cms.ts). KHÔNG gọi mạng: fetch luôn được mock.
// Fixture trong tests/fixtures lấy từ API thật (Payload 3.90.2):
// - prod-*: https://cms.qkenn.cloud (bài `bai-test-cms-production`, đã dịch vi + en)
// - dev-*:  CMS dev nội bộ, có 1 bài CHƯA dịch en (`dung-cms-voi-payload`) → kiểm tra isFallback
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CMS_URL,
  CmsError,
  clearCmsCache,
  getCategories,
  getPage,
  getPost,
  getPosts,
  getSiteSettings,
  normalizeCategory,
  normalizeMedia,
  normalizePage,
  normalizePost,
  normalizeSeo,
  normalizeSiteSettings,
} from '../src/lib/cms'
import devPostsEn from './fixtures/dev-posts-en.json'
import devPostsEnNoFallback from './fixtures/dev-posts-en-no-fallback.json'
import devPostsEnNoFallbackTitles from './fixtures/dev-posts-en-no-fallback-titles.json'
import prodCategoriesEn from './fixtures/prod-categories-en.json'
import prodPages404 from './fixtures/prod-pages-404.json'
import prodPostsEn from './fixtures/prod-posts-en.json'
import prodPostsEnNoFallbackTitles from './fixtures/prod-posts-en-no-fallback-titles.json'
import prodPostsVi from './fixtures/prod-posts-vi.json'
import prodSiteSettingsVi from './fixtures/prod-site-settings-vi.json'

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

type Doc = Record<string, any>

const clone = <T>(value: T): T => structuredClone(value)
const prodDocVi = (): Doc => clone(prodPostsVi.docs[0]) as Doc
const prodCover = (): Doc => clone(prodPostsVi.docs[0].coverImage) as Doc

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function listBody(docs: unknown[], page = 1, hasNextPage = false) {
  return {
    docs,
    hasNextPage,
    hasPrevPage: page > 1,
    limit: 100,
    nextPage: hasNextPage ? page + 1 : null,
    page,
    pagingCounter: (page - 1) * 100 + 1,
    prevPage: page > 1 ? page - 1 : null,
    totalDocs: docs.length,
    totalPages: hasNextPage ? page + 1 : page,
  }
}

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>

function mockFetch(handler: Handler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(new URL(String(input)), init))
  vi.stubGlobal('fetch', fn)
  return fn
}

function calledUrls(fn: ReturnType<typeof mockFetch>): URL[] {
  return fn.mock.calls.map(([input]) => new URL(String(input)))
}

const isNoFallback = (url: URL) => url.searchParams.get('fallback-locale') === 'none'

function post(id: number, slug: string, publishedAt: string | null, extra: Doc = {}): Doc {
  return { ...prodDocVi(), id, slug, title: `Post ${id}`, publishedAt, ...extra }
}

beforeEach(() => {
  clearCmsCache()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------------------------

describe('normalizeMedia', () => {
  it('maps a populated upload (production fixture)', () => {
    expect(normalizeMedia(prodCover())).toEqual({
      url: 'https://cms.qkenn.cloud/api/media/file/bai-test-cover-1.webp?prefix=qkenn',
      alt: 'Ảnh bìa bài test: chữ qkenn CMS trên nền xanh',
      width: 1600,
      height: 900,
      sizes: {
        thumbnail: {
          url: 'https://cms.qkenn.cloud/api/media/file/bai-test-cover-1-400x300.webp?prefix=qkenn',
          width: 400,
          height: 300,
        },
        card: {
          url: 'https://cms.qkenn.cloud/api/media/file/bai-test-cover-1-800x450.webp?prefix=qkenn',
          width: 800,
          height: 450,
        },
        hero: {
          url: 'https://cms.qkenn.cloud/api/media/file/bai-test-cover-1-1600x900.webp?prefix=qkenn',
          width: 1600,
          height: 900,
        },
        og: {
          url: 'https://cms.qkenn.cloud/api/media/file/bai-test-cover-1-1200x630.webp?prefix=qkenn',
          width: 1200,
          height: 630,
        },
      },
    })
  })

  it('turns sizes Payload could not generate (all-null) into null', () => {
    const raw = prodCover()
    raw.sizes.og = { url: null, width: null, height: null, mimeType: null, filesize: null, filename: null }
    raw.sizes.hero = null
    const media = normalizeMedia(raw)
    expect(media?.sizes.og).toBeNull()
    expect(media?.sizes.hero).toBeNull()
    expect(media?.sizes.card?.width).toBe(800)
  })

  it('tolerates missing sizes / alt / dimensions and makes relative URLs absolute', () => {
    expect(normalizeMedia({ url: '/api/media/file/a.webp' })).toEqual({
      url: `${CMS_URL}/api/media/file/a.webp`,
      alt: '',
      width: 0,
      height: 0,
      sizes: { thumbnail: null, card: null, hero: null, og: null },
    })
  })

  it('returns null for unpopulated ids, null and docs without url', () => {
    expect(normalizeMedia(1)).toBeNull()
    expect(normalizeMedia(null)).toBeNull()
    expect(normalizeMedia(undefined)).toBeNull()
    expect(normalizeMedia({ id: 1, alt: 'x', url: null })).toBeNull()
  })
})

describe('normalizeCategory / normalizeSeo', () => {
  it('drops unpopulated ids and docs without slug', () => {
    expect(normalizeCategory(prodCategoriesEn.docs[0])).toEqual({ id: 1, slug: 'ky-thuat', title: 'Engineering' })
    expect(normalizeCategory(3)).toBeNull()
    expect(normalizeCategory({ id: 3, title: 'No slug' })).toBeNull()
    expect(normalizeCategory({ id: 4, slug: 'no-title' })).toEqual({ id: 4, slug: 'no-title', title: 'no-title' })
  })

  it('always returns the three SEO keys', () => {
    expect(normalizeSeo(undefined)).toEqual({ title: null, description: null, image: null })
    expect(normalizeSeo({})).toEqual({ title: null, description: null, image: null })
    expect(normalizeSeo({ title: ' T ', description: '', image: 5 })).toEqual({
      title: 'T',
      description: null,
      image: null,
    })
    expect(normalizeSeo({ image: prodCover() }).image?.width).toBe(1600)
  })
})

describe('normalizePost', () => {
  it('maps the production post (vi) to the contract shape and nothing more', () => {
    const raw = prodDocVi()
    const result = normalizePost(raw)
    expect(result).toEqual({
      id: 2,
      slug: 'bai-test-cms-production',
      title: 'Bài test: CMS đã chạy trên production',
      excerpt:
        'Bài viết thử để kiểm tra output của Payload CMS: tiêu đề, định dạng chữ, danh sách, trích dẫn và ảnh bìa.',
      contentHtml: raw.contentHtml,
      coverImage: normalizeMedia(raw.coverImage),
      categories: [{ id: 1, slug: 'ky-thuat', title: 'Kỹ thuật' }],
      publishedAt: '2026-09-25T06:29:37.884Z',
      updatedAt: '2026-09-25T06:29:37.983Z',
      meta: { title: null, description: null, image: null },
      isFallback: false,
    })
    expect(result?.contentHtml.startsWith('<div class="payload-richtext">')).toBe(true)
    // không lọt field nội bộ của Payload (content Lexical, author, _status, ...)
    expect(result && 'content' in result).toBe(false)
    expect(result && 'author' in result).toBe(false)
  })

  it('maps the production post (en)', () => {
    const result = normalizePost(prodPostsEn.docs[0])
    expect(result?.title).toBe('Test post: the CMS is live in production')
    expect(result?.categories).toEqual([{ id: 1, slug: 'ky-thuat', title: 'Engineering' }])
    expect(result?.coverImage?.alt).toBe('Test post cover: "qkenn CMS" on a blue background')
  })

  it('tolerates a sparse doc (untranslated, fetched with fallback-locale=none)', () => {
    const raw = devPostsEnNoFallback.docs.find((d) => d.slug === 'dung-cms-voi-payload')
    expect(raw).toBeDefined()
    expect(normalizePost(raw)).toEqual({
      id: 2,
      slug: 'dung-cms-voi-payload',
      title: '',
      excerpt: null,
      contentHtml: '',
      coverImage: null,
      categories: [{ id: 1, slug: 'ky-thuat', title: 'Engineering' }],
      publishedAt: '2026-09-25T03:27:15.717Z',
      updatedAt: '2026-09-25T03:27:15.718Z',
      meta: { title: null, description: null, image: null },
      isFallback: false,
    })
  })

  it('drops category ids, dedupes categories and applies defaults', () => {
    const result = normalizePost(
      {
        id: '7',
        slug: 'x',
        categories: [1, { id: 2, slug: 'a', title: 'A' }, { id: 2, slug: 'a', title: 'A' }, null],
        coverImage: 12,
        meta: null,
        contentHtml: null,
        excerpt: '   ',
        publishedAt: null,
        updatedAt: '2026-01-02T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      true,
    )
    expect(result).toEqual({
      id: 7,
      slug: 'x',
      title: '',
      excerpt: null,
      contentHtml: '',
      coverImage: null,
      categories: [{ id: 2, slug: 'a', title: 'A' }],
      publishedAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      meta: { title: null, description: null, image: null },
      isFallback: true,
    })
  })

  it('falls back publishedAt → updatedAt → createdAt, and never returns an invalid date', () => {
    expect(normalizePost({ id: 1, slug: 's', createdAt: '2026-03-01T00:00:00.000Z' })?.publishedAt).toBe(
      '2026-03-01T00:00:00.000Z',
    )
    const empty = normalizePost({ id: 1, slug: 's', publishedAt: 'not a date' })
    expect(empty?.publishedAt).toBe('1970-01-01T00:00:00.000Z')
    expect(empty?.updatedAt).toBe('1970-01-01T00:00:00.000Z')
  })

  it('returns null when the doc cannot be routed', () => {
    expect(normalizePost(null)).toBeNull()
    expect(normalizePost(5)).toBeNull()
    expect(normalizePost({ id: 1 })).toBeNull()
    expect(normalizePost({ slug: 'no-id' })).toBeNull()
  })
})

describe('normalizePage', () => {
  it('maps a page doc and defaults missing fields', () => {
    expect(
      normalizePage({
        id: 3,
        slug: 'about',
        title: 'Giới thiệu',
        content: { root: {} },
        contentHtml: '<div class="payload-richtext"><p>Hi</p></div>',
        meta: { title: 'About | qkenn', description: 'd', image: prodCover() },
        site: 'qkenn',
        _status: 'published',
      }),
    ).toEqual({
      id: 3,
      slug: 'about',
      title: 'Giới thiệu',
      contentHtml: '<div class="payload-richtext"><p>Hi</p></div>',
      meta: { title: 'About | qkenn', description: 'd', image: normalizeMedia(prodCover()) },
      isFallback: false,
    })
    expect(normalizePage({ id: 3, slug: 'about', meta: {} }, true)).toEqual({
      id: 3,
      slug: 'about',
      title: '',
      contentHtml: '',
      meta: { title: null, description: null, image: null },
      isFallback: true,
    })
    expect(normalizePage(undefined)).toBeNull()
  })
})

describe('contentHtml images (fallback cho converter upload của Payload)', () => {
  // Đúng khuôn UploadHTMLConverter của @payloadcms/richtext-lexical 3.90.2 (1 <source> mỗi size, theo thứ tự
  // size của collection media: thumbnail, card, hero, og), dữ liệu ảnh bìa production
  const FILE = 'https://cms.qkenn.cloud/api/media/file'
  const source = (file: string, width: number) => `
        <source
          media="(max-width: ${width}px)"
          srcset="${FILE}/${file}?prefix=qkenn"
          type="image/webp"
        />
      `
  const thumb = source('bai-test-cover-1-400x300.webp', 400)
  const card = source('bai-test-cover-1-800x450.webp', 800)
  const hero = source('bai-test-cover-1-1600x900.webp', 1600)
  const og = source('bai-test-cover-1-1200x630.webp', 1200)
  const img = `
      <img
        alt="Ảnh bìa bài test: chữ qkenn CMS trên nền xanh"
        height="900"
        src="${FILE}/bai-test-cover-1.webp?prefix=qkenn"
        width="1600"
      />
    `
  const uploadHtml =
    `<div class="payload-richtext"><p>Trước ảnh</p><picture>${thumb}${card}${hero}${og}${img}</picture>` +
    `<p>Sau ảnh &lt;img src=x&gt;</p></div>`

  it('drops the 400x300 / 1200x630 crop <source>s and lazy-loads the <img> (post)', () => {
    const result = normalizePost({ id: 1, slug: 's', contentHtml: uploadHtml })?.contentHtml
    // chỉ bỏ đúng 2 thẻ <source> crop (khoảng trắng quanh thẻ giữ nguyên), <img> thêm 2 attribute
    expect(result).toBe(
      uploadHtml
        .replace(thumb.trim(), '')
        .replace(og.trim(), '')
        .replace('<img\n', '<img loading="lazy" decoding="async"\n'),
    )
    expect(result).toContain(card.trim())
    expect(result).toContain(hero.trim())
    expect(result).not.toMatch(/400x300|1200x630/)
    // chạy lại trên kết quả không đổi gì (không thêm loading 2 lần)
    expect(normalizePost({ id: 1, slug: 's', contentHtml: result })?.contentHtml).toBe(result)
  })

  it('applies the same fix to pages', () => {
    const result = normalizePage({ id: 3, slug: 'about', contentHtml: uploadHtml })?.contentHtml
    expect(result).not.toMatch(/400x300|1200x630/)
    expect(result).toContain('<img loading="lazy" decoding="async"\n')
    expect(result).toBe(normalizePost({ id: 1, slug: 's', contentHtml: uploadHtml })?.contentHtml)
  })

  it('is conservative with other markup', () => {
    const html = [
      // ảnh không có sizes (khuôn 2 của converter, có providedStyleTag)
      `<img style="width: 50%"\n alt="a" height="10" src="${FILE}/a.png" width="10"\n/>`,
      '<img loading="eager" src="/b.webp">',
      '<img decoding="sync" src="/c.webp">',
      '<img alt="loading=nope" src="/d.webp">',
      '<IMG SRC="/e.webp">',
      '<imgx src="/f.webp">',
      `<source srcset="${FILE}/x-400x300.webp"></source>`,
      `<source srcset="${FILE}/x-1200x630.webp?prefix=qkenn 1x, ${FILE}/x.webp 2x">`,
      `<source srcset="${FILE}/x-400x3000.webp">`,
      `<source srcset="${FILE}/x-1400x300.webp">`,
      `<source data-srcset="${FILE}/x-400x300.webp" srcset="${FILE}/x.webp">`,
      `<video><source src="${FILE}/clip-400x300.mp4" type="video/mp4"></video>`,
    ].join('|')
    expect(normalizePost({ id: 1, slug: 's', contentHtml: html })?.contentHtml.split('|')).toEqual([
      `<img loading="lazy" decoding="async" style="width: 50%"\n alt="a" height="10" src="${FILE}/a.png" width="10"\n/>`,
      '<img loading="eager" src="/b.webp">',
      '<img loading="lazy" decoding="sync" src="/c.webp">',
      '<img loading="lazy" decoding="async" alt="loading=nope" src="/d.webp">',
      '<img loading="lazy" decoding="async" SRC="/e.webp">',
      '<imgx src="/f.webp">',
      '',
      '',
      `<source srcset="${FILE}/x-400x3000.webp">`,
      `<source srcset="${FILE}/x-1400x300.webp">`,
      `<source data-srcset="${FILE}/x-400x300.webp" srcset="${FILE}/x.webp">`,
      `<video><source src="${FILE}/clip-400x300.mp4" type="video/mp4"></video>`,
    ])
  })
})

describe('normalizeSiteSettings', () => {
  it('fills defaults for the current (empty) production global', () => {
    expect(normalizeSiteSettings(prodSiteSettingsVi)).toEqual({
      siteName: 'qkenn',
      tagline: null,
      description: null,
      nav: [],
      socials: [],
      footerText: null,
    })
  })

  it('keeps valid nav/socials, drops incomplete items and unknown platforms', () => {
    // Dạng Payload trả cho array field (có `id` từng dòng) — dữ liệu tổng hợp
    const raw = {
      siteName: 'qkenn',
      tagline: 'Ghi chép kỹ thuật',
      description: '',
      nav: [
        { id: 'a1', label: 'Blog', href: '/blog' },
        { id: 'a2', label: 'Giới thiệu', href: '/gioi-thieu' },
        { id: 'a3', label: '', href: '/x' },
        { id: 'a4', label: 'No href' },
        null,
      ],
      socials: [
        { id: 'b1', platform: 'github', url: 'https://github.com/qkenn04' },
        { id: 'b2', platform: 'myspace', url: 'https://myspace.com/x' },
        { id: 'b3', platform: 'email', url: '' },
        { id: 'b4', platform: 'email', url: 'mailto:hi@qkenn.cloud' },
      ],
      footerText: '© qkenn',
      globalType: 'site-settings',
      updatedAt: '2026-09-25T00:00:00.000Z',
    }
    expect(normalizeSiteSettings(raw)).toEqual({
      siteName: 'qkenn',
      tagline: 'Ghi chép kỹ thuật',
      description: null,
      nav: [
        { label: 'Blog', href: '/blog' },
        { label: 'Giới thiệu', href: '/gioi-thieu' },
      ],
      socials: [
        { platform: 'github', url: 'https://github.com/qkenn04' },
        { platform: 'email', url: 'mailto:hi@qkenn.cloud' },
      ],
      footerText: '© qkenn',
    })
  })

  it('drops nav/social links with unsafe schemes (stored XSS via javascript:, data:, //host)', () => {
    const unsafe = [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:x',
      '\tjavascript:x',
      '\u0000javascript:x',
      'java\tscript:x',
      'java\nscript:x',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      '//evil.com',
      '/\\evil.com',
      '/\t/evil.com',
      '\\\\evil.com',
    ]
    const settings = normalizeSiteSettings({
      nav: unsafe.map((href, i) => ({ label: `Link ${i}`, href })),
      socials: unsafe.map((url) => ({ platform: 'github', url })),
    })
    expect(settings.nav).toEqual([])
    expect(settings.socials).toEqual([])
    // email: link đã có scheme thì không thêm mailto: → vẫn bị chặn
    const email = normalizeSiteSettings({
      socials: ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\tscript:x', 'data:text/html,x'].map((url) => ({
        platform: 'email',
        url,
      })),
    })
    expect(email.socials).toEqual([])
  })

  it('keeps safe links: site paths, #/?, http(s), mailto; bare emails become mailto:', () => {
    const settings = normalizeSiteSettings({
      nav: [
        { label: 'Blog', href: '/blog' },
        { label: 'Trim', href: '  /gioi-thieu\n' },
        { label: 'Hash', href: '#top' },
        { label: 'Query', href: '?page=2' },
        { label: 'GitHub', href: 'https://github.com/x' },
        { label: 'Http', href: 'HTTP://example.com/a' },
        { label: 'Mail', href: 'mailto:a@b.c' },
      ],
      socials: [
        { platform: 'github', url: 'https://github.com/x' },
        { platform: 'linkedin', url: ' https://www.linkedin.com/in/x ' },
        { platform: 'email', url: 'mailto:a@b.c' },
        { platform: 'email', url: 'MAILTO:c@d.e' },
        { platform: 'email', url: 'a@b.c' },
        { platform: 'email', url: ' hi@qkenn.cloud\t' },
      ],
    })
    expect(settings.nav).toEqual([
      { label: 'Blog', href: '/blog' },
      { label: 'Trim', href: '/gioi-thieu' },
      { label: 'Hash', href: '#top' },
      { label: 'Query', href: '?page=2' },
      { label: 'GitHub', href: 'https://github.com/x' },
      { label: 'Http', href: 'HTTP://example.com/a' },
      { label: 'Mail', href: 'mailto:a@b.c' },
    ])
    expect(settings.socials).toEqual([
      { platform: 'github', url: 'https://github.com/x' },
      { platform: 'linkedin', url: 'https://www.linkedin.com/in/x' },
      { platform: 'email', url: 'mailto:a@b.c' },
      { platform: 'email', url: 'MAILTO:c@d.e' },
      { platform: 'email', url: 'mailto:a@b.c' },
      { platform: 'email', url: 'mailto:hi@qkenn.cloud' },
    ])
    // Footer chỉ thêm mailto: khi thiếu (/^mailto:/i) → không bao giờ thành mailto:mailto:
    expect(settings.socials.every((s) => s.platform !== 'email' || /^mailto:/i.test(s.url))).toBe(true)
  })

  it('never throws on garbage', () => {
    expect(normalizeSiteSettings(null).nav).toEqual([])
    expect(normalizeSiteSettings({ nav: 'x', socials: {} }).socials).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// getPosts: phân trang, lọc, sắp xếp
// ---------------------------------------------------------------------------------------------

describe('getPosts', () => {
  it('follows hasNextPage across pages (limit 100) and sorts newest first', async () => {
    const page1 = [
      post(10, 'moi-nhat', '2026-09-20T00:00:00.000Z'),
      post(9, 'cu-hon', '2026-09-10T00:00:00.000Z'),
    ]
    // publishedAt null → dùng updatedAt để sắp (Postgres DESC để NULL lên đầu, client phải sắp lại)
    const page2 = [post(8, 'khong-ngay', null, { updatedAt: '2026-09-15T00:00:00.000Z' })]
    const fetchMock = mockFetch((url) => {
      const page = url.searchParams.get('page')
      if (page === '1') return json(listBody(page1, 1, true))
      if (page === '2') return json(listBody(page2, 2, false))
      return json({ message: 'unexpected' }, 400)
    })

    const posts = await getPosts('vi')

    expect(posts.map((p) => p.slug)).toEqual(['moi-nhat', 'khong-ngay', 'cu-hon'])
    expect(posts.every((p) => p.isFallback === false)).toBe(true)
    const urls = calledUrls(fetchMock)
    expect(urls).toHaveLength(2) // vi: không cần request kiểm tra bản dịch
    for (const [i, url] of urls.entries()) {
      expect(url.origin + url.pathname).toBe(`${CMS_URL}/api/posts`)
      expect(url.searchParams.get('page')).toBe(String(i + 1))
      expect(url.searchParams.get('limit')).toBe('100')
      expect(url.searchParams.get('locale')).toBe('vi')
      expect(url.searchParams.get('depth')).toBe('1')
      expect(url.searchParams.get('sort')).toBe('-publishedAt')
      expect(url.searchParams.get('where[_status][equals]')).toBe('published')
      expect(url.searchParams.get('where[site][equals]')).toBe('qkenn')
      expect(url.searchParams.has('fallback-locale')).toBe(false)
    }
  })

  it('dedupes a post that shows up on two pages', async () => {
    mockFetch((url) =>
      url.searchParams.get('page') === '1'
        ? json(listBody([post(1, 'a', '2026-01-02T00:00:00.000Z')], 1, true))
        : json(listBody([post(1, 'a', '2026-01-02T00:00:00.000Z'), post(2, 'b', '2026-01-01T00:00:00.000Z')], 2)),
    )
    expect((await getPosts('vi')).map((p) => p.id)).toEqual([1, 2])
  })

  it('throws (build must fail) when the list response has no docs array', async () => {
    mockFetch(() => json({ nope: true }))
    await expect(getPosts('vi')).rejects.toThrow(/unexpected list response on GET \/posts\?.*no "docs" array/)
    await expect(getPosts('vi')).rejects.toBeInstanceOf(CmsError)
  })

  it('throws immediately (no retry) on 4xx for posts', async () => {
    const fetchMock = mockFetch(() => json({ errors: [{ message: 'You are not allowed to perform this action.' }] }, 403))
    await expect(getPosts('vi')).rejects.toThrow(/403.*\/posts\?.*not allowed/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects unsupported locales', async () => {
    mockFetch(() => json(listBody([])))
    // @ts-expect-error — locale ngoài hợp đồng
    await expect(getPosts('fr')).rejects.toThrow(/Unsupported locale "fr"/)
  })
})

// ---------------------------------------------------------------------------------------------
// isFallback
// ---------------------------------------------------------------------------------------------

describe('isFallback', () => {
  it('flags en posts without their own translation, but keeps the vi content', async () => {
    const fetchMock = mockFetch((url) => json(isNoFallback(url) ? devPostsEnNoFallbackTitles : devPostsEn))

    const posts = await getPosts('en')

    const untranslated = posts.find((p) => p.slug === 'dung-cms-voi-payload')
    const translated = posts.find((p) => p.slug === 'xin-chao')
    expect(untranslated?.isFallback).toBe(true)
    expect(untranslated?.title).toBe('Dựng CMS với Payload') // nội dung vi để trang vẫn render
    expect(untranslated?.meta).toEqual({ title: null, description: null, image: null })
    expect(translated?.isFallback).toBe(false)
    expect(translated?.title).toBe('Hello')

    // Đúng 1 request phụ cho cả danh sách: tắt fallback, chỉ lấy title, cùng bộ lọc
    const check = calledUrls(fetchMock).filter(isNoFallback)
    expect(check).toHaveLength(1)
    expect(check[0].searchParams.get('locale')).toBe('en')
    expect(check[0].searchParams.get('select[title]')).toBe('true')
    expect(check[0].searchParams.get('depth')).toBe('0')
    expect(check[0].searchParams.get('where[_status][equals]')).toBe('published')
    expect(check[0].searchParams.get('where[site][equals]')).toBe('qkenn')
    expect(check[0].searchParams.get('limit')).toBe('100')
  })

  it('is false for the translated production post in en', async () => {
    mockFetch((url) => json(isNoFallback(url) ? prodPostsEnNoFallbackTitles : prodPostsEn))
    const posts = await getPosts('en')
    expect(posts).toHaveLength(1)
    expect(posts[0].isFallback).toBe(false)
    expect(posts[0].title).toBe('Test post: the CMS is live in production')
  })

  it('works for getPost (single slug query)', async () => {
    const pick = (body: { docs: Doc[] }, slug: string) => ({
      ...body,
      docs: body.docs.filter((d) => d.id === (slug === 'dung-cms-voi-payload' ? 2 : 1)),
    })
    const fetchMock = mockFetch((url) => {
      const slug = url.searchParams.get('where[slug][equals]') ?? ''
      return json(pick(isNoFallback(url) ? devPostsEnNoFallbackTitles : devPostsEn, slug))
    })
    expect((await getPost('dung-cms-voi-payload', 'en'))?.isFallback).toBe(true)
    expect((await getPost('xin-chao', 'en'))?.isFallback).toBe(false)
    expect(calledUrls(fetchMock).filter(isNoFallback)).toHaveLength(2)
  })

  it('works for getPage', async () => {
    const page = { id: 3, slug: 'about', title: 'Giới thiệu', contentHtml: '<div class="payload-richtext"></div>' }
    mockFetch((url) => json(listBody([isNoFallback(url) ? { id: 3 } : page])))
    const result = await getPage('about', 'en')
    expect(result?.isFallback).toBe(true)
    expect(result?.title).toBe('Giới thiệu')
  })
})

// ---------------------------------------------------------------------------------------------
// getPost / getCategories / getPage / getSiteSettings
// ---------------------------------------------------------------------------------------------

describe('getPost', () => {
  it('queries by slug directly and returns null when not found', async () => {
    const fetchMock = mockFetch((url) =>
      json(
        url.searchParams.get('where[slug][equals]') === 'bai-test-cms-production' ? prodPostsVi : listBody([]),
      ),
    )
    const found = await getPost('bai-test-cms-production', 'vi')
    expect(found?.id).toBe(2)
    expect(await getPost('khong-co', 'vi')).toBeNull()

    const urls = calledUrls(fetchMock)
    expect(urls).toHaveLength(2)
    expect(urls[0].searchParams.get('limit')).toBe('1')
    expect(urls[0].searchParams.get('where[site][equals]')).toBe('qkenn')
    expect(urls[0].searchParams.get('where[_status][equals]')).toBe('published')
    expect(urls[1].searchParams.get('where[slug][equals]')).toBe('khong-co')
  })

  it('encodes slugs safely', async () => {
    const fetchMock = mockFetch(() => json(listBody([])))
    await getPost('a&b=c', 'vi')
    expect(String(fetchMock.mock.calls[0][0])).toContain('where[slug][equals]=a%26b%3Dc')
    expect(calledUrls(fetchMock)[0].searchParams.get('where[slug][equals]')).toBe('a&b=c')
  })
})

describe('getCategories', () => {
  it('drops broken docs and sorts by title', async () => {
    mockFetch(() =>
      json(
        listBody([
          ...prodCategoriesEn.docs,
          { id: 5, slug: 'ai', title: 'AI' },
          { id: 6, title: 'no slug' },
        ]),
      ),
    )
    expect(await getCategories('en')).toEqual([
      { id: 5, slug: 'ai', title: 'AI' },
      { id: 1, slug: 'ky-thuat', title: 'Engineering' },
    ])
  })
})

describe('getPage', () => {
  it('returns null when the pages collection does not exist yet (404 from production)', async () => {
    const fetchMock = mockFetch(() => json(prodPages404, 404))
    expect(await getPage('about', 'vi')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1) // 404 không retry
    expect(await getPage('about', 'en')).toBeNull()
  })

  it('returns null on 403 and 400', async () => {
    mockFetch(() => json({ errors: [{ message: 'Forbidden' }] }, 403))
    expect(await getPage('about', 'vi')).toBeNull()
    clearCmsCache()
    mockFetch(() => json({ errors: [{ message: 'The following path cannot be queried: site' }] }, 400))
    expect(await getPage('about', 'vi')).toBeNull()
  })

  it('returns null when the slug has no published page', async () => {
    mockFetch(() => json(listBody([])))
    expect(await getPage('about', 'vi')).toBeNull()
  })

  it('still throws on 5xx (after retries)', async () => {
    vi.useFakeTimers()
    const fetchMock = mockFetch(() => json({ errors: [{ message: 'Something went wrong.' }] }, 500))
    const result = expect(getPage('about', 'vi')).rejects.toThrow(/500/)
    await vi.runAllTimersAsync()
    await result
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('getSiteSettings', () => {
  it('reads the global with the requested locale', async () => {
    const fetchMock = mockFetch(() => json(prodSiteSettingsVi))
    expect((await getSiteSettings('en')).siteName).toBe('qkenn')
    const [url] = calledUrls(fetchMock)
    expect(url.pathname).toBe('/api/globals/site-settings')
    expect(url.searchParams.get('locale')).toBe('en')
  })
})

// ---------------------------------------------------------------------------------------------
// api(): timeout, retry, lỗi rõ ràng
// ---------------------------------------------------------------------------------------------

describe('api error handling', () => {
  it('throws a CmsError with status + path after 2 retries on 500', async () => {
    vi.useFakeTimers()
    const fetchMock = mockFetch(() => json({ errors: [{ message: 'Something went wrong.' }] }, 500))

    const promise = getSiteSettings('vi')
    const settled = promise.then(
      () => null,
      (err: unknown) => err,
    )
    await vi.runAllTimersAsync()
    const err = await settled

    expect(err).toBeInstanceOf(CmsError)
    expect((err as CmsError).status).toBe(500)
    expect((err as CmsError).path).toBe('/globals/site-settings?locale=vi&depth=1')
    expect((err as Error).message).toMatch(
      /CMS responded 500 .*GET \/globals\/site-settings\?locale=vi&depth=1 — Something went wrong\. \(gave up after 3 attempts\)/,
    )
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('retries network errors and succeeds', async () => {
    vi.useFakeTimers()
    let calls = 0
    const fetchMock = mockFetch(() => {
      calls++
      if (calls === 1) throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })
      if (calls === 2) return new Response('<html>Bad gateway</html>', { status: 502 })
      return json(prodSiteSettingsVi)
    })
    const promise = getSiteSettings('vi')
    await vi.runAllTimersAsync()
    expect((await promise).siteName).toBe('qkenn')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('reports network failures with the path', async () => {
    vi.useFakeTimers()
    mockFetch(() => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })
    })
    const result = expect(getPosts('vi')).rejects.toThrow(
      /CMS network error on GET \/posts\?.*TypeError: fetch failed \(ECONNREFUSED\).*gave up after 3 attempts/,
    )
    await vi.runAllTimersAsync()
    await result
  })

  it('passes a timeout signal to fetch', async () => {
    const fetchMock = mockFetch(() => json(prodSiteSettingsVi))
    await getSiteSettings('vi')
    const init = fetchMock.mock.calls[0][1]
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(init?.signal?.aborted).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// Memo trong 1 lần build
// ---------------------------------------------------------------------------------------------

describe('memoization', () => {
  it('fetches identical GETs once, concurrent or sequential', async () => {
    const fetchMock = mockFetch(() => json(prodPostsVi))
    const [a, b] = await Promise.all([getPosts('vi'), getPosts('vi')])
    const c = await getPosts('vi')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(c).toEqual(a)

    // mỗi lần gọi nhận object riêng: trang này sửa mảng không ảnh hưởng trang khác
    expect(a).not.toBe(b)
    a[0].title = 'changed'
    a.reverse()
    expect((await getPosts('vi'))[0].title).toBe('Bài test: CMS đã chạy trên production')
  })

  it('does not share cache across different requests', async () => {
    const fetchMock = mockFetch((url) => json(url.searchParams.get('locale') === 'vi' ? prodPostsVi : prodPostsEn))
    await getPosts('vi')
    await getPosts('en')
    // vi: 1 · en: 1 + 1 (kiểm tra bản dịch)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not cache failures', async () => {
    vi.useFakeTimers()
    let fail = true
    const fetchMock = mockFetch(() => (fail ? json({ message: 'down' }, 503) : json(prodSiteSettingsVi)))
    const first = getSiteSettings('vi').catch((err: unknown) => err)
    await vi.runAllTimersAsync()
    expect(await first).toBeInstanceOf(CmsError)
    fail = false
    expect((await getSiteSettings('vi')).siteName).toBe('qkenn')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('clearCmsCache forces a refetch', async () => {
    const fetchMock = mockFetch(() => json(prodSiteSettingsVi))
    await getSiteSettings('vi')
    clearCmsCache()
    await getSiteSettings('vi')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
