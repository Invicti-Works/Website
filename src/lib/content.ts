import { getCollection, type CollectionEntry } from 'astro:content';

/**
 * Drafts are visible under `astro dev` so editors can preview unpublished
 * work, and excluded from production builds.
 */
const includeDrafts = import.meta.env.DEV;

const byOrderThenTitle = <T extends { data: { order: number } }>(
  a: T & { data: { title?: string; name?: string } },
  b: T & { data: { title?: string; name?: string } },
) => a.data.order - b.data.order ||
  (a.data.title ?? a.data.name ?? '').localeCompare(b.data.title ?? b.data.name ?? '');

export async function getProducts(): Promise<CollectionEntry<'products'>[]> {
  const entries = await getCollection('products', ({ data }) => includeDrafts || !data.draft);
  return entries.sort(byOrderThenTitle);
}

export async function getTeam(): Promise<CollectionEntry<'team'>[]> {
  const entries = await getCollection('team', ({ data }) => includeDrafts || !data.draft);
  return entries.sort(byOrderThenTitle);
}

export async function getNews(): Promise<CollectionEntry<'news'>[]> {
  const entries = await getCollection('news', ({ data }) => includeDrafts || !data.draft);
  return entries.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export async function getPages(): Promise<CollectionEntry<'pages'>[]> {
  return getCollection('pages', ({ data }) => includeDrafts || !data.draft);
}

export function formatDate(date: Date, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export const STATUS_LABELS: Record<string, string> = {
  live: 'Live',
  beta: 'In beta',
  'in-development': 'In development',
  concept: 'Concept',
};

export const CATEGORY_LABELS: Record<string, string> = {
  saas: 'SaaS',
  mobile: 'Mobile app',
  platform: 'Platform',
};

export const PLATFORM_LABELS: Record<string, string> = {
  web: 'Web',
  ios: 'iOS',
  android: 'Android',
  api: 'API',
  desktop: 'Desktop',
};
