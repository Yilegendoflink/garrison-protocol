import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSkillDescription,blackboardIndex,blackboardValue,normalizeKey,plainText} from '../dist/native-skill-text.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';

// 原作描述里的占位键与黑板键存在命名不一致，此前精确匹配会让界面显示「—」。
// 这里覆盖两类不一致与不应被误伤的情况。

test('normalizeKey strips one leading sign and lowercases',()=>{
 assert.equal(normalizeKey('-def'),'def');
 assert.equal(normalizeKey('-DEF'),'def');
 assert.equal(normalizeKey('HP_RECOVERY_PER_SEC'),'hp_recovery_per_sec');
 assert.equal(normalizeKey('demkni_s_3.move_speed'),'demkni_s_3.move_speed');
 assert.equal(normalizeKey('-demkni_s_3.move_speed'),'demkni_s_3.move_speed');
});

test('blackboard lookup tolerates case differences inside UPPERCASE placeholders',()=>{
 const skill={description:'每秒恢复{HP_RECOVERY_PER_SEC}点生命',blackboard:[{key:'hp_recovery_per_sec',value:25}]};
 assert.equal(renderSkillDescription(skill),'每秒恢复25点生命');
});

test('plus-sign stats use the blackboard value directly',()=>{
 // 角峰「抗寒体质」：黑板 max_hp/def/magic_resistance = 0.3/0.1/0.6，游戏内显示 +30%/+10%/+60%
 const skill={description:'生命上限+{max_hp:0%}，防御力+{def:0%}，法术抗性+{magic_resistance:0%}',blackboard:[{key:'max_hp',value:0.3},{key:'def',value:0.1},{key:'magic_resistance',value:0.6}]};
 assert.equal(renderSkillDescription(skill),'生命上限+30%，防御力+10%，法术抗性+60%');
});

test('minus placeholders describe a reduction: blackboard holds the remainder',()=>{
 // 初雪「自然震慑」：黑板 def=0.6 / magic_resistance=0.77，游戏内显示 -40% / -23%
 // 文本里的前导「-」是字面符号，数值取 1-黑板值
 const skill={description:'防御力{-def:0%}，法术抗性{-magic_resistance:0%}',blackboard:[{key:'def',value:0.6},{key:'magic_resistance',value:0.77}]};
 assert.equal(renderSkillDescription(skill),'防御力-40%，法术抗性-23%');
});

test('signed placeholders without a percent format print the raw value',()=>{
 // 初雪「传音回响」：黑板 attack_speed=-8，文本 -{attack_speed} → -8
 const skill={description:'攻击速度-{attack_speed}',blackboard:[{key:'attack_speed',value:-8}]};
 assert.equal(renderSkillDescription(skill),'攻击速度--8');
});

test('signed placeholders handle a blackboard value that is already negative',()=>{
 // 塞雷娅「钙质化」：黑板 demkni_s_3.move_speed=-0.6（已是降低量），文本「移动速度-{-...:0%}」
 const skill={description:'移动速度-{-demkni_s_3.move_speed:0%}',blackboard:[{key:'demkni_s_3.move_speed',value:-0.6}]};
 assert.equal(renderSkillDescription(skill),'移动速度--60%');
 // 取绝对值而非补数：若误用补数会得到 -160%
 assert.equal(/160/.test(renderSkillDescription(skill)),false);
});

test('exact keys keep working and valueStr wins over value',()=>{
 const skill={description:'攻击力+{atk:0%}',blackboard:[{key:'atk',value:0.5,valueStr:'自定义'}]};
 assert.equal(renderSkillDescription(skill),'攻击力+自定义');
});

test('a genuinely absent key still renders as a dash',()=>{
 const skill={description:'攻击力+{not_in_blackboard:0%}',blackboard:[{key:'atk',value:0.5}]};
 assert.equal(renderSkillDescription(skill),'攻击力+—');
});

test('non-percent placeholders print raw values and markup is stripped',()=>{
 const skill={description:'在{duration}秒内<@ba.vup>强化</>',blackboard:[{key:'duration',value:8}]};
 assert.equal(renderSkillDescription(skill),'在8秒内强化');
});

test('literal newline escapes become real line breaks',()=>{
 assert.equal(plainText('第一行\\n第二行'),'第一行\n第二行');
});

test('no placeholder is left as a dash for the 17 previously broken skills',()=>{
 // 回归：这些技能曾因键命名不一致在界面上显示「—」
 const broken=[['char_199_yak',0],['char_2015_dusk',1],['char_4151_tinman',0],['char_102_texas',0]];
 const seen=new Set();
 for(const [charId] of broken){
  for(const row of Object.values(NATIVE_DATA.profiles)){
   if(row?.charId!==charId||!row.skillChoices)continue;
   for(const st of row.skillChoices){
    if(seen.has(st.skillId))continue;
    seen.add(st.skillId);
    const text=renderSkillDescription(st.skill);
    assert.equal(/[—]/.test(text),false,`${row.name} ${st.skill.name} 仍出现「—」：${text}`);
    assert.equal(/\{[^}]+\}/.test(text),false,`${row.name} ${st.skill.name} 仍有未渲染占位符`);
   }
   break;
  }
 }
});
