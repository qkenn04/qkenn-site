// Tiện ích ảnh từ CMS: URL tuyệt đối, chọn kích thước, srcset.
import { CMS_URL, type ImageSize, type Media } from '../lib/cms'

/** URL ảnh từ CMS có thể là tương đối (/api/media/...) → luôn trả URL tuyệt đối */
export function mediaUrl(url: string): string {
  try {
    return new URL(url, `${CMS_URL}/`).href
  } catch {
    return url
  }
}

const isUsable = (size: ImageSize | null | undefined): size is ImageSize =>
  !!size && !!size.url && size.width > 0 && size.height > 0

function original(media: Media): ImageSize | null {
  const size = { url: media.url, width: media.width, height: media.height }
  return isUsable(size) ? size : null
}

export type ImageVariant = 'card' | 'hero'

/** Ảnh chính cho từng vị trí; không có kích thước nào → null (không render ảnh) */
export function pickImage(media: Media | null | undefined, variant: ImageVariant): ImageSize | null {
  if (!media) return null
  const { card, hero } = media.sizes ?? {}
  const order = variant === 'hero' ? [hero, card] : [card, hero]
  return order.find(isUsable) ?? original(media)
}

/**
 * srcset từ các kích thước CMS có CÙNG tỉ lệ khung với ảnh chính
 * (thumbnail 4:3, og 1.91:1 bị loại khi ảnh chính là 16:9 — trộn tỉ lệ sẽ làm méo/cắt sai).
 */
export function buildSrcset(media: Media, primary: ImageSize): string | undefined {
  const ratio = primary.width / primary.height
  const s = media.sizes ?? {}
  const candidates = [s.thumbnail, s.card, s.hero, s.og, original(media)]
    .filter(isUsable)
    .filter((c) => Math.abs(c.width / c.height - ratio) / ratio < 0.01)
  const byWidth = new Map<number, ImageSize>()
  for (const c of candidates) if (!byWidth.has(c.width)) byWidth.set(c.width, c)
  const list = [...byWidth.values()].sort((a, b) => a.width - b.width)
  if (list.length < 2) return undefined
  return list.map((c) => `${mediaUrl(c.url)} ${c.width}w`).join(', ')
}

/** Ảnh chia sẻ mạng xã hội: kích thước og → hero → không có */
export function pickOgImage(media: Media | null | undefined): (ImageSize & { alt: string }) | null {
  if (!media) return null
  const size = [media.sizes?.og, media.sizes?.hero].find(isUsable)
  return size ? { ...size, url: mediaUrl(size.url), alt: media.alt ?? '' } : null
}
