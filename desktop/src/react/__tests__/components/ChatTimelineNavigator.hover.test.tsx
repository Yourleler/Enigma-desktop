// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatTimelineNavigator } from '../../components/chat/ChatTimelineNavigator';
import { ConversationRail } from '../../components/chat/ConversationRail';
import type { TimelineAnchor } from '../../components/chat/timeline-anchors';
import { buildTimelineAnchors } from '../../components/chat/timeline-anchors';

const anchors: TimelineAnchor[] = ['检查多仓库接口契约与消费方', '修复超时并补充验证说明'].map((text, i) => ({ messageId: `u${i}`, timestamp: null, label: text.slice(0, 10), preview: text, role: 'user', markerWidthEm: 1 }));
function renderNavigator(active = true) {
  const panel = document.createElement('div');
  panel.getBoundingClientRect = () => new DOMRect(0, 0, 640, 500);
  Object.defineProperties(panel, { clientHeight: { value: 500 }, scrollHeight: { value: 1400 }, scrollTop: { value: 0, writable: true } });
  panel.scrollTo = vi.fn();
  const messages = anchors.map((a, i) => {
    const node = document.createElement('div');
    node.getBoundingClientRect = () => new DOMRect(0, 120 + i * 700, 400, 80);
    return [a.messageId, node] as const;
  });
  const before = vi.fn();
  render(<ChatTimelineNavigator anchors={anchors} active={active} railVisible={false} scrollRef={{ current: panel }} contentRef={{ current: panel }} messageElementsRef={{ current: new Map(messages) }} onBeforeJump={before} />);
  return { panel, before, messages };
}
describe('Conversation navigation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('shows the rail without requiring a hidden hover zone and previews full excerpts', () => {
    renderNavigator();
    expect(screen.getByRole('navigation', { name: '对话快速跳转' })).toBeVisible();
    fireEvent.mouseEnter(screen.getByRole('button', { name: /^第 1 轮/ }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(anchors[0].preview!);
  });
  it('cancels sticky follow, respects reduced motion and highlights the destination', () => {
    const { panel, before, messages } = renderNavigator();
    fireEvent.click(screen.getByRole('button', { name: /^第 2 轮/ }));
    expect(before).toHaveBeenCalledOnce();
    expect(panel.scrollTo).toHaveBeenCalledWith({ top: 804, behavior: 'auto' });
    expect(messages[1][1].className).toContain('locateFlash');
  });
  it('does not measure or render inactive sessions', () => {
    const observe = vi.fn(); vi.stubGlobal('ResizeObserver', class { observe = observe; disconnect() {} });
    renderNavigator(false);
    expect(observe).not.toHaveBeenCalled();
    expect(screen.queryByRole('navigation')).toBeNull();
  });
  it('shows the final turn at the bottom even when its prompt cannot reach the viewport top', () => {
    const { panel } = renderNavigator();
    panel.scrollTop = 900;
    fireEvent.scroll(panel);
    act(() => vi.advanceTimersByTime(20));
    expect(screen.getByRole('button', { name: /^第 2 轮/ })).toHaveAttribute('aria-current', 'step');
  });
  it('filters all loaded turns, jumps, and returns keyboard focus to the directory trigger', () => {
    const onJump = vi.fn();
    render(<ConversationRail anchors={anchors} activeId="u0" onJump={onJump} />);
    fireEvent.click(screen.getByRole('button', { name: '打开对话目录' }));
    const search = screen.getByRole('textbox', { name: '筛选对话目录' });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: '超时' } });
    expect(fireEvent.keyDown(search, { key: 'Enter' })).toBe(false);
    expect(onJump).toHaveBeenCalledWith(anchors[1],'超时');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: '打开对话目录' })).toHaveFocus();
  });
  it('explains history limits and exposes loading older messages and full-text search', () => {
    const load = vi.fn(), find = vi.fn();
    render(<ConversationRail anchors={anchors} activeId="u0" onJump={vi.fn()} hasMore onLoadMore={load} onFind={find} />);
    fireEvent.click(screen.getByRole('button', { name: '打开对话目录' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('仅显示已加载的提问');
    fireEvent.click(screen.getByRole('button', { name: '加载更早的对话' })); expect(load).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /全文查找/ })); expect(find).toHaveBeenCalledOnce();
  });
  it('allows moving into a preview and dismissing with Escape', () => {
    renderNavigator();
    fireEvent.mouseEnter(screen.getByRole('button', { name: /^第 1 轮/ }));
    fireEvent.mouseLeave(screen.getByRole('button', { name: /^第 1 轮/ }));
    fireEvent.mouseEnter(screen.getByRole('tooltip'));
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole('tooltip')).toBeVisible();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('keeps every loaded turn reachable in the scrollable rail', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ ...anchors[0], messageId: `m${i}` }));
    render(<ConversationRail anchors={many} activeId="m247" onJump={vi.fn()}/>);
    expect(screen.getAllByRole('button',{name:/^第 \d+ 轮：/})).toHaveLength(500);
    expect(screen.getByRole('button',{name:/^第 248 轮：/})).toHaveAttribute('aria-current','step');
  });
  it('previews time, the input and the visible assistant response', () => {
    render(<ConversationRail anchors={[{...anchors[0],timestamp:Date.now(),replyPreview:'已完成检查'}]} activeId="u0" onJump={vi.fn()}/>);
    fireEvent.mouseEnter(screen.getByRole('button',{name:/^第 1 轮/}));
    expect(screen.getByRole('tooltip')).toHaveTextContent('正在阅读');
    expect(screen.getByRole('tooltip')).toHaveTextContent('已完成检查');
    expect(screen.getByRole('tooltip').textContent).toMatch(/\d{2}:\d{2}/);
  });
  it('updates an open preview when the corresponding reply changes',()=>{
    const view=render(<ConversationRail anchors={[{...anchors[0],replyPreview:'Earlier reply'},anchors[1]]} activeId="u0" onJump={vi.fn()}/>);
    fireEvent.mouseEnter(screen.getByRole('button',{name:/^第 1 轮/}));
    view.rerender(<ConversationRail anchors={[{...anchors[0],replyPreview:'Updated reply'},anchors[1]]} activeId="u0" onJump={vi.fn()}/>);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Updated reply');expect(screen.getByRole('tooltip')).not.toHaveTextContent('Earlier reply');
  });
  it('closes a preview when its anchor is removed by a history change',()=>{
    const view=render(<ConversationRail anchors={anchors} activeId="u0" onJump={vi.fn()}/>);
    fireEvent.mouseEnter(screen.getByRole('button',{name:/^第 1 轮/}));
    view.rerender(<ConversationRail anchors={[anchors[1]]} activeId="u1" onJump={vi.fn()}/>);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('searches the entire loaded input and shows the matching text beyond its preview limit',()=>{
    const long=buildTimelineAnchors([{type:'message',data:{id:'long',role:'user',text:'前面的说明。'.repeat(200)+'末尾关键字紫苑203需要保留。'}}]);
    render(<ConversationRail anchors={long} activeId="long" onJump={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:'打开对话目录'}));
    fireEvent.change(screen.getByRole('textbox',{name:'筛选对话目录'}),{target:{value:'紫苑203'}});
    expect(screen.getByRole('dialog')).toHaveTextContent('紫苑203');expect(screen.getByText('紫苑203').tagName).toBe('MARK');
  });

  it('recovers visible reply text from older rendered messages without showing thinking', () => {
    const result=buildTimelineAnchors([
      {type:'message',data:{id:'u',role:'user',text:'input'}},
      {type:'message',data:{id:'a',role:'assistant',blocks:[{type:'thinking',content:'hidden',sealed:true},{type:'text',html:'<p>Visible <strong>answer</strong></p>'}]}},
    ]);
    expect(result[0].replyPreview).toBe('Visible answer');
  });
});
