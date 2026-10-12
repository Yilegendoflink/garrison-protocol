export function applyCustomOperators(source,base,registry,extension){
 source.customTokenSkills=Object.fromEntries(['sktok_wisdel_wward','sktok_wang_1','sktok_wang_2','sktok_wang_3'].map(id=>[id,base.skills[id]]));
 Object.assign(base.entities,extension.entities);Object.assign(base.skills,extension.skills);Object.assign(base.ranges,extension.ranges);
 for(const op of registry.operators){if(!base.entities[op.charId])throw Error('自选干员缺实体 '+op.charId);
  for(const tier of registry.allowedTiers){const template=source.season.charShopChessDatas[`chess_char_${tier}_diy1_a`],id=`chess_custom_${op.key}_${tier}_a`,gold=`chess_custom_${op.key}_${tier}_b`;
   if(!template)throw Error('缺少 DIY 阶级 '+tier);
   source.season.charShopChessDatas[id]={...structuredClone(template),chessId:id,goldenChessId:gold,charId:op.charId,chessType:'NORMAL',defaultSkillIndex:op.defaultSkillIndex,defaultUniEquipId:op.defaultUniEquipId,isHidden:true,custom:true};
   for(const [target,original]of [[id,template.chessId],[gold,template.goldenChessId]])source.season.charChessDataDict[target]={...structuredClone(source.season.charChessDataDict[original]),chessId:target,charId:op.charId,upgradeChessId:target===id?gold:null,bondIds:op.bondIds.slice(),garrisonIds:[]};
   source.season.chessNormalIdLookupDict[gold]=id;
  }
 }
}
