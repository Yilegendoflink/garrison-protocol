// 原表富文本渲染：`<@ba.vup>`/`<$ba.stun>`/`</>` 这类样式标签要去掉，
// `<铜灯盘>`/`<替身>`/`<寻呼模块>` 这类**内容**标签里的文字必须留下（含 `<在场<@…>6</>名…>` 这种嵌套）。
// 展示路径统一走 protocol.richText：native-play 的 plain、native-skill-text 的 plainText、
// native-wave-editor 的敌人描述、build-native 烘进 enemyIndex 的 desc。
import test from 'node:test';import assert from 'node:assert/strict';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {richText,garrisonText} from '../dist/protocol.js';
import {plainText,renderSkillDescription} from '../dist/native-skill-text.js';

test('richText：样式标签丢掉，内容标签保留文字', () => {
 assert.equal(richText('自身<@ba.vup>周围4格</>的干员'), '自身周围4格的干员');
 assert.equal(richText('死亡后生成1个<铜灯盘>'), '死亡后生成1个铜灯盘');
 assert.equal(richText('每2个回合获得1个特殊法术<教鞭>'), '每2个回合获得1个特殊法术教鞭');
 assert.equal(richText('优先刷新出1名<炎>干员'), '优先刷新出1名炎干员');
 assert.equal(richText('<$ba.stun>晕眩</>敌人'), '晕眩敌人');
 assert.equal(richText('两行\\n换行'), '两行\n换行');
 // 嵌套（原表真实写法）：外层是内容、内层是样式
 assert.equal(richText('<在场<@autochess.dgreen>6</>名不同【炎】干员>'), '在场6名不同【炎】干员');
 // 未闭合的尖括号原样留着，不要吞掉后面的正文
 assert.equal(richText('攻击力+10% <'), '攻击力+10% <');
});

test('技能/天赋描述保留 <替身> 这类引用名', () => {
 const row = Object.entries(NATIVE_DATA.profiles).find(([, p]) => (p.activeTalents || []).some(t => /<替身>/.test(t.description || '')));
 assert.ok(row, '应有一条带 <替身> 的天赋');
 const talent = row[1].activeTalents.find(t => /<替身>/.test(t.description));
 const text = plainText(talent.description);
 assert.match(text, /替身/);
 assert.equal(/[<>]/.test(text), false, '不应残留尖括号');
 assert.ok(renderSkillDescription({description: talent.description, blackboard: talent.blackboard}).includes('替身'));
});

test('敌人图鉴的描述保留 <盐坨子炮> 这类引用名', () => {
 const entry = (NATIVE_DATA.enemyIndex || []).find(e => e.id === 'enemy_10043_sailor');
 assert.ok(entry, 'enemyIndex 应有盐坨子炮');
 assert.match(entry.desc, /盐坨子炮/);
 assert.equal(/[<>]/.test(entry.desc), false);
});

test('全量展示文本：不残留尖括号，内容标签一个都不丢', () => {
 const d = NATIVE_DATA, texts = [];
 const push = (src, text) => { if (typeof text === 'string' && text) texts.push([src, text]); };
 for (const [id, p] of Object.entries(d.profiles)) { push('skill:' + id, p.skill?.description); for (const t of p.activeTalents || []) push('talent:' + id, t.description); }
 for (const [id, g] of Object.entries(d.season.garrisonDataDict)) push('garrison:' + id, g.garrisonDesc || g.description);
 for (const [id, b] of Object.entries(d.season.bondInfoDict || {})) push('bond:' + id, b.desc);
 for (const [id, list] of Object.entries(d.season.effectBuffInfoDataDict || {})) for (const x of list || []) push('bondEffect:' + id, x.effectDesc || x.description);
 for (const [id, t] of Object.entries(d.season.trapChessDataDict || {})) push('item:' + id, t.itemDesc || t.description || t.desc);
 for (const [id, x] of Object.entries(d.season.effectInfoDataDict || {})) push('effect:' + id, x.effectDesc || x.description);
 for (const [id, e] of Object.entries(d.enemies)) { push('enemyDesc:' + id, e.description); for (const a of e.ability || []) push('enemyAbility:' + id, a.text); }
 for (const e of d.enemyIndex || []) push('enemyIndex:' + e.id, e.desc);
 assert.ok(texts.length > 2000, '样本量应有 2000 条以上，实际 ' + texts.length);
 let tokens = 0;
 for (const [src, raw] of texts) {
  const out = richText(raw);
  assert.equal(/[<>]/.test(out), false, `${src} 残留尖括号：${out.slice(0, 120)}`);
  const content = new Set([...raw.matchAll(/<([^<>]*)>/g)].map(m => m[1]).filter(t => t && !/^[@$/]/.test(t)));
  for (const token of content) { assert.ok(out.includes(token), `${src} 丢了内容标签 <${token}>`); tokens++; }
 }
 assert.ok(tokens > 200, '内容标签样本应有 200 个以上，实际 ' + tokens);
});

test('卫戍文本：时机标签变成前缀，其余内容标签照常保留', () => {
 const rule = NATIVE_DATA.season.garrisonDataDict.garrison_25_a;
 assert.match(garrisonText(rule), /^【获得时】/);
 assert.equal(/[<>]/.test(garrisonText(rule)), false);
});

test('构建产物里的展示文本也保留内容标签（策略／敌人／盟约／装备／干员技能）', async () => {
 const fs = await import('node:fs');
 // 策略：data/modes/alliance-lower/catalog.json 与 dist/protocol-data.js 都由 build-protocol 烘焙
 const catalog = JSON.parse(fs.readFileSync('data/modes/alliance-lower/catalog.json', 'utf8'));
 const orchid = catalog.bands.find(b => b.bandId === 'band_orchid');
 assert.match(orchid.description, /寻呼模块/, '策略描述要保留「寻呼模块」这类内容标签里的字');
 assert.equal(/[<>]/.test(orchid.description), false);
 const noTag = catalog.bands.filter(b => /[<>]/.test(String(b.description || '')));
 assert.deepEqual(noTag.map(b => b.bandId), [], '策略描述不应残留尖括号');
 const protocol = await import('../dist/protocol-data.js');
 const band = protocol.PROTOCOL_DATA.bands.find(b => b.id === 'band_orchid') || protocol.PROTOCOL_DATA.bands.find(b => b.description?.includes('猎头顾问'));
 assert.match(band.description, /寻呼模块/);
 assert.equal(/[<>]/.test(band.description), false);
 // 干员技能（dist/catalog.js 由 build-catalog 烘焙）
 const legacy = await import('../dist/catalog.js');
 const dirty = legacy.CATALOG.flatMap(o => (o.skills || []).map(s => [o.id, s.description || ''])).filter(([, d]) => /[<>]/.test(d));
 assert.deepEqual(dirty.slice(0, 3), [], 'CATALOG 技能描述不应残留尖括号');
});
