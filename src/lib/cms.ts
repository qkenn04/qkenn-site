// HỢP ĐỒNG DỮ LIỆU giữa site và Payload CMS.
// Giao diện (src/pages, src/components) CHỈ import từ file này — không gọi fetch CMS ở chỗ khác.
// Tên hàm + kiểu dữ liệu bên dưới là cố định; phần thân hàm là bản tối thiểu, sẽ được hoàn thiện
// (phân trang đầy đủ, phát hiện bản dịch, xử lý lỗi, test).

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

// ---- Bản tối thiểu (sẽ được hoàn thiện) ----

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${CMS_URL}/api${path}`)
  if (!res.ok) throw new Error(`CMS ${res.status} ${path}`)
  return (await res.json()) as T
}

/** Mọi bài đã publish của site qkenn, mới nhất trước */
export async function getPosts(locale: Locale): Promise<Post[]> {
  const q = `?locale=${locale}&depth=1&limit=100&sort=-publishedAt&where[_status][equals]=published&where[site][equals]=qkenn`
  const data = await api<{ docs: any[] }>(`/posts${q}`)
  return data.docs.map((d) => ({ ...d, categories: d.categories ?? [], isFallback: false })) as Post[]
}

export async function getPost(slug: string, locale: Locale): Promise<Post | null> {
  return (await getPosts(locale)).find((p) => p.slug === slug) ?? null
}

export async function getCategories(locale: Locale): Promise<Category[]> {
  const data = await api<{ docs: Category[] }>(`/categories?locale=${locale}&limit=100`)
  return data.docs
}

/** Trang tĩnh quản lý trong CMS (collection `pages`), vd slug 'about'. Chưa có → null */
export async function getPage(slug: string, locale: Locale): Promise<Page | null> {
  try {
    const data = await api<{ docs: any[] }>(
      `/pages?locale=${locale}&depth=1&limit=1&where[slug][equals]=${encodeURIComponent(slug)}&where[_status][equals]=published`,
    )
    return data.docs[0] ? ({ ...data.docs[0], isFallback: false } as Page) : null
  } catch {
    return null
  }
}

export async function getSiteSettings(locale: Locale): Promise<SiteSettings> {
  const s = await api<any>(`/globals/site-settings?locale=${locale}`)
  return { ...s, nav: s.nav ?? [], socials: s.socials ?? [] } as SiteSettings
}
