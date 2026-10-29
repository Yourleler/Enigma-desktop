// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from 'vitest';
import {composeTaskRequest} from '../compose-task';
import {useStore} from '../../stores';
import {sessionScopedValue} from '../../stores/session-slice';
import {useEngineering} from '../state';
beforeEach(()=>useStore.setState({currentSessionPath:'/current',activeServerConnectionId:'local',currentSessionId:null,drafts:{},draftDocs:{},addToast:vi.fn()}));
it('prepares an editable request without replacing rich draft content or sending anything',()=>{
 const doc={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Existing note'}]},{type:'paragraph',content:[{type:'skillBadge',attrs:{id:'retained'}}]}]};
 useStore.getState().setDraft('/current','Existing note',doc);
 composeTaskRequest('Check original requirements');
 const state=useStore.getState();expect(sessionScopedValue(state,state.drafts,'/current')).toBe('Existing note\n\nCheck original requirements');
 const next=sessionScopedValue(state,state.draftDocs,'/current');expect(next?.content?.[1]).toEqual(doc.content[1]);
 expect(state.addToast).toHaveBeenCalledWith('已加入输入框，确认后发送','info',2500);
});
it('reveals the composer after preparing a request from a narrow engineering drawer',()=>{
 const original=window.innerWidth;Object.defineProperty(window,'innerWidth',{configurable:true,value:420});
 try{useEngineering.setState({paneOpen:true,sessionPath:'/current',tabs:[],active:'group:timeline'});useStore.setState({jianOpen:true});composeTaskRequest('检查当前路线');expect(useEngineering.getState().paneOpen).toBe(false);expect(useStore.getState().jianOpen).toBe(false);expect(sessionScopedValue(useStore.getState(),useStore.getState().drafts,'/current')).toBe('检查当前路线');}
 finally{Object.defineProperty(window,'innerWidth',{configurable:true,value:original});}
});
it('does not duplicate an unchanged suggested request after repeated clicks',()=>{
 composeTaskRequest('检查当前路线');composeTaskRequest('检查当前路线');
 expect(sessionScopedValue(useStore.getState(),useStore.getState().drafts,'/current')).toBe('检查当前路线');
});
