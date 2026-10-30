export type HistorySearchOptions={match?:'smart'|'phrase'|'all';source?:'all'|'user'|'assistant';caseSensitive?:boolean};
export type HistorySearchFilters=HistorySearchOptions&{scope:'all'|'title'|'content';project:string;model:string;after:string;before:string;status:'active'|'archived'|'all';sort:'relevance'|'newest'};
export const defaultHistoryFilters:HistorySearchFilters={scope:'all',source:'all',match:'phrase',caseSensitive:false,project:'',model:'',after:'',before:'',status:'active',sort:'relevance'};
export function normalizedSearchOptions(value:any):HistorySearchOptions{return {match:['phrase','all'].includes(value?.match)?value.match:'smart',source:['user','assistant'].includes(value?.source)?value.source:'all',caseSensitive:value?.caseSensitive===true||value?.caseSensitive==='true'};}
export function historySearchParams(filters:HistorySearchOptions){const params=new URLSearchParams();for(const key of ['match','source','caseSensitive'] as const)if(filters[key]!==undefined)params.set(key,String(filters[key]));return params;}
export function literalSearchTerms(query:string,options:HistorySearchOptions):string[]{return options.match==='all'?[...new Set(query.trim().split(/\s+/).filter(Boolean))]:[query.trim()].filter(Boolean);}
export function literalSearchIndex(text:string,needle:string,caseSensitive=false){return (caseSensitive?text:text.toLocaleLowerCase()).indexOf(caseSensitive?needle:needle.toLocaleLowerCase());}
/** Start near the matching word, so a two-line preview cannot hide it below the fold. */
export function matchCenteredSnippet(text:string,needle:string,caseSensitive=false):string{
 const raw=text.replace(/<\/?(?:work|think|thinking|t)(?:\s[^>]*)?>/gi,' ').replace(/\s+/g,' ').trim();
 const at=literalSearchIndex(raw,needle,caseSensitive);if(at<0)return raw.slice(0,100);
 const before=raw.slice(0,at),sentence=Math.max(before.lastIndexOf('。'),before.lastIndexOf('！'),before.lastIndexOf('？'),before.lastIndexOf('\n'))+1;
 const start=Math.max(sentence,at-8),end=Math.min(raw.length,at+needle.length+85);
 return `${start?'…':''}${raw.slice(start,end)}${end<raw.length?'…':''}`;
}
