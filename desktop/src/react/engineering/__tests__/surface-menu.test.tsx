// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {SurfaceMenu,SurfaceModal} from '../SurfaceMenu';
beforeEach(()=>{vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('menu escapes an overflow-hidden parent, supports keyboard navigation, and restores focus on Escape',()=>{
  const {container}=render(<div style={{overflow:'hidden',height:40}}><SurfaceMenu label="更多功能"><button>文档维护</button><button>背景交接</button></SurfaceMenu></div>);
  const trigger=screen.getByRole('button',{name:'更多功能'});fireEvent.click(trigger);
  const menu=screen.getByRole('group',{name:'更多功能'});expect(container.contains(menu)).toBe(false);expect(menu.parentElement).toBe(document.body);
  expect(screen.getByRole('button',{name:'文档维护'})).toHaveFocus();fireEvent.keyDown(document,{key:'ArrowDown'});expect(screen.getByRole('button',{name:'背景交接'})).toHaveFocus();
  fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('group',{name:'更多功能'})).not.toBeInTheDocument();expect(trigger).toHaveFocus();
});
it('choosing an action closes its menu and opening another leaves only one visible',()=>{
  const action=vi.fn();render(<><SurfaceMenu label="更多"><button onClick={action}>审查</button></SurfaceMenu><SurfaceMenu label="外观"><button>深色</button></SurfaceMenu></>);
  fireEvent.click(screen.getByRole('button',{name:'更多'}));fireEvent.click(screen.getByRole('button',{name:'审查'}));expect(action).toHaveBeenCalledOnce();expect(screen.queryByRole('group')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'更多'}));fireEvent.pointerDown(screen.getByRole('button',{name:'外观'}));fireEvent.click(screen.getByRole('button',{name:'外观'}));expect(screen.getAllByRole('group')).toHaveLength(1);expect(within(screen.getByRole('group')).getByRole('button',{name:'深色'})).toBeVisible();
});
it('a modal leaves a filtered sidebar and closes by Escape without activating underlying content',()=>{
  const close=vi.fn();const {container}=render(<div style={{filter:'blur(1px)'}}><SurfaceModal onClose={close}><div className="enigma-modal-backdrop"><section role="dialog" aria-label="模型分工"><button>关闭</button><input aria-label="预算"/></section></div></SurfaceModal></div>);
  expect(container.contains(screen.getByRole('dialog'))).toBe(false);fireEvent.keyDown(document,{key:'Escape'});expect(close).toHaveBeenCalledOnce();
});
it('does not intercept text editing or select navigation keys inside an open menu',()=>{
  render(<SurfaceMenu label="筛选"><input aria-label="关键词"/><select aria-label="范围"><option>全部</option><option>本项目</option></select><button>应用</button></SurfaceMenu>);
  fireEvent.click(screen.getByRole('button',{name:'筛选'}));
  expect(fireEvent.keyDown(screen.getByRole('textbox'),{key:'Home'})).toBe(true);
  screen.getByRole('combobox').focus();
  expect(fireEvent.keyDown(screen.getByRole('combobox'),{key:'ArrowDown'})).toBe(true);
  expect(screen.getByRole('combobox')).toHaveFocus();
});
