// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {MoodBlock} from '../../components/chat/MoodBlock';
import {useStore} from '../../stores';
afterEach(cleanup);
it('exposes the work explanation as a named disclosure button with an associated panel',()=>{
 render(<MoodBlock yuan="enigma" text="来源已核对"/>);
 const button=screen.getByRole('button',{name:/工作说明/});expect(button).toHaveAttribute('aria-expanded','false');
 fireEvent.click(button);expect(button).toHaveAttribute('aria-expanded','true');expect(document.getElementById(button.getAttribute('aria-controls')!)).toHaveTextContent('来源已核对');
 fireEvent.click(button);expect(button).toHaveAttribute('aria-expanded','false');
});
it('reveals the matched explanation, respects manual collapse, and reveals a repeated locate request',()=>{
 const path='/search/explanation';useStore.setState({currentSessionPath:path,chatFindBySession:{},pendingMessageLocate:null});
 render(<MoodBlock yuan="enigma" text="继续美化已有页面" sessionPath={path} messageId="7"/>);
 const button=screen.getByRole('button',{name:/工作说明/});expect(button).toHaveAttribute('aria-expanded','false');
 act(()=>useStore.getState().requestMessageLocate({sessionPath:path,messageIndex:7,term:'美化'}));
 expect(button).toHaveAttribute('aria-expanded','true');expect(screen.getByText('继续美化已有页面')).toBeVisible();
 fireEvent.click(button);expect(button).toHaveAttribute('aria-expanded','false');
 act(()=>useStore.setState({connected:true}));expect(button).toHaveAttribute('aria-expanded','false');
 act(()=>useStore.getState().requestMessageLocate({sessionPath:path,messageIndex:7,term:'美化'}));expect(button).toHaveAttribute('aria-expanded','true');
});
it('does not open unrelated explanations or a copy belonging to another conversation',()=>{
 const path='/search/source';useStore.setState({currentSessionPath:path,chatFindBySession:{},pendingMessageLocate:{sessionPath:path,messageIndex:7,term:'美化'}});
 const {rerender}=render(<MoodBlock yuan="enigma" text="读取源码" sessionPath={path} messageId="7"/>);
 expect(screen.getByRole('button',{name:/工作说明/})).toHaveAttribute('aria-expanded','false');
 rerender(<MoodBlock yuan="enigma" text="美化" sessionPath="/another" messageId="7"/>);
 expect(screen.getByRole('button',{name:/工作说明/})).toHaveAttribute('aria-expanded','false');
});
