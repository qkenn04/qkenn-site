// Chuỗi giao diện (không phải nội dung CMS) cho vi/en + định dạng ngày.
import type { Locale } from '../lib/cms'

export const localeMeta = {
  vi: { htmlLang: 'vi', intl: 'vi-VN', og: 'vi_VN', name: 'Tiếng Việt' },
  en: { htmlLang: 'en', intl: 'en-US', og: 'en_US', name: 'English' },
} as const satisfies Record<Locale, { htmlLang: string; intl: string; og: string; name: string }>

const vi = {
  'a11y.skip': 'Bỏ qua, đến nội dung chính',
  'nav.label': 'Điều hướng chính',
  'nav.home': 'Trang chủ',
  'nav.blog': 'Blog',
  'nav.about': 'Giới thiệu',
  'theme.toggle': 'Chế độ tối',

  'site.defaultDescription': 'Ghi chép cá nhân về phần mềm và công nghệ.',
  'site.defaultTagline': 'Blog kỹ thuật cá nhân',

  'home.latest': 'Bài viết mới nhất',
  'home.allPosts': 'Xem tất cả bài viết',

  'posts.empty': 'Chưa có bài viết nào.',
  'posts.viOnly': 'Tiếng Việt',

  'blog.title': 'Blog',
  'blog.intro': 'Tất cả bài viết, mới nhất trước.',
  'blog.description': 'Tất cả bài viết trên {site}.',
  'blog.pageTitle': 'Blog – trang {page}',
  'blog.categories': 'Danh mục',

  'pagination.label': 'Phân trang',
  'pagination.prev': 'Trang trước',
  'pagination.next': 'Trang sau',
  'pagination.status': 'Trang {current}/{total}',

  'post.published': 'Đăng ngày',
  'post.categories': 'Danh mục',
  'post.back': 'Tất cả bài viết',
  'post.fallbackNotice': 'Bài viết này hiện chỉ có bản tiếng Việt.',
  'post.navLabel': 'Bài viết khác',
  'post.older': 'Bài trước',
  'post.newer': 'Bài sau',

  'category.title': 'Danh mục: {name}',
  'category.description': 'Các bài viết thuộc danh mục {name} trên {site}.',
  'category.empty': 'Chưa có bài viết nào trong danh mục này.',
  'posts.count.one': '{count} bài viết',
  'posts.count.other': '{count} bài viết',

  'about.title': 'Giới thiệu',
  'about.placeholder': 'Trang giới thiệu đang được cập nhật.',
  'page.fallbackNotice': 'Trang này hiện chỉ có bản tiếng Việt.',

  'footer.rss': 'RSS',
  'footer.social': 'Liên kết',

  'notFound.title': 'Không tìm thấy trang',
  'notFound.body': 'Trang bạn tìm không tồn tại hoặc đã được chuyển đi.',
  'notFound.home': 'Về trang chủ',
  'notFound.blog': 'Xem blog',

  'rss.title': '{site} – Blog',
} as const

export type UiKey = keyof typeof vi

const en: Record<UiKey, string> = {
  'a11y.skip': 'Skip to main content',
  'nav.label': 'Main navigation',
  'nav.home': 'Home',
  'nav.blog': 'Blog',
  'nav.about': 'About',
  'theme.toggle': 'Dark mode',

  'site.defaultDescription': 'Personal notes on software and technology.',
  'site.defaultTagline': 'Personal engineering blog',

  'home.latest': 'Latest posts',
  'home.allPosts': 'View all posts',

  'posts.empty': 'No posts yet.',
  'posts.viOnly': 'In Vietnamese',

  'blog.title': 'Blog',
  'blog.intro': 'All posts, newest first.',
  'blog.description': 'All posts on {site}.',
  'blog.pageTitle': 'Blog – page {page}',
  'blog.categories': 'Categories',

  'pagination.label': 'Pagination',
  'pagination.prev': 'Previous page',
  'pagination.next': 'Next page',
  'pagination.status': 'Page {current} of {total}',

  'post.published': 'Published',
  'post.categories': 'Categories',
  'post.back': 'All posts',
  'post.fallbackNotice': 'This post is only available in Vietnamese.',
  'post.navLabel': 'More posts',
  'post.older': 'Previous post',
  'post.newer': 'Next post',

  'category.title': 'Category: {name}',
  'category.description': 'Posts in the {name} category on {site}.',
  'category.empty': 'There are no posts in this category yet.',
  'posts.count.one': '{count} post',
  'posts.count.other': '{count} posts',

  'about.title': 'About',
  'about.placeholder': 'This page is being written.',
  'page.fallbackNotice': 'This page is only available in Vietnamese.',

  'footer.rss': 'RSS',
  'footer.social': 'Links',

  'notFound.title': 'Page not found',
  'notFound.body': 'The page you are looking for does not exist or has moved.',
  'notFound.home': 'Go to the home page',
  'notFound.blog': 'Browse the blog',

  'rss.title': '{site} – Blog (English)',
}

export const ui: Record<Locale, Record<UiKey, string>> = { vi, en }

export type Translate = (key: UiKey, vars?: Record<string, string | number>) => string

/** t('category.title', { name: 'Kỹ thuật' }) → 'Danh mục: Kỹ thuật' */
export function useTranslations(locale: Locale): Translate {
  return (key, vars) => {
    const template = ui[locale][key] ?? ui.vi[key]
    if (!vars) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in vars ? String(vars[name]) : match,
    )
  }
}

/** '1 post' / '3 posts' / '3 bài viết' */
export function countPosts(locale: Locale, count: number): string {
  const rule = new Intl.PluralRules(localeMeta[locale].intl).select(count) === 'one' ? 'one' : 'other'
  return useTranslations(locale)(`posts.count.${rule}`, { count })
}

export const otherLocale = (locale: Locale): Locale => (locale === 'vi' ? 'en' : 'vi')

const TIME_ZONE = 'Asia/Ho_Chi_Minh'
const dateFormatters = new Map<Locale, Intl.DateTimeFormat>()

/** Ngày dạng dài theo giờ Việt Nam: '25 tháng 9, 2026' / 'September 25, 2026' */
export function formatDate(iso: string, locale: Locale): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  let fmt = dateFormatters.get(locale)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(localeMeta[locale].intl, { dateStyle: 'long', timeZone: TIME_ZONE })
    dateFormatters.set(locale, fmt)
  }
  return fmt.format(date)
}
