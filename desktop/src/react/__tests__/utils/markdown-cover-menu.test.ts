// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { openMarkdownCoverMenu } from '../../utils/markdown-cover-menu';

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

it('keeps a menu inside the viewport, supports keyboard actions and restores focus', () => {
  const anchor = document.createElement('button');
  document.body.append(anchor); anchor.focus();
  const run = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({width:200,height:120} as DOMRect);
  const close = openMarkdownCoverMenu(anchor, {x:innerWidth,y:innerHeight}, [
    {label:'Save',run:vi.fn()}, {label:'Remove',run,danger:true},
  ]);
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  expect(parseFloat(menu.style.left) + 200).toBeLessThanOrEqual(innerWidth - 12);
  expect(parseFloat(menu.style.top) + 120).toBeLessThanOrEqual(innerHeight - 12);
  menu.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  expect(document.activeElement?.textContent).toBe('Remove');
  (document.activeElement as HTMLButtonElement).click();
  expect(run).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(anchor);
  close();
});

it('Escape dismisses without executing an action', () => {
  const anchor = document.createElement('button'); document.body.append(anchor);
  const run=vi.fn();
  const close=openMarkdownCoverMenu(anchor,{x:20,y:20},[{label:'Remove',run}]);
  document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(run).not.toHaveBeenCalled(); close();
});
