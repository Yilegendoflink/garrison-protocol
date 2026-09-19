// 盟约面板「当前动态数值」：原表用 descParamBaseList / descParamPerStackList 声明哪些数值受层数影响，
// 面板必须**逐项**给出当前值（用户 2026-09-19：叙拉古的 buff 持续时间、以及其他盟约同类数值都曾漏注）。
import test from 'node:test';import assert from 'node:assert/strict';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {bondScaledParams, bondCurrentPreviewHtml} from '../dist/protocol.js';

const data = NATIVE_DATA, bonds = data.season.bondInfoDict;

test('叙拉古面板给出受层数影响的持续时间（含公式）', () => {
 const params = bondScaledParams(data, 'siracusaShip', 35);
 const byKey = Object.fromEntries(params.map(p => [p.key, p]));
 assert.equal(byKey.base_attack_speed.text, '+53', '25 + 0.8×35');
 assert.equal(byKey.base_duration.text, '46 秒', '32 + 0.4×35');
 assert.equal(byKey.base_damage.text, '6750', '5000 + 50×35');
 assert.equal(byKey.base_duration.formula, '32 + 0.4 × 35层');
 const html = bondCurrentPreviewHtml(data, 'siracusaShip', 35);
 assert.match(html, /攻速与隐匿状态的持续时间/);
 assert.match(html, /46 秒/);
 assert.match(html, /32 \+ 0\.4 × 35层/);
});

test('其他盟约的受层数影响数值同样标注（谢拉格寒风时长、萨尔贡增益时长等）', () => {
 const kj = Object.fromEntries(bondScaledParams(data, 'kjeragShip', 40).map(p => [p.key, p]));
 assert.equal(kj['bond_eff_kjerag[storm].base_time'].text, '24 秒', '20 + 0.1×40');
 assert.equal(kj.base_ex_damage_scale.text, '提升至 175%', '1.35 + 0.01×40');
 const sag = bondScaledParams(data, 'sargonShip', 20)[0];
 assert.equal(sag.text, '9.4 秒', '5 + 0.22×20');
 assert.match(sag.label, /持续时间/);
 const vic = bondScaledParams(data, 'victoriaShip', 60)[0];
 assert.equal(vic.text, '提升至 173%', '1.25 + 0.008×60');
});

test('门禁：原表声明受层数影响的每一项都有当前值，一条都不能漏', () => {
 let checked = 0;
 for (const [id, info] of Object.entries(bonds)) {
  const base = info.descParamBaseList || [], per = info.descParamPerStackList || [];
  const params = bondScaledParams(data, id, 30);
  if (!base.length) { assert.equal(params.length, 0, id + ' 没声明参数就不该有数值行'); continue; }
  assert.equal(params.length, base.length, `${id} 声明了 ${base.length} 项，只渲染了 ${params.length} 项`);
  // 逐项校验数值 = base + per × 层数
  const values = {};
  for (const row of (data.season.effectBuffInfoDataDict[info.effectId] || []).flatMap(e => e.blackboard || [])) if (row.key !== 'key' && values[row.key] === undefined) values[row.key] = Number(row.valueStr ?? row.value);
  for (const [i, param] of params.entries()) {
   const expected = values[base[i]] + (per[i] != null ? (Number(values[per[i]]) || 0) : 0) * 30;
   const shown = Number(String(param.text).replace(/[^\d.-]/g, ''));
   const scale = /%/.test(param.text) ? 100 : 1;
   assert.ok(Math.abs(shown - expected * scale) < 1e-6, `${id}.${base[i]} 显示 ${param.text}，期望 ${expected * scale}`);
   assert.ok(param.label && param.label !== base[i], `${id}.${base[i]} 应有可读标签`);
   checked++;
  }
  const html = bondCurrentPreviewHtml(data, id, 30);
  assert.equal((html.match(/<li>/g) || []).length >= base.length, true, id + ' 面板应包含全部数值行');
 }
 assert.ok(checked >= 20, '受层数影响的参数总量应在 20 项以上，实际 ' + checked);
});

test('没有层数参数的盟约不显示动态数值区', () => {
 assert.equal(bondCurrentPreviewHtml(data, 'soloShip', 12), '');
});
