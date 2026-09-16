import test from 'node:test';
import assert from 'node:assert/strict';
import {apply325Display,egg325Active,format325,homo,rewrite325Text} from '../dist/native-325.js';

test('homo matches 325calculator for 0, 1, and 5',()=>{
 assert.equal(homo(0),'3+2-5');
 assert.equal(homo(1),'3*2-5');
 assert.equal(homo(5),'(3-2)*5');
});

test('format325 caches and handles negatives',()=>{
 assert.equal(format325(0),'3+2-5');
 assert.equal(format325(0),homo(0));
 assert.equal(format325(-1),homo(-1));
 assert.match(format325(1.5),/\*\*/);
});

test('rewrite325Text converts HUD-style numbers once',()=>{
 assert.equal(rewrite325Text('生命 5 / 30'),`生命 ${homo(5)} / ${homo(30)}`);
 assert.equal(rewrite325Text('伤害 1,234'),`伤害 ${homo(1234)}`);
 assert.equal(rewrite325Text('层数+2'),`层数+${homo(2)}`);
});

test('apply325Display skips input values and does not rewrite twice',()=>{
 const text=value=>({nodeType:3,nodeValue:value});
 const el=(tagName,children)=>({nodeType:1,tagName,childNodes:children});
 const inputChild=text('20');
 const spanChild=text('层数+2');
 const root=el('DIV',[el('INPUT',[inputChild]),el('SPAN',[spanChild])]);
 apply325Display(root);
 assert.equal(inputChild.nodeValue,'20');
 assert.equal(spanChild.nodeValue,`层数+${homo(2)}`);
 const after=spanChild.nodeValue;
 apply325Display(root);
 assert.equal(spanChild.nodeValue,after);
});

test('egg325Active is display-only after entering a run',()=>{
 assert.equal(egg325Active({view:'lobby',mode:'mode_egg_325'}),false);
 assert.equal(egg325Active({view:'editor',draft:{egg325:true}}),false);
 assert.equal(egg325Active({view:'game',sandbox:{},game:{s:{egg325:true}}}),false);
 assert.equal(egg325Active({view:'briefing',draft:{egg325:true}}),true);
 assert.equal(egg325Active({view:'game',game:{s:{egg325:true}}}),true);
});
