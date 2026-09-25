// Tiện ích SEO dùng chung cho các view.

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Tiêu đề SEO nhập trên CMS (plugin-seo `meta.title`) hay đã kèm tên site, vd "Bài viết | qkenn".
 * BaseLayout tự thêm " | <tên site>" → bỏ đuôi tên site (sau | – — -) để không bị lặp.
 * Trả chuỗi đã trim; rỗng/null → '' (view tự dùng tiêu đề mặc định).
 */
export function stripSiteSuffix(title: string | null | undefined, siteName: string | null | undefined): string {
  const value = title?.trim() ?? ''
  if (!value) return ''
  const names = [siteName?.trim(), 'qkenn'].filter((name): name is string => !!name).map(escapeRegExp)
  const suffix = new RegExp(`\\s*[|–—-]\\s*(?:${names.join('|')})\\s*$`, 'i')
  return value.replace(suffix, '').trim()
}
