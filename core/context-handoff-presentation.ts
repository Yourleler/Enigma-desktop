import {createHash} from 'node:crypto';
import type {ContextHandoff} from '../shared/context-handoff.ts';

/** Annotate only the immediately preceding input of a recorded handoff.
 * Matching text inside an ordinary user message is never a display command. */
export function annotateContextHandoffs(messages: any[]): any[] {
  let input: any = null;
  const result = messages.map(message=>({...message}));
  for (const message of result) {
    if (message.role==='user') { input=message; continue; }
    if (message.role==='assistant' || message.role==='toolResult') { input=null; continue; }
    if (message.role!=='custom' || message.customType!=='enigma.handoff' || !input) continue;
    const data=message.data, p=data?.presentation;
    const raw=typeof input.content==='string'?input.content:Array.isArray(input.content)?input.content.filter((part:any)=>part.type==='text').map((part:any)=>part.text).join('\n'):'';
    // Old generated sessions have the same recorded handoff marker but no
    // display fields. Match their complete host envelope, never bare tags.
    if (!p && ['background','continue','alternative'].includes(data?.mode)) {
      const heading=/^New task: ([\s\S]{1,4000}?)\nMode: (background|continue|alternative)\./.exec(raw);
      const source=data?.source;
      if (heading && heading[2]===data.mode && typeof source?.agent==='string'
        && raw.includes(`<source-background>\n# Context handoff\n\nMode: ${data.mode}\nNew objective: ${heading[1]}\n`)
        && raw.includes(`\nSource: ${source.agent} · ${source.session ?? 'unspecified'} · ${source.entry ?? 'unspecified'}\n`)
        && raw.includes('\n</source-background>\n')) {
        input.contextHandoff={goal:heading[1],mode:data.mode,notes:[],repositories:[]}; input=null;
      }
      continue;
    }
    if (p?.version!==1 || p.inputEntry!==input.id || !['background','continue','alternative'].includes(data.mode)
      || typeof p.goal!=='string' || !p.goal.trim() || p.goal.length>4000 || !Array.isArray(p.notes) || p.notes.length>100
      || !Array.isArray(p.repositories) || !p.repositories.every((repo:any)=>typeof repo==='string')) continue;
    if (createHash('sha256').update(raw).digest('hex')!==p.contentHash) continue;
    if (p.notes.some((note:any)=>!note || !['user','assistant','source'].includes(note.role) || typeof note.text!=='string' || typeof note.reference!=='string' || typeof note.kind!=='string')) continue;
    const display:ContextHandoff={goal:p.goal,mode:data.mode,notes:p.notes,repositories:p.repositories};
    input.contextHandoff=display;
    input=null;
  }
  return result;
}
