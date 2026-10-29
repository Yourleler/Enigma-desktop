// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent,render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { GuidedRecords } from '../GuidedRecords';
import { useEngineering } from '../state';
beforeEach(()=>useEngineering.setState({sessionPath:'',sections:{},snapshot:{state:{idle:true},actions:[]}}));afterEach(cleanup);
it('explains background handoff without exposing the full conversation tree by default',()=>{
 render(<GuidedRecords group="handoff" value={{entries:[{text:'private history'}],packages:[]}} details={<p>原始记录</p>}/>);
 expect(screen.getByText('把背景带到下一个任务')).toBeVisible();
 expect(screen.getByText(/同背景新任务仍可直接使用/)).toBeVisible();
 expect(screen.getByText('原始记录')).not.toBeVisible();
});
it('distinguishes instruction skills from executable recipes and shows meaningful summaries',()=>{
 render(<GuidedRecords group="skills" value={{catalog:{skills:[{id:'s',name:'接口排查',description:'核对接口与消费者',modelInvocation:false,command:'/skill:inspect'}]},recipes:[{id:'r',label:'联合验证',steps:[{id:'verify',kind:'verify'}]}]}} details={null}/>);
 expect(screen.getByText('接口排查')).toBeVisible();expect(screen.getByText('仅手动调用 · /skill:inspect')).toBeVisible();fireEvent.click(screen.getByRole('tab',{name:'配方'}));expect(screen.getByText('联合验证')).toBeVisible();expect(screen.getByText('1 个步骤')).toBeVisible();expect(screen.queryByText('接口排查')).toBeNull();
});
