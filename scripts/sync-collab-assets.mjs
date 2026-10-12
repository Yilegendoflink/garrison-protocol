// 联动干员头像同步：从 PRTS 取「File:头像_<名>.png」，按 sha1 校验后写入 dist/assets/prts/<charId>.png，
// 并登记进 dist/assets/prts/manifest.json（与 sync-mode-assets.mjs 同一字段口径）。
// 这四名干员不在本期「卫戍协议：盟约 下半」的图集里，所以头像单独补；每条都带 PRTS 的 url／sourcePage／sha1，可复核。
// 用法：node scripts/sync-collab-assets.mjs
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const root = 'dist/assets/prts';
const registry = JSON.parse(await fs.readFile(process.argv.includes('--custom')?'data/modes/alliance-lower/custom-operators.json':'data/modes/alliance-lower/collab-operators.json', 'utf8'));
const manifestPath = root + '/manifest.json';
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const request = url => fetch(url, { signal: AbortSignal.timeout(45000) });

const added = [], skipped = [], failed = [];
for (const op of registry.operators) {
  const title = 'File:头像_' + op.name + '.png';
  const api = 'https://prts.wiki/api.php?action=query&format=json&prop=imageinfo&iiprop=url|sha1|size|mime&titles=' + encodeURIComponent(title);
  let info;
  try {
    const page = Object.values((await (await request(api)).json()).query.pages)[0];
    info = page?.imageinfo?.[0];
    if (!info || info.mime !== 'image/png') throw Error('PRTS 没有该头像或不是 PNG');
    const file = op.charId + '.png';
    const target = root + '/' + file;
    let bytes = await fs.readFile(target).catch(() => null);
    if (!bytes || crypto.createHash('sha1').update(bytes).digest('hex') !== info.sha1) {
      bytes = Buffer.from(await (await fetch(info.url)).arrayBuffer());
      if(crypto.createHash('sha1').update(bytes).digest('hex')!==info.sha1)bytes=Buffer.from(await (await fetch(info.url+'?garrison-source='+info.sha1)).arrayBuffer());
      if (crypto.createHash('sha1').update(bytes).digest('hex') !== info.sha1) throw Error('sha1 与 PRTS 不一致 '+JSON.stringify({url:info.url,expected:info.sha1,actual:crypto.createHash('sha1').update(bytes).digest('hex'),bytes:bytes.length}));
      await fs.writeFile(target, bytes);
      added.push(file);
    } else skipped.push(file);
    manifest.assets[op.charId] = {
      id: op.charId,
      title,
      kind: 'operator',
      file: 'assets/prts/' + file,
      url: info.url,
      sourcePage: info.descriptionurl,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      sha1: info.sha1,
      width: info.width,
      height: info.height
    };
  } catch (error) {
    failed.push({ charId: op.charId, name: op.name, error: error.message });
  }
}
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ registered: registry.operators.length, downloaded: added, reused: skipped, failed }, null, 2));
if (failed.length) process.exitCode = 1;
