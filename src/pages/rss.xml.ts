import type { APIRoute } from 'astro'
import { blogFeed } from '../components/views/rss'

export const GET: APIRoute = (context) => blogFeed('vi', context)
