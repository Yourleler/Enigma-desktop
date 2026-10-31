// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {render,screen,cleanup,fireEvent} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {SettingsRow} from '../components/SettingsRow';
import {SettingsSection} from '../components/SettingsSection';
import {NumberInput} from '../components/NumberInput';
import {Toggle} from '../widgets/Toggle';
afterEach(cleanup);
it('connects visible row labels and hints to nested controls without replacing explicit names',()=>{
 const changed=vi.fn();render(<><SettingsRow label="背景动画" hint="关闭后保留静态背景" control={<div><Toggle on onChange={changed}/></div>}/><SettingsRow label="正文字号" hint="单位为像素" control={<NumberInput value={16} onChange={()=>{}} unit="px"/>}/><SettingsRow label="显示偏好" control={<Toggle ariaLabel="自定义开关" on={false} onChange={()=>{}}/>}/></>);
 expect(screen.getByRole('switch',{name:'背景动画'})).toHaveAccessibleDescription('关闭后保留静态背景');
 fireEvent.click(screen.getByRole('switch',{name:'背景动画'}));expect(changed).toHaveBeenCalledWith(false);
 expect(screen.getByRole('spinbutton',{name:'正文字号'})).toHaveAccessibleDescription('单位为像素');
 expect(screen.getByRole('switch',{name:'自定义开关'})).toBeInTheDocument();
});
it('uses a section label for its main toggle and retains the busy state while loading',()=>{
 render(<SettingsSection title="记忆"><Toggle on={undefined} onChange={()=>{}}/></SettingsSection>);
 expect(screen.getByRole('switch',{name:'记忆'})).toBeDisabled();expect(screen.getByRole('switch',{name:'记忆'})).toHaveAttribute('aria-busy','true');
});
