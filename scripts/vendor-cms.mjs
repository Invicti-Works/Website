// Copies the Sveltia CMS bundle out of node_modules and into public/admin/ so
// the editor is served from our own domain instead of a third-party CDN.
// Benefits: the version is pinned by package-lock.json, the admin keeps working
// if the CDN is down, and the editor page makes no external request.
// Runs automatically via the `predev` / `prebuild` npm scripts.
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

// The package's `exports` map only exposes the ESM entry point, so resolve that
// and take its sibling. `sveltia-cms.js` is the classic-script build, which is
// what a plain `<script src=...>` tag in public/admin/index.html needs.
const distDir = dirname(require.resolve('@sveltia/cms'));
const source = join(distDir, 'sveltia-cms.js');

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const destination = join(projectRoot, 'public', 'admin', 'sveltia-cms.js');

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);

console.log(`[vendor-cms] copied ${source} -> ${destination}`);
