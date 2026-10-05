import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve('dist');
const mime = new Map([
  ['.html', 'text/html'], ['.css', 'text/css'], ['.js', 'text/javascript'],
  ['.json', 'application/json'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'], ['.woff', 'font/woff'], ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'], ['.otf', 'font/otf'], ['.mp3', 'audio/mpeg'],
  ['.ogg', 'audio/ogg'], ['.wav', 'audio/wav'], ['.mp4', 'video/mp4'],
]);

async function walk(dir) {
  const entries = await fs.readdir(dir, {withFileTypes: true});
  const out = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(file));
    else if (entry.isFile() && entry.name !== 'android-assets.json' && !entry.name.endsWith('.map')) {
      const bytes = await fs.readFile(file);
      const relative = path.relative(root, file).split(path.sep).join('/');
      out.push({
        path: relative,
        size: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        mime: mime.get(path.extname(file).toLowerCase()) || 'application/octet-stream',
      });
    }
  }
  return out;
}

const files = await walk(root);
const manifest = {
  schemaVersion: 1,
  appId: 'garrison-protocol',
  buildId: process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || process.env.SOURCE_VERSION || 'local',
  generatedAt: new Date().toISOString(),
  fileCount: files.length,
  totalBytes: files.reduce((sum, file) => sum + file.size, 0),
  files,
};
await fs.writeFile(path.join(root, 'android-assets.json'), JSON.stringify(manifest));
console.log(`Android asset manifest: ${files.length} files, ${manifest.totalBytes} bytes`);
