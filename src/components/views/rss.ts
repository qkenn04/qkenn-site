// Feed RSS dùng chung cho /rss.xml (vi) và /en/rss.xml (en)
import rss from '@astrojs/rss'
import type { APIContext } from 'astro'
import { getPosts, getSiteSettings, type Locale } from '../../lib/cms'
import { routes } from '../../i18n/routes'
import { localeMeta, useTranslations } from '../../i18n/ui'

export async function blogFeed(locale: Locale, context: APIContext): Promise<Response> {
  const [settings, posts] = await Promise.all([getSiteSettings(locale), getPosts(locale)])
  const t = useTranslations(locale)
  const siteName = settings.siteName?.trim() || 'qkenn'

  return rss({
    title: t('rss.title', { site: siteName }),
    description: settings.description?.trim() || settings.tagline?.trim() || t('site.defaultDescription'),
    // <link> của channel = trang chủ đúng ngôn ngữ (en → /en/); link bài là path tuyệt đối nên vẫn đúng
    site: new URL(routes.home(locale), context.site ?? context.url.origin).href,
    items: posts.map((post) => ({
      title: post.title,
      link: routes.post(locale, post.slug),
      pubDate: new Date(post.publishedAt),
      description: post.excerpt ?? undefined,
      categories: post.categories.map((c) => c.title).filter(Boolean),
    })),
    customData: `<language>${localeMeta[locale].intl}</language>`,
  })
}
