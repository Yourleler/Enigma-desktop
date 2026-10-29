import {useStore} from '../stores';

const key=(connection:string|null)=>`enigma-conversation-view:${connection||'local'}`;
let stopTracking:(()=>void)|undefined;

/** Bootstrap may run again during renderer refresh. Its temporary blank state
 * is not a user request to forget the last conversation. */
export function pauseConversationViewTracking() {
  stopTracking?.(); stopTracking = undefined;
}

/** Only store an opaque native identity, never native history, paths, tokens
 * or permissions. Resolve it again from this server's accessible session list. */
export async function restoreConversationView(switchSession:(path:string)=>Promise<unknown>){
  const state=useStore.getState();
  if(state.pendingSessionSwitchPath || state.currentSessionPath && !state.pendingNewSession)return;
  let id:string|null=null;try{id=localStorage.getItem(key(state.activeServerConnectionId));}catch{return;}
  if(!id)return;
  const session=state.sessions.find(session=>session.sessionId===id);
  if(!session?.path)return;
  try{await switchSession(session.path);}catch{/* An unavailable old session must not block startup. */}
}
export function trackConversationView(){
  pauseConversationViewTracking();
  const save=(state:ReturnType<typeof useStore.getState>)=>{
    try{
      if(state.currentSessionId&&state.currentSessionPath&&!state.pendingNewSession)localStorage.setItem(key(state.activeServerConnectionId),state.currentSessionId);
      else if(state.pendingNewSession&&!state.pendingSessionSwitchPath)localStorage.removeItem(key(state.activeServerConnectionId));
    }catch{/* Optional view recovery does not own the conversation. */}
  };
  if(useStore.getState().currentSessionId)save(useStore.getState());
  const unsubscribe=useStore.subscribe((state,previous)=>{
    if(state.activeServerConnectionId!==previous.activeServerConnectionId)return;
    if(state.currentSessionId===previous.currentSessionId&&state.pendingNewSession===previous.pendingNewSession&&state.activeServerConnectionId===previous.activeServerConnectionId)return;
    save(state);
  });
  const onHide=()=>save(useStore.getState());window.addEventListener('pagehide',onHide);
  const stop=()=>{unsubscribe();window.removeEventListener('pagehide',onHide);};
  stopTracking=stop;
  return ()=>{stop();if(stopTracking===stop)stopTracking=undefined;};
}
