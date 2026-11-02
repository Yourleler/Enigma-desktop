// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from 'vitest';
import {useStore} from '../../stores';
import {hanaFetch} from '../../hooks/use-hana-fetch';
import {switchSession} from '../../stores/session-actions';
import {openNotificationTarget} from '../../services/notification-navigation';
vi.mock('../../hooks/use-hana-fetch',()=>({hanaFetch:vi.fn()}));
vi.mock('../../stores/session-actions',()=>({switchSession:vi.fn(async()=>{})}));
vi.mock('../../utils/preview-context',()=>({previewConnectionKey:()=>useStore.getState().activeServerConnectionId}));
beforeEach(()=>{vi.clearAllMocks();useStore.setState({activeServerConnectionId:'local',currentSessionPath:'/current.jsonl',currentTab:'chat',activePanel:null,activityFocusTarget:null,activities:[],addToast:vi.fn()});});
it('opens the notified conversation instead of the currently selected conversation',async()=>{
 await openNotificationTarget({connectionKey:'local',sessionPath:'/finished.jsonl'});
 expect(switchSession).toHaveBeenCalledWith('/finished.jsonl');
});
it('does not send a target from another connection to the current server',async()=>{
 await openNotificationTarget({connectionKey:'other',sessionPath:'/finished.jsonl'});
 expect(switchSession).not.toHaveBeenCalled();expect(hanaFetch).not.toHaveBeenCalled();expect(useStore.getState().addToast).toHaveBeenCalled();
});
it('opens the matching background record without promoting it into a conversation',async()=>{
 const activities=[{id:'run-1',agentId:'agent-1',type:'cron',summary:'Finished'}];
 vi.mocked(hanaFetch).mockResolvedValue(new Response(JSON.stringify({activities})));
 await openNotificationTarget({connectionKey:'local',sessionPath:'/activity/old.jsonl',activityId:'run-1',agentId:'agent-1'});
 expect(useStore.getState().activePanel).toBe('activity');expect(useStore.getState().activityFocusTarget).toMatchObject({id:'run-1',agentId:'agent-1'});expect(switchSession).not.toHaveBeenCalled();
});
it('keeps the current task when the notified record no longer exists',async()=>{
 vi.mocked(hanaFetch).mockResolvedValue(new Response(JSON.stringify({activities:[]})));
 await openNotificationTarget({connectionKey:'local',activityId:'missing',agentId:'agent-1'});
 expect(useStore.getState().activePanel).toBeNull();expect(useStore.getState().addToast).toHaveBeenCalled();
});
it('ignores delayed activity results after the user navigates elsewhere',async()=>{
 let finish!:(response:Response)=>void;
 vi.mocked(hanaFetch).mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 const request=openNotificationTarget({connectionKey:'local',activityId:'run-1',agentId:'agent-1'});
 useStore.setState({currentSessionPath:'/another.jsonl'});
 finish(new Response(JSON.stringify({activities:[{id:'run-1',agentId:'agent-1'}]})));await request;
 expect(useStore.getState().activePanel).toBeNull();
});
