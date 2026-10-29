// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ProjectPanel,dependencyFields} from '../Project';
import {showAction,useEngineering} from '../state';
import {useStore} from '../../stores';
vi.mock('../state',async load=>({...await load<typeof import('../state')>(),showAction:vi.fn()}));
const repo={id:'client',role:'消费端',root:'/fixture/client',access:'write',dependsOn:['api']};
beforeEach(()=>{vi.clearAllMocks();useStore.setState({sessionPermissionMode:'ask'});useEngineering.setState({snapshot:{state:{idle:true},actions:['repo-add','check-add','verify','repo-dependencies'].map(id=>({id,fields:[{name:'repo',label:'仓库'},{name:'dependsOn',label:'上游'}]}))}});});afterEach(cleanup);
it('keeps setup actions visible after registration and explains actual check commands',()=>{
 render(<ProjectPanel value={{repositories:[repo],checks:[{id:'contract',repo:'client',argv:['node','check.js'],joint:true}],blockers:[]}} evidence={()=>null}/>);
 expect(screen.getByRole('button',{name:'加入仓库'})).toBeVisible();expect(screen.getByText('跨仓联合检查',{exact:false})).toBeVisible();expect(screen.getByText('node check.js')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'调整上游依赖'}));expect(showAction).toHaveBeenCalledWith(expect.objectContaining({id:'repo-dependencies',fields:expect.arrayContaining([expect.objectContaining({name:'dependsOn',value:['api']})])}));
});
it('offers only other repositories as upstream dependencies and blocks project writes in read-only mode',()=>{
 expect(dependencyFields([{name:'dependsOn',label:'上游'}],{repos:[repo,{id:'api',role:'接口'}]},'client')[0].items).toEqual([{value:'api',label:'api · 接口'}]);
 useStore.setState({sessionPermissionMode:'read_only'});render(<ProjectPanel value={{repositories:[repo],checks:[]}} evidence={()=>null}/>);
 expect(screen.getByRole('button',{name:'加入仓库'})).toBeDisabled();expect(screen.getByRole('button',{name:'调整上游依赖'})).toBeDisabled();expect(screen.getByRole('button',{name:'浏览代码'})).toBeEnabled();
});
