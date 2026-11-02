import {useStore} from '../stores';
import {validateModelPolicy} from '../../../../plugins/enigma/model-policy';

const key=(connection:string|null)=>`enigma-conversation-view:${connection||'local'}`;
let stopTracking:(()=>void)|undefined;

/** Bootstrap may run again during renderer refresh. Its temporary blank state
 * is not a user request to forget the last conversation. */
export function pauseConversationViewTracking() {
  stopTracking?.(); stopTracking = undefined;
}

/** Restore a session identity or the active new draft's model choices. Neither
 * form stores history, file paths, credentials or permission settings. */
export async function restoreConversationView(switchSession:(path:string)=>Promise<unknown>){
  const state=useStore.getState();
  if(state.pendingSessionSwitchPath || state.currentSessionPath && !state.pendingNewSession)return;
  let id:string|null=null;try{id=localStorage.getItem(key(state.activeServerConnectionId));}catch{return;}
  if(!id)return;
  if(id.startsWith('{')){
    try{
      const saved=JSON.parse(id);
      if(saved.kind==='draft'&&state.pendingNewSession){
        const policy=saved.modelPolicy===null?null:validateModelPolicy(saved.modelPolicy);
        useStore.setState({pendingNewSessionModelPolicy:policy});
      }
    }catch{/* Leave an unreadable saved view untouched. */}
    return;
  }
  const session=state.sessions.find(session=>session.sessionId===id);
  if(!session?.path)return;
  try{await switchSession(session.path);}catch{/* An unavailable old session must not block startup. */}
}
export function trackConversationView(){
  pauseConversationViewTracking();
  const save=(state:ReturnType<typeof useStore.getState>)=>{
    try{
      if(state.currentSessionId&&state.currentSessionPath&&!state.pendingNewSession)localStorage.setItem(key(state.activeServerConnectionId),state.currentSessionId);
      else if(state.pendingNewSession&&!state.pendingSessionSwitchPath){
        if(state.pendingNewSessionModelPolicy!==undefined)localStorage.setItem(key(state.activeServerConnectionId),JSON.stringify({kind:'draft',modelPolicy:state.pendingNewSessionModelPolicy}));
        else localStorage.removeItem(key(state.activeServerConnectionId));
      }
    }catch{/* Optional view recovery does not own the conversation. */}
  };
  if(useStore.getState().currentSessionId)save(useStore.getState());
  const unsubscribe=useStore.subscribe((state,previous)=>{
    if(state.activeServerConnectionId!==previous.activeServerConnectionId)return;
    if(state.currentSessionId===previous.currentSessionId&&state.pendingNewSession===previous.pendingNewSession&&state.pendingDraftId===previous.pendingDraftId&&state.pendingNewSessionModelPolicy===previous.pendingNewSessionModelPolicy)return;
    save(state);
  });
  const onHide=()=>save(useStore.getState());window.addEventListener('pagehide',onHide);
  const stop=()=>{unsubscribe();window.removeEventListener('pagehide',onHide);};
  stopTracking=stop;
  return ()=>{stop();if(stopTracking===stop)stopTracking=undefined;};
}
