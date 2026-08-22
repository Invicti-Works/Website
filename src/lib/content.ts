import { getCollection, type CollectionEntry } from 'astro:content';

/**
 * Drafts are visible under `astro dev` so editors can preview unpublished
 * work, and excluded from production builds.
 */
const includeDrafts = import.meta.env.DEV;

export async function getTeam(): Promise<CollectionEntry<'team'>[]> {
  const entries = await getCollection('team', ({ data }) => includeDrafts || !data.draft);
  return entries.sort(
    (a, b) => a.data.order - b.data.order || a.data.name.localeCompare(b.data.name),
  );
}

export async function getApps(): Promise<CollectionEntry<'apps'>[]> {
  const entries = await getCollection('apps', ({ data }) => includeDrafts || !data.draft);
  return entries.sort(
    (a, b) => a.data.order - b.data.order || a.data.title.localeCompare(b.data.title),
  );
}

export const PLATFORM_LABELS: Record<string, string> = {
  web: 'Web',
  ios: 'iOS',
  android: 'Android',
  api: 'API',
  desktop: 'Desktop',
};
