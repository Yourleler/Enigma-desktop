/** Conservative fallback for adapters that put queue notices in reasoning text.
 * Only a complete, recognizable transport notice is excluded; ordinary prose
 * and quoted status text remain output. Provider usage always wins at completion.
 */
export class TransportStatusFilter {
  private pending='';
  excluded=0;
  waiting=false;
  push(text:string):string {
    this.pending+=text;
    let output='';
    while(this.pending.includes('\n')){
      const index=this.pending.indexOf('\n'),line=this.pending.slice(0,index+1);this.pending=this.pending.slice(index+1);output+=this.classify(line);
    }
    if(this.pending && (!this.possible(this.pending)||this.pending.length>1000)){
      output+=this.pending;this.pending='';this.waiting=false;
    }
    return output;
  }
  flush():string {const output=this.classify(this.pending);this.pending='';return output;}
  private classify(line:string):string {
    if(this.waiting&&!line.trim())return '';
    if(/^(?:[\w.-]+\s+)?排队中\s*[：:]\s*第\s*\d+\s*位[^\r\n]*模型繁忙[^\r\n]*轮到后自动开始[^\r\n]*$/u.test(line.trim())){
      this.excluded++;this.waiting=true;return '';
    }
    if(line.trim())this.waiting=false;
    return line;
  }
  private possible(text:string):boolean {
    const value=text.trimStart();
    // Hold only a short prefix until a chunk boundary reveals its meaning.
    if(/^[\w.-]{0,24}\s*$/u.test(value))return true;
    const body=value.replace(/^[\w.-]+\s+/u,'');
    if('排队中'.startsWith(body))return true;
    return /^排队中\s*[：:]\s*(?:第\s*\d*\s*(?:位[^\r\n]*)?)?$/u.test(body);
  }
}
