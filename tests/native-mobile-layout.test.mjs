import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// 手机端盟约面板：横屏 UI 的左侧竖列必须在卡片被 flex 压扁之前就变成整体上下滚动。
// 布局行为本身由真浏览器复测（`node scripts/regression-browser.mjs mobile-bonds`），这里固化 CSS 口径，
// 防止后续「清理样式」时把 flex:0 0 auto 删掉、又变回文字挤在一起。
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css=await readFile(path.join(root,'dist/native.css'),'utf8');

function block(source,selector){
 const open=source.indexOf(selector+'{');
 assert.ok(open>=0,`native.css 里必须有 ${selector} 段`);
 const from=source.indexOf('{',open);
 let depth=0;
 for(let i=from;i<source.length;i++){
  if(source[i]==='{')depth++;
  else if(source[i]==='}'){depth--;if(depth===0)return source.slice(from+1,i);}
 }
 throw Error(`未闭合的 ${selector} 段`);
}
function rule(source,selector){
 const open=source.indexOf(selector+'{');
 if(open<0)return null;
 const from=source.indexOf('{',open),to=source.indexOf('}',from);
 return source.slice(from+1,to);
}

test('手机横屏的盟约面板保持卡片自然高度并整体上下滚动',()=>{
 const landscape=block(css,'html.native-landscape-ui');
 const panel=rule(landscape,'.native-bonds');
 assert.ok(panel,'native-landscape-ui 段里必须有 .native-bonds');
 assert.match(panel,/flex-direction:column/);
 assert.match(panel,/overflow-y:auto/);
 assert.match(panel,/top:68px/);
 assert.match(panel,/bottom:6px/,'面板必须有确定高度，否则 flex 子项永远压扁而不是滚动');
 const button=rule(landscape,'.native-bonds button');
 assert.ok(button,'native-landscape-ui 段里必须有 .native-bonds button');
 assert.match(button,/flex:0 0 auto/,'盟约卡片必须禁止 flex 压扁：压扁后名字和层数会挤在同一格里');
});

test('手机窄屏竖排的盟约横向条仍然只横滚不压扁',()=>{
 const narrow=block(css,'@media(max-width:600px)');
 const panel=rule(narrow,'.native-bonds');
 assert.ok(panel,'窄屏段里必须有 .native-bonds');
 assert.match(panel,/flex-direction:row/);
 assert.match(panel,/max-height:95px/);
 const button=rule(narrow,'.native-bonds button');
 assert.ok(button);
 assert.match(button,/min-width:80px/,'横向条靠 min-width 保底宽度，避免卡片被压扁');
});
