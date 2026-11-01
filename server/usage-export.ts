/** Export only usage metadata, never prompts, responses, credentials or paths. */
export function formatUsageExport(report:any,query:Record<string,string>,format:'json'|'csv'){
 const filters=Object.fromEntries(['since','until','model','source','agent','status','timeZone'].filter(key=>query[key]).map(key=>[key,query[key]]));
 const records=report.records.map(row=>({...row,
  input:row.missingRequests?null:row.input,output:row.missingRequests?null:row.output,total:row.missingRequests?null:row.total,
  cacheRead:row.cacheReported?row.cacheRead:null,cacheWrite:row.cacheReported?row.cacheWrite:null,
  reasoning:row.reasoningReported?row.reasoning:null,
 }));
 const payload={schemaVersion:1,exportedAt:new Date(report.sampledAt).toISOString(),scope:report.scope,filters,
  totals:report.totals,models:report.models,daily:report.daily,sources:report.sources,coverage:report.coverage,records};
 if(format==='json')return JSON.stringify(payload,null,2)+'\n';
 const columns=['requestId','at','timingSource','startedAt','endedAt','durationMs','model','source','operation','status','input','output','cacheRead','cacheWrite','reasoning','total'];
 const cell=(value:unknown)=>{
  let text=value==null?'':String(value);
  // Spreadsheet apps must treat provider/model identifiers as text, not formulas.
  if(typeof value==='string'&&/^[\s]*[=+@-]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
 };
 return '\uFEFF'+[columns.map(cell).join(','),...records.map(row=>columns.map(key=>cell(row[key])).join(','))].join('\r\n')+'\r\n';
}
