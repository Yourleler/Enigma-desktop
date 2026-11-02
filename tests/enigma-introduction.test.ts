import {describe,expect,it} from 'vitest';
import {ENIGMA_CLOSING_LINE,enigmaIntroduction,repairEnigmaIntroductionSnapshot} from '../shared/enigma-introduction.ts';

const chinese=`你是 Enigma。用户问你是谁或要求自我介绍时，使用这句原文：${ENIGMA_CLOSING_LINE} 不主动附加运行平台或开发者介绍。`;
const english=`You are Research Companion. When asked who you are or to introduce yourself, use this exact sentence: ${ENIGMA_CLOSING_LINE} Do not add an unsolicited platform or developer introduction.`;
describe('legacy Enigma introduction snapshot repair',()=>{
  it.each([[chinese,'Enigma',true],[english,'Research Companion',false]] as const)('repairs the exact obsolete host prefix without changing the frozen remainder: %s',(prefix,name,isChinese)=>{
    const remainder='\r\n\r\n# Persona\r\nKeep my identity and abilities.\r\n# Rules\r\nKeep custom project rules.';
    const snapshot={systemPrompt:prefix+remainder,finalSystemPrompt:prefix+remainder+'\nProvider-specific append',appendSystemPrompt:['custom'],skillsResult:{skills:[{name:'existing'}]}};
    const result=repairEnigmaIntroductionSnapshot(snapshot,true)!;
    expect(result.systemPrompt).toBe(enigmaIntroduction(name,isChinese)+remainder);
    expect(result.finalSystemPrompt).toBe(enigmaIntroduction(name,isChinese)+remainder+'\nProvider-specific append');
    expect(result.appendSystemPrompt).toBe(snapshot.appendSystemPrompt);expect(result.skillsResult).toBe(snapshot.skillsResult);
    expect(snapshot.systemPrompt).toBe(prefix+remainder);
    expect(repairEnigmaIntroductionSnapshot(result,true)).toBe(result);
  });
  it('does not rewrite another product, quoted content or user-customized instructions',()=>{
    const old={systemPrompt:chinese};expect(repairEnigmaIntroductionSnapshot(old,false)).toBe(old);
    for(const systemPrompt of ['Custom persona\n'+chinese,ENIGMA_CLOSING_LINE,chinese+' My explicit override.',chinese.replace('使用这句原文','请务必只用这句话')]){
      const snapshot={systemPrompt};expect(repairEnigmaIntroductionSnapshot(snapshot,true)).toBe(snapshot);
    }
  });
});
