// Test JSON-LD (src/lib/structured-data.ts): builder thuần + serialize an toàn trong <script>.
import { describe, expect, it } from 'vitest'
import {
  HEADLINE_MAX,
  buildBlogPosting,
  buildBreadcrumbList,
  buildGraph,
  buildItemList,
  buildPerson,
  buildWebSite,
  profileUrls,
  serializeJsonLd,
  truncateHeadline,
  type SiteIdentity,
} from '../src/lib/structured-data'

const SITE = 'https://qkenn.cloud/'
const identity: SiteIdentity = {
  siteUrl: SITE,
  name: 'qkenn',
  alternateNames: ['qkenn.cloud'],
  inLanguage: ['vi', 'en'],
}

/** Nội dung giữa <script type="application/ld+json">…</script> như trình duyệt/Google đọc */
function scriptBody(json: string): string {
  const html = `<script type="application/ld+json">${json}</script>`
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i)
  return m![1]
}

describe('buildWebSite', () => {
  it('có @id/url/name/alternateName/inLanguage + publisher → #person', () => {
    expect(buildWebSite({ ...identity, description: 'Ghi chép  kỹ thuật\n cá nhân' })).toEqual({
      '@type': 'WebSite',
      '@id': 'https://qkenn.cloud/#website',
      url: SITE,
      name: 'qkenn',
      alternateName: ['qkenn.cloud'],
      description: 'Ghi chép kỹ thuật cá nhân',
      inLanguage: ['vi', 'en'],
      publisher: { '@id': 'https://qkenn.cloud/#person' },
    })
  })

  it('bỏ description rỗng/null và mảng rỗng', () => {
    const node = buildWebSite({ ...identity, description: '   ', alternateNames: [] })
    expect(node).not.toHaveProperty('description')
    expect(node).not.toHaveProperty('alternateName')
  })
})

describe('buildPerson', () => {
  it('Person tên = tên site, sameAs chỉ khi có', () => {
    expect(buildPerson(identity)).toEqual({
      '@type': 'Person',
      '@id': 'https://qkenn.cloud/#person',
      name: 'qkenn',
      url: SITE,
    })
    const withLinks = buildPerson({
      ...identity,
      personDescription: 'Kỹ sư phần mềm',
      sameAs: ['https://github.com/qkenn'],
    })
    expect(withLinks.sameAs).toEqual(['https://github.com/qkenn'])
    expect(withLinks.description).toBe('Kỹ sư phần mềm')
  })
})

describe('profileUrls', () => {
  it('chỉ giữ http(s), bỏ mailto:/link nội bộ/URL hỏng/trùng', () => {
    expect(
      profileUrls([
        { platform: 'github', url: 'https://github.com/qkenn' },
        { platform: 'email', url: 'mailto:me@qkenn.cloud' },
        { platform: 'x', url: '/about' },
        { platform: 'linkedin', url: 'http://linkedin.com/in/qkenn' },
        { platform: 'facebook', url: 'https://github.com/qkenn' },
        { platform: 'facebook', url: 'https://exa mple.com' },
      ]),
    ).toEqual(['https://github.com/qkenn', 'http://linkedin.com/in/qkenn'])
  })

  it('null/undefined → []', () => {
    expect(profileUrls(undefined)).toEqual([])
    expect(profileUrls(null)).toEqual([])
  })
})

describe('buildBlogPosting', () => {
  const base = {
    url: 'https://qkenn.cloud/blog/bai-viet/',
    title: 'Bài viết',
    description: 'Mô tả bài',
    datePublished: '2026-09-26T01:46:12.620Z',
    dateModified: '2026-09-26T01:48:45.008Z',
    inLanguage: 'vi',
    sections: ['Web, CMS & Astro'],
  }

  it('đủ trường, author/publisher → #person, isPartOf → #website', () => {
    expect(buildBlogPosting(SITE, { ...base, image: 'https://cms.qkenn.cloud/api/media/file/a-1200x630.png' })).toEqual({
      '@type': 'BlogPosting',
      '@id': 'https://qkenn.cloud/blog/bai-viet/#article',
      headline: 'Bài viết',
      description: 'Mô tả bài',
      datePublished: '2026-09-26T01:46:12.620Z',
      dateModified: '2026-09-26T01:48:45.008Z',
      inLanguage: 'vi',
      mainEntityOfPage: 'https://qkenn.cloud/blog/bai-viet/',
      url: 'https://qkenn.cloud/blog/bai-viet/',
      image: 'https://cms.qkenn.cloud/api/media/file/a-1200x630.png',
      author: { '@id': 'https://qkenn.cloud/#person' },
      publisher: { '@id': 'https://qkenn.cloud/#person' },
      isPartOf: { '@id': 'https://qkenn.cloud/#website' },
      articleSection: 'Web, CMS & Astro',
    })
  })

  it('không có ảnh → bỏ image (không in null)', () => {
    expect(buildBlogPosting(SITE, { ...base, image: null })).not.toHaveProperty('image')
    expect(buildBlogPosting(SITE, base)).not.toHaveProperty('image')
  })

  it('thiếu description/dateModified/sections → bỏ hoặc dùng datePublished', () => {
    const node = buildBlogPosting(SITE, { ...base, description: null, dateModified: null, sections: [] })
    expect(node).not.toHaveProperty('description')
    expect(node).not.toHaveProperty('articleSection')
    expect(node.dateModified).toBe(base.datePublished)
  })

  it('nhiều danh mục → mảng articleSection; keywords nối bằng dấu phẩy', () => {
    const node = buildBlogPosting(SITE, { ...base, sections: ['A', ' ', 'B'], keywords: ['x', 'y'] })
    expect(node.articleSection).toEqual(['A', 'B'])
    expect(node.keywords).toBe('x, y')
  })

  it('bài en chưa dịch (isFallback): view truyền inLanguage vi + URL canonical bản vi', () => {
    const node = buildBlogPosting(SITE, { ...base, inLanguage: 'vi' })
    expect(node.inLanguage).toBe('vi')
    expect(node['@id']).toBe('https://qkenn.cloud/blog/bai-viet/#article')
  })

  it('headline ≤ 110 ký tự', () => {
    const long = 'Từ nút Publish tới symlink: '.repeat(10)
    const node = buildBlogPosting(SITE, { ...base, title: long })
    expect(Array.from(node.headline as string).length).toBeLessThanOrEqual(HEADLINE_MAX)
    expect(node.headline as string).toMatch(/…$/)
  })
})

describe('truncateHeadline', () => {
  it('giữ nguyên chuỗi ngắn, gộp khoảng trắng', () => {
    expect(truncateHeadline('  a   b  ')).toBe('a b')
    const exact = 'x'.repeat(HEADLINE_MAX)
    expect(truncateHeadline(exact)).toBe(exact)
  })

  it('không cắt đôi emoji (cắt theo code point)', () => {
    const out = truncateHeadline('😀'.repeat(200), 10)
    expect(Array.from(out)).toHaveLength(10)
    expect(out).toBe(`${'😀'.repeat(9)}…`)
  })
})

describe('buildBreadcrumbList / buildItemList', () => {
  it('position bắt đầu từ 1, item là URL tuyệt đối', () => {
    expect(
      buildBreadcrumbList('https://qkenn.cloud/blog/x/#breadcrumb', [
        { name: 'Trang chủ', url: 'https://qkenn.cloud/' },
        { name: 'Blog', url: 'https://qkenn.cloud/blog/' },
        { name: 'X', url: 'https://qkenn.cloud/blog/x/' },
      ]),
    ).toEqual({
      '@type': 'BreadcrumbList',
      '@id': 'https://qkenn.cloud/blog/x/#breadcrumb',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Trang chủ', item: 'https://qkenn.cloud/' },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://qkenn.cloud/blog/' },
        { '@type': 'ListItem', position: 3, name: 'X', item: 'https://qkenn.cloud/blog/x/' },
      ],
    })
  })

  it('tên rỗng → dùng URL', () => {
    const node = buildBreadcrumbList('#b', [{ name: ' ', url: 'https://qkenn.cloud/' }])
    expect((node.itemListElement as { name: string }[])[0].name).toBe('https://qkenn.cloud/')
  })

  it('ItemList chỉ có position/url/name', () => {
    expect(buildItemList('https://qkenn.cloud/#latest-posts', [{ name: 'A', url: 'https://qkenn.cloud/blog/a/' }])).toEqual({
      '@type': 'ItemList',
      '@id': 'https://qkenn.cloud/#latest-posts',
      itemListElement: [{ '@type': 'ListItem', position: 1, url: 'https://qkenn.cloud/blog/a/', name: 'A' }],
    })
  })
})

describe('serializeJsonLd', () => {
  it('tiêu đề chứa </script> không đóng được thẻ script, parse lại đúng giá trị gốc', () => {
    const title = 'Hack </script><script>alert(1)</script> <!-- & \u2028\u2029 end'
    const graph = buildGraph([buildBlogPosting(SITE, { ...baseInput(), title })])
    const json = serializeJsonLd(graph)

    expect(json).not.toMatch(/[<>&\u2028\u2029]/)
    expect(json).toContain('\\u003c/script\\u003e')
    // Nội dung script trích bằng cách của trình duyệt vẫn là toàn bộ JSON (không bị cắt ở </script>)
    expect(scriptBody(json)).toBe(json)
    const parsed = JSON.parse(json)
    // headline gộp khoảng trắng (U+2028/2029 cũng là khoảng trắng), còn lại giữ nguyên
    expect(parsed['@graph'][0].headline).toBe(title.replace(/\s+/g, ' '))
  })

  it('U+2028/2029 và ký tự HTML được escape nhưng JSON.parse trả đúng chuỗi gốc', () => {
    const value = { s: 'a\u2028b\u2029c </SCRIPT > <!-- --> & "q"' }
    const json = serializeJsonLd(value)
    expect(json).not.toMatch(/[<>&\u2028\u2029]/)
    expect(json).toContain('\\u2028')
    expect(JSON.parse(json)).toEqual(value)
  })

  it('@context schema.org + @graph', () => {
    const parsed = JSON.parse(serializeJsonLd(buildGraph([buildWebSite(identity), buildPerson(identity)])))
    expect(parsed['@context']).toBe('https://schema.org')
    expect(parsed['@graph'].map((n: { '@type': string }) => n['@type'])).toEqual(['WebSite', 'Person'])
  })
})

function baseInput() {
  return {
    url: 'https://qkenn.cloud/blog/x/',
    title: 'x',
    datePublished: '2026-01-01T00:00:00.000Z',
    inLanguage: 'vi',
  }
}
