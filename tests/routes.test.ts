// Test bản đồ URL song ngữ (src/i18n/routes.ts): link menu CMS (path vi) → trang tương đương ở en.
import { describe, expect, it, vi } from 'vitest'

// `astro:i18n` là module ảo của Astro (không có khi chạy vitest thuần) → giả lập đúng dạng URL của site:
// prefixDefaultLocale: false (vi ở /, en ở /en/), luôn có "/" cuối (trailingSlash: 'ignore' + build.format directory).
vi.mock('astro:i18n', () => ({
  getRelativeLocaleUrl: (locale: string, path = '') => {
    const joined = [locale === 'vi' ? '' : locale, path].filter(Boolean).join('/')
    return joined ? `/${joined}/` : '/'
  },
}))

const { localizeHref, routes } = await import('../src/i18n/routes')

describe('localizeHref (en)', () => {
  it.each([
    ['/', '/en/'],
    ['/blog', '/en/blog/'],
    ['/blog/', '/en/blog/'],
    ['/blog/2', '/en/blog/2/'],
    ['/blog/1', '/en/blog/'],
    ['/gioi-thieu', '/en/about/'],
    ['/gioi-thieu/', '/en/about/'],
    ['/blog/danh-muc/ky-thuat', '/en/blog/category/ky-thuat/'],
    ['/blog/bai-test-cms-production', '/en/blog/bai-test-cms-production/'],
    ['/blog/danh-muc', '/en/blog/danh-muc/'], // bài có slug "danh-muc", không phải trang danh mục
    ['  /blog  ', '/en/blog/'],
  ])('%s → %s', (href, expected) => {
    expect(localizeHref(href, 'en')).toBe(expected)
  })

  it('dùng đúng routes.* (khớp canonical/currentPath của trang en)', () => {
    expect(localizeHref('/', 'en')).toBe(routes.home('en'))
    expect(localizeHref('/blog/3', 'en')).toBe(routes.blog('en', 3))
    expect(localizeHref('/gioi-thieu', 'en')).toBe(routes.about('en'))
    expect(localizeHref('/blog/danh-muc/x', 'en')).toBe(routes.category('en', 'x'))
    expect(localizeHref('/blog/x', 'en')).toBe(routes.post('en', 'x'))
  })

  it('slug đã percent-encode không bị encode 2 lần', () => {
    expect(localizeHref('/blog/danh-muc/k%E1%BB%B9-thu%E1%BA%ADt', 'en')).toBe(
      '/en/blog/category/k%E1%BB%B9-thu%E1%BA%ADt/',
    )
    expect(localizeHref('/blog/kỹ-thuật', 'en')).toBe('/en/blog/k%E1%BB%B9-thu%E1%BA%ADt/')
  })

  it('giữ query/hash sau path đã đổi', () => {
    expect(localizeHref('/gioi-thieu#lien-he', 'en')).toBe('/en/about/#lien-he')
    expect(localizeHref('/blog?tag=x', 'en')).toBe('/en/blog/?tag=x')
  })

  // Không đổi sang en — chỉ chuẩn hoá "/" cuối như normalizeNavHref (link ngoài/mailto/#/file giữ nguyên hẳn)
  it.each([
    ['/en/', '/en/'],
    ['/en', '/en/'],
    ['/en/about/', '/en/about/'],
    ['/en/blog/x', '/en/blog/x/'],
    ['https://github.com/qkenn', 'https://github.com/qkenn'],
    ['http://example.com/blog', 'http://example.com/blog'],
    ['//cdn.example.com/blog', '//cdn.example.com/blog'],
    ['mailto:kenn@example.com', 'mailto:kenn@example.com'],
    ['#main', '#main'],
    ['/rss.xml', '/rss.xml'],
    ['/files/cv.pdf', '/files/cv.pdf'],
    ['/khac', '/khac/'], // path ngoài bản đồ URL
    ['/blog/danh-muc/x/y', '/blog/danh-muc/x/y/'], // quá sâu
    ['/blog/x/y', '/blog/x/y/'], // không phải danh mục
    ['/gioi-thieu/con', '/gioi-thieu/con/'], // không có trang con
    ['/blog/%E0%A4%A', '/blog/%E0%A4%A/'], // percent-encoding hỏng
  ])('giữ nguyên %s', (href, expected) => {
    expect(localizeHref(href, 'en')).toBe(expected)
  })
})

describe('localizeHref (vi)', () => {
  it('trang tiếng Việt giữ nguyên path vi (chỉ thêm "/" cuối như trước)', () => {
    expect(localizeHref('/blog', 'vi')).toBe('/blog/')
    expect(localizeHref('/gioi-thieu', 'vi')).toBe('/gioi-thieu/')
    expect(localizeHref('/', 'vi')).toBe('/')
    expect(localizeHref('https://github.com/qkenn', 'vi')).toBe('https://github.com/qkenn')
  })
})
