import {useStore} from '../../stores';
import {sessionScopedValue,type SessionLocatorState} from '../../stores/session-slice';
import type {ChatFindSlice} from '../../stores/chat-find-slice';
import {literalSearchIndex,literalSearchTerms} from '../../../../../shared/history-search';

/** Return the existing intent object so unrelated streaming updates do not
 * reopen a disclosure the reader has closed by hand. */
export function searchRevealIntent(state:ChatFindSlice&SessionLocatorState,sessionPath:string|undefined,messageIds:readonly string[],text?:string){
  if(!sessionPath||state.currentSessionPath!==sessionPath)return null;
  const find=sessionScopedValue(state,state.chatFindBySession,sessionPath);
  const pending=state.pendingMessageLocate;
  const intent=pending?.sessionPath===sessionPath&&messageIds.includes(String(pending.messageIndex))
    ?pending:find?.open&&messageIds.includes(String(find.matches[find.activePos]?.index))?find:null;
  if(!intent)return null;
  if(text===undefined)return intent;
  const query='term' in intent?intent.term: intent.query;
  if(!query.trim())return null;
  const terms=[...literalSearchTerms(query,find?.options||{}),...(find?.options?.match==='smart'?find.tokens:[])];
  return terms.some(term=>term&&literalSearchIndex(text,term,find?.options?.caseSensitive)>=0)?intent:null;
}

export function useSearchReveal(sessionPath:string|undefined,messageIds:readonly string[],text?:string){
  return useStore(state=>searchRevealIntent(state,sessionPath,messageIds,text));
}
