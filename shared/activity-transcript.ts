import {projectToolResultOutcome} from './tool-outcome.ts';

export interface ActivityTranscriptMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  phase?: 'call' | 'result';
  status?: string;
  timestamp?: number;
  truncated?: boolean;
}

/** Render explicit text and tool records; never manufacture hidden reasoning. */
export function activityTranscript(rows: any[]): ActivityTranscriptMessage[] {
  const messages: ActivityTranscriptMessage[]=[];
  const calls=new Map<string,string>();
  const clip=(text:string)=>({content:text.slice(0,12000),...(text.length>12000?{truncated:true}:{})});
  for(const row of rows){
    if(row?.type!=='message'||!row.message)continue;
    const message=row.message;
    const timestamp=typeof message.timestamp==='number'?message.timestamp:Date.parse(row.timestamp);
    const time=Number.isFinite(timestamp)?{timestamp}:{};
    if(message.role==='user'||message.role==='assistant'){
      const blocks=Array.isArray(message.content)?message.content:[{type:'text',text:message.content}];
      for(const block of blocks){
        if(block.type==='text'&&typeof block.text==='string'&&block.text)messages.push({role:message.role,content:block.text,...time});
        else if(block.type==='toolCall'){
          calls.set(block.id,block.name);
          messages.push({role:'tool',phase:'call',toolName:block.name,...clip(JSON.stringify(block.arguments??{},null,2)),...time});
        }else if(block.type==='image')messages.push({role:message.role,content:'[图片附件：可在对话中查看]',...time});
      }
    }else if(message.role==='toolResult'){
      const text=typeof message.content==='string'?message.content:(message.content||[]).map((block:any)=>block.type==='text'?block.text:block.type==='image'?'[图片结果：可在对话中查看]':'').filter(Boolean).join('\n');
      messages.push({role:'tool',phase:'result',toolName:message.toolName||calls.get(message.toolCallId)||'工具',status:projectToolResultOutcome(message).status,...clip(text),...time});
    }
  }
  return messages;
}
