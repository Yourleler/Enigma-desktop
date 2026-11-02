import {expect,it} from 'vitest';
import {activityTranscript} from '../shared/activity-transcript.ts';

it('includes ordered text and tool evidence without exposing hidden reasoning',()=>{
  const result=activityTranscript([
    {type:'message',message:{role:'assistant',timestamp:1,content:[{type:'thinking',thinking:'private'},{type:'text',text:'Checking'},{type:'toolCall',id:'c',name:'read',arguments:{path:'sample.txt'}}]}},
    {type:'message',message:{role:'toolResult',toolCallId:'c',isError:true,content:[{type:'text',text:'File unavailable'}]}},
  ]);
  expect(result.map(m=>m.role)).toEqual(['assistant','tool','tool']);
  expect(result[2]).toMatchObject({phase:'result',toolName:'read',status:'failed',content:'File unavailable'});
  expect(JSON.stringify(result)).not.toContain('private');
});

it('makes clipped tool output explicit and keeps image placeholders',()=>{
  const result=activityTranscript([{type:'message',message:{role:'toolResult',toolName:'read',content:[{type:'text',text:'x'.repeat(14000)}]}},{type:'message',message:{role:'user',content:[{type:'image',data:'not-to-inline'}]}}]);
  expect(result[0].content).toHaveLength(12000);expect(result[0].truncated).toBe(true);
  expect(result[1].content).toContain('图片附件');expect(JSON.stringify(result)).not.toContain('not-to-inline');
});
