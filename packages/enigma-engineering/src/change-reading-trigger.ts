/** Recognize successful Git mutations from argv rather than matching words in
 * paths, commit messages or grep arguments. Unknown options are conservative. */
export function gitReadingKind(argv: unknown): 'staged'|'commit'|null {
  if(!Array.isArray(argv)||argv[0]!=='git')return null;
  for(let i=1;i<argv.length;i++){
    const arg=String(argv[i]);
    if(['-C','-c','--git-dir','--work-tree','--namespace','--exec-path'].includes(arg)){i++;continue;}
    if(arg.startsWith('-'))continue;
    return arg==='add'?'staged':arg==='commit'?'commit':null;
  }
  return null;
}
export function publicationSource(value: any): {kind?:string;url?:string} {
  const record=value?.record||value;
  return {kind:record?.input?.kind||record?.kind,url:record?.input?.url||record?.url};
}
