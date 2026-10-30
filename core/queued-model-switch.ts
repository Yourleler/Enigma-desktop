import type {ModelSelection} from '../shared/model-selection.ts';
type SwitchOptions={initial?:ModelSelection|null;resolve:(provider:string,id:string)=>Promise<any>;apply:(model:any)=>Promise<unknown>;save:(selection:ModelSelection)=>Promise<void>;idle:()=>boolean};

/** Only the request boundary applies a queued selection. Newer choices supersede
 * older validation; no active provider stream is interrupted or replayed. */
export class QueuedModelSwitch {
  selection:ModelSelection|null;
  private revision:number;
  private applying:Promise<void>|null=null;
  private committing:ModelSelection|null=null;
  private options:SwitchOptions;
  constructor(options:SwitchOptions){
    this.options=options;
    this.selection=options.initial||null;this.revision=this.selection?.revision||0;
  }
  private async publish(selection:ModelSelection){await this.options.save({...selection});}
  async request(provider:string,id:string){
    const selection:ModelSelection={provider,id,revision:++this.revision,state:'pending'};
    this.selection=selection;await this.publish(selection);
    try{await this.options.resolve(provider,id);}catch(error){if(this.selection===selection){selection.state='failed';selection.error=error instanceof Error?error.message:'模型暂不可用';await this.publish(selection);}return this.result();}
    if(this.selection===selection&&this.options.idle())await this.atBoundary();
    return this.result();
  }
  async cancel(){
    if(this.selection?.state!=='pending')return this.result();
    if(this.committing===this.selection)throw new Error('模型已进入切换阶段，无法再取消；完成后可重新选择');
    this.selection={...this.selection,revision:++this.revision,state:'cancelled'};
    await this.publish(this.selection);return this.result();
  }
  result(){return {selection:this.selection?{...this.selection}:null,effectiveAt:this.selection?.state==='applied'?'now':'next-request'};}
  async atBoundary(){
    if(this.applying)return this.applying;
    const task=(async()=>{
      while(this.selection?.state==='pending'){
        const selection=this.selection;
        try{
          const model=await this.options.resolve(selection.provider,selection.id);
          if(this.selection!==selection)continue;
          this.committing=selection;
          try { await this.options.apply(model); } finally { this.committing=null; }
          if(this.selection!==selection)continue;
          selection.state='applied';
        }catch(error){
          if(this.selection!==selection)continue;
          selection.state='failed';selection.error=error instanceof Error?error.message:'模型切换未能完成';
        }
        await this.publish(selection);
      }
    })();
    this.applying=task;try{await task;}finally{if(this.applying===task)this.applying=null;}
  }
}
