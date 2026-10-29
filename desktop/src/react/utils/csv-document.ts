import Papa from 'papaparse';
export function parseCsvDocument(source:string){
  const bom=source.startsWith('\uFEFF');const parsed=Papa.parse<string[]>(bom?source.slice(1):source,{dynamicTyping:false,skipEmptyLines:false});
  if(parsed.errors.some(error=>error.code==='MissingQuotes'))throw new Error('CSV 引号不完整，请使用源码编辑修复');
  const rows=source?parsed.data:[];const trailing=/[\r\n]$/.test(source);if(trailing&&rows.at(-1)?.every(value=>value===''))rows.pop();
  return {rows,bom,trailing,newline:parsed.meta.linebreak||'\n',delimiter:parsed.meta.delimiter||','};
}
export function updateCsvCells(source:string,edits:Array<{row:number;column:number;value:string}>):string{
  const parsed=parseCsvDocument(source),rows=parsed.rows.map(row=>[...row]);
  for(const edit of edits){if(!Number.isInteger(edit.row)||edit.row<0||!Number.isInteger(edit.column)||edit.column<0)continue;const row=rows[edit.row]||=[];if((row[edit.column]??'')===edit.value)continue;while(row.length<=edit.column)row.push('');row[edit.column]=edit.value;}
  const output=Papa.unparse(rows,{newline:parsed.newline,delimiter:parsed.delimiter});return (parsed.bom?'\uFEFF':'')+output+(parsed.trailing?parsed.newline:'');
}
