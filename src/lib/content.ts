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
