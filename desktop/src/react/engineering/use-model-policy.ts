import {useEffect,useState} from 'react';
import {useStore} from '../stores';
import {hanaFetch} from '../hooks/use-hana-fetch';
import {useEngineering} from './state';
import type {ModelPolicy} from '../../../../plugins/enigma/model-policy';

export function useComposerModelPolicy() {
  const path=useStore(s=>s.currentSessionPath)||'',draftId=useStore(s=>s.pendingDraftId);
  const connection=useStore(s=>s.activeServerConnectionId),pendingPolicy=useStore(s=>s.pendingNewSessionModelPolicy);
  const snapshotPolicy=useEngineering(s=>s.sessionPath===path&&(s.connectionId||'local')===(connection||'local')?s.snapshot?.modelPolicy:undefined) as ModelPolicy|undefined;
  const [error,setError]=useState('');
  useEffect(()=>{
    setError('');if(path||!draftId||pendingPolicy!==undefined)return;
    let active=true;const controller=new AbortController();
    void hanaFetch('/api/enigma/model-policy-default',{signal:controller.signal}).then(r=>r.json()).then(data=>{
      const latest=useStore.getState();
      if(active&&latest.pendingDraftId===draftId&&latest.activeServerConnectionId===connection&&latest.pendingNewSessionModelPolicy===undefined)
        useStore.setState({pendingNewSessionModelPolicy:data.policy||null});
    }).catch(reason=>{if(active&&!controller.signal.aborted)setError(`模型分工未加载：${reason instanceof Error?reason.message:String(reason)}`);});
    return()=>{active=false;controller.abort();};
  },[path,draftId,connection,pendingPolicy]);
  return {policy:path?snapshotPolicy:pendingPolicy,error};
}
