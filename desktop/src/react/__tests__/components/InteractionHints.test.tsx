// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InteractionHints } from '../../ui/InteractionHints';
import { Tooltip } from '../../ui/Tooltip';

describe('Interaction hints', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  const advance = () => act(() => vi.advanceTimersByTime(400));
  it('upgrades legacy titles without duplicate native hints and restores attributes on dismiss', () => {
    render(<><InteractionHints/><button title="新建对话" aria-describedby="existing">＋</button></>);
    const button = screen.getByRole('button'); fireEvent.pointerOver(button); advance();
    expect(screen.getByRole('tooltip')).toHaveTextContent('新建对话');
    expect(button).not.toHaveAttribute('title'); expect(button.getAttribute('aria-describedby')).toContain('existing');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull(); expect(button).toHaveAttribute('title', '新建对话'); expect(button).toHaveAttribute('aria-describedby', 'existing');
  });
  it('explains disabled actions on hover and supports immediate keyboard focus', () => {
    render(<><InteractionHints/><button disabled data-tooltip="请先选择有效来源">整理记忆</button><button aria-label="关闭内容面板">×</button></>);
    fireEvent.pointerOver(screen.getByText('整理记忆')); advance(); expect(screen.getByRole('tooltip')).toHaveTextContent('请先选择有效来源');
    fireEvent.focusIn(screen.getByRole('button', { name: '关闭内容面板' })); act(() => vi.advanceTimersByTime(0)); expect(screen.getByRole('tooltip')).toHaveTextContent('关闭内容面板');
  });
  it('preserves a hint across child boundaries and while inspecting the hint', () => {
    render(<><InteractionHints/><button title="设置"><span>图标</span></button></>);
    const button = screen.getByRole('button'); fireEvent.pointerOver(button); advance();
    fireEvent.pointerOver(screen.getByText('图标')); expect(screen.getByRole('tooltip')).toBeVisible();
    fireEvent.pointerOut(button, { relatedTarget: screen.getByRole('tooltip') }); fireEvent.pointerOver(screen.getByRole('tooltip'));
    advance(); expect(screen.getByRole('tooltip')).toBeVisible();
    fireEvent.pointerDown(document); expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('does not duplicate readable menu labels but retains explicit explanations',()=>{
    render(<><InteractionHints/><div data-menu-surface=""><button>中等 平衡推理</button><button data-tooltip="当前任务正在运行，暂不可切换">不可用</button></div></>);
    fireEvent.focusIn(screen.getByRole('button',{name:'中等 平衡推理'}));advance();expect(screen.queryByRole('tooltip')).toBeNull();fireEvent.pointerOver(screen.getByRole('button',{name:'不可用'}));advance();expect(screen.getByRole('tooltip')).toHaveTextContent('当前任务正在运行');
  });
  it('leaves explicit Tooltip components in charge', () => {
    render(<><InteractionHints/><Tooltip content="上下文用量"><button title="不重复提示">模型</button></Tooltip></>);
    fireEvent.pointerOver(screen.getByText('模型')); advance(); expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('keeps the complete name in the hint even for very long paths', () => {
    const name = '/workspace/' + 'nested-component/'.repeat(30) + 'contract.test.ts';
    render(<><InteractionHints/><button>{name}</button></>);
    fireEvent.pointerOver(screen.getByRole('button')); advance();
    expect(screen.getByRole('tooltip').textContent).toBe(name);
  });
  it('does not open a focus hint from a mouse-driven menu, but supports keyboard navigation', () => {
    render(<><InteractionHints/><button data-tooltip="查看工程操作">菜单</button></>);
    const button = screen.getByRole('button');
    fireEvent.pointerDown(button); fireEvent.focusIn(button); advance();
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.keyDown(document, { key: 'Tab' }); fireEvent.focusIn(button); advance();
    expect(screen.getByRole('tooltip')).toHaveTextContent('查看工程操作');
  });
  it('keeps embedded document titles and does not cover their content with a delegated hint',()=>{
    render(<><InteractionHints/><iframe title="Word 文档"/></>);const frame=screen.getByTitle('Word 文档');fireEvent.pointerOver(frame);advance();fireEvent.focusIn(frame);advance();expect(frame).toHaveAttribute('title','Word 文档');expect(screen.queryByRole('tooltip')).toBeNull();
  });

});
