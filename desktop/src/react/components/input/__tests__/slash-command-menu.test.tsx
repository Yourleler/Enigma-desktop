// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';import {cleanup,fireEvent,render,screen} from '@testing-library/react';import {afterEach,expect,it,vi} from 'vitest';
import {SlashCommandMenu} from '../SlashCommandMenu';import {appIconSvg} from '../../../ui/app-icons';
afterEach(cleanup);
const commands=[{name:'diary',label:'/diary',description:'写今日日记',busyLabel:'正在整理日记',icon:appIconSvg('diary'),type:'builtin' as const,execute:vi.fn()},{name:'compact',label:'/compact',description:'压缩当前上下文并保留任务要求',busyLabel:'正在压缩',icon:appIconSvg('compact'),type:'builtin' as const,execute:vi.fn()}];
it('exposes selection, descriptive labels and keyboard help without turning pointer-down into focus loss',()=>{
 const onSelect=vi.fn(),onHover=vi.fn();render(<SlashCommandMenu commands={commands} selected={1} busy={null} onSelect={onSelect} onHover={onHover}/>);const option=screen.getByRole('option',{name:'/compact 压缩当前上下文并保留任务要求'});expect(option).toHaveAttribute('aria-selected','true');expect(screen.getByRole('listbox')).toHaveAccessibleName('快捷命令');expect(screen.getByText('esc')).toBeVisible();expect(fireEvent.mouseDown(option)).toBe(false);fireEvent.mouseEnter(option);expect(onHover).toHaveBeenCalledWith(1);fireEvent.click(option);expect(onSelect).toHaveBeenCalledWith(commands[1]);
});
it('shows the running command state and prevents duplicate actions',()=>{const onSelect=vi.fn();render(<SlashCommandMenu commands={commands} selected={1} busy="compact" onSelect={onSelect} onHover={()=>{}}/>);expect(screen.getByText('正在压缩')).toBeVisible();for(const option of screen.getAllByRole('option')){expect(option).toBeDisabled();fireEvent.click(option);}expect(onSelect).not.toHaveBeenCalled();});
