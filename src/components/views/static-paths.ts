// getStaticPaths dùng chung cho route vi và en (file route chỉ gọi hàm này với locale tương ứng).
// Dữ liệu chỉ lấy qua src/lib/cms.ts; lọc theo danh mục làm tại đây trên kết quả getPosts.
import type { PaginateFunction } from 'astro'
import { getCategories, getPosts, type Category, type Locale, type Post } from '../../lib/cms'
import { otherLocale } from '../../i18n/ui'

export const POSTS_PER_PAGE = 10

/** Tóm tắt bài dùng cho link bài trước/sau */
export interface PostLink {
  slug: string
  title: string
  isFallback: boolean
}

export interface CategorySummary {
  slug: string
  title: string
  count: number
}

const toLink = (post: Post | undefined): PostLink | null =>
  post ? { slug: post.slug, title: post.title, isFallback: post.isFallback } : null

/** Danh mục có bài, kèm số bài, theo thứ tự tên */
function summarizeCategories(posts: Post[], locale: Locale): CategorySummary[] {
  const map = new Map<string, CategorySummary>()
  for (const post of posts) {
    for (const c of post.categories) {
      if (!c?.slug) continue
      const entry = map.get(c.slug) ?? { slug: c.slug, title: c.title || c.slug, count: 0 }
      entry.count++
      map.set(c.slug, entry)
    }
  }
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title, locale))
}

/** Số trang của danh sách blog có `count` bài (cùng công thức với paginate của Astro: tối thiểu 1 trang) */
export const lastPageOf = (count: number) => Math.max(1, Math.ceil(count / POSTS_PER_PAGE))

/** Slug toàn số (vd "2") trùng URL phân trang /blog/2/ → không tạo trang bài */
export const isRoutablePostSlug = (slug: string) => !!slug && !/^\d+$/.test(slug)

const warnedSlugs = new Set<string>()

/** /blog, /blog/2, … — 10 bài/trang */
export async function blogListPaths(locale: Locale, paginate: PaginateFunction) {
  const [posts, otherPosts] = await Promise.all([getPosts(locale), getPosts(otherLocale(locale))])
  const otherLastPage = lastPageOf(otherPosts.length)
  return paginate(posts, {
    pageSize: POSTS_PER_PAGE,
    props: { categories: summarizeCategories(posts, locale), otherLastPage },
  })
}

/** /blog/<slug> — kèm bài cũ hơn/mới hơn và thông tin bản ở ngôn ngữ còn lại */
export async function postPaths(locale: Locale) {
  const [posts, otherPosts] = await Promise.all([getPosts(locale), getPosts(otherLocale(locale))])
  const otherBySlug = new Map(otherPosts.map((p) => [p.slug, p]))
  return posts
    .filter((post) => {
      if (isRoutablePostSlug(post.slug)) return true
      if (post.slug && !warnedSlugs.has(post.slug)) {
        warnedSlugs.add(post.slug)
        console.warn(
          `[static-paths] Bỏ qua bài có slug toàn số "${post.slug}" (id ${post.id}): trùng URL phân trang /blog/${post.slug}/ — đổi slug trên CMS.`,
        )
      }
      return false
    })
    .map((post, i, list) => {
      const other = otherBySlug.get(post.slug)
      return {
        params: { slug: post.slug },
        props: {
          post,
          // Danh sách mới nhất trước: phần tử sau là bài cũ hơn
          older: toLink(list[i + 1]),
          newer: toLink(list[i - 1]),
          alternate: other ? { isFallback: other.isFallback } : null,
        },
      }
    })
}

const categorySlugsWithPosts = (posts: Post[]) =>
  new Set(posts.flatMap((p) => p.categories.map((c) => c?.slug).filter(Boolean)))

/**
 * /blog/danh-muc/<slug> — chỉ danh mục CÓ bài của site qkenn ở ngôn ngữ này
 * (getCategories trả mọi danh mục trên CMS, kể cả của site khác / chưa có bài → không tạo trang rỗng).
 */
export async function categoryPaths(locale: Locale) {
  const [posts, categories, otherPosts] = await Promise.all([
    getPosts(locale),
    getCategories(locale),
    getPosts(otherLocale(locale)),
  ])
  const used = categorySlugsWithPosts(posts)
  const otherUsed = categorySlugsWithPosts(otherPosts)

  // Tên danh mục lấy từ getCategories (theo ngôn ngữ); danh mục chỉ thấy qua bài viết vẫn được giữ
  const bySlug = new Map<string, Category>()
  for (const c of categories) if (c?.slug && used.has(c.slug)) bySlug.set(c.slug, c)
  for (const post of posts) {
    for (const c of post.categories) if (c?.slug && !bySlug.has(c.slug)) bySlug.set(c.slug, c)
  }

  return [...bySlug.values()].map((category) => ({
    params: { slug: category.slug },
    props: {
      category,
      posts: posts.filter((p) => p.categories.some((c) => c?.slug === category.slug)),
      hasAlternate: otherUsed.has(category.slug),
    },
  }))
}
