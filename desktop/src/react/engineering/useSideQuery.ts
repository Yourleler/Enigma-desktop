import {useCallback,useEffect,useRef,useState} from 'react';
import {engineeringRequest,useEngineering} from './state';

/** One in-flight read per panel. Polls join it; a mutation refresh waits for
 * that read then fetches fresh data, so it cannot silently reuse pre-action state. */
export function useSideQuery<T>(route:string,sessionPath:string,enabled=true){
  const connection=useEngineering(s=>s.connectionId);
  const [data,setData]=useState<T|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const [receivedAt,setReceivedAt]=useState(0);
  const generation=useRef(0),pending=useRef<{controller:AbortController;promise:Promise<void>}|null>(null);
  const load=useCallback(():Promise<void>=>{
    if(!enabled||!sessionPath)return Promise.resolve();
    if(pending.current)return pending.current.promise;
    const version=generation.current,controller=new AbortController();setLoading(true);
    const promise=(async()=>{
      try{const value=await engineeringRequest(route,sessionPath,undefined,controller.signal);if(version===generation.current){setData(value);setError('');setReceivedAt(Date.now());}}
      catch(error){if(!controller.signal.aborted&&version===generation.current)setError(String(error));}
      finally{if(pending.current?.controller===controller)pending.current=null;if(version===generation.current)setLoading(false);}
    })();
    pending.current={controller,promise};return promise;
  },[route,sessionPath,enabled,connection]);
  const refresh=useCallback(async()=>{const version=generation.current;await pending.current?.promise;if(version===generation.current)await load();},[load]);
  useEffect(()=>{
    generation.current++;pending.current?.controller.abort();pending.current=null;setData(null);setError('');setReceivedAt(0);void load();
    const timer=setInterval(()=>{if(!document.hidden)void load();},5000);
    const visible=()=>{if(!document.hidden)void load();};document.addEventListener('visibilitychange',visible);
    return()=>{generation.current++;pending.current?.controller.abort();pending.current=null;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[load]);
  return {data,error,loading,receivedAt,refresh};
}
