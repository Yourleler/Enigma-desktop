import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SidebarBrowserHost, clampDockBounds } = require('../desktop/src/shared/sidebar-browser-host.cjs');

function fixture() {
  const win = {isDestroyed: () => false, isVisible: () => true, isMinimized: () => false,
    getContentSize: () => [1000, 700], webContents: {getZoomFactor: () => 1},
    contentView: {addChildView: vi.fn(), removeChildView: vi.fn()}};
  const notify = vi.fn(), detachOtherHost = vi.fn();
  const host = new SidebarBrowserHost({getWindow: () => win, notify, detachOtherHost});
  const view = () => ({setBounds: vi.fn(), setVisible: vi.fn(), webContents: {close: vi.fn(), capturePage: vi.fn()}});
  const first = view(), second = view();
  const bounds = {x: 600, y: 100, width: 350, height: 580};
  return {host, win, notify, detachOtherHost, first, second, bounds};
}

describe('native browser sidebar ownership', () => {
  it('bounds the browser to the visible content area and respects renderer zoom', () => {
    expect(clampDockBounds({x: 300, y: 20, width: 800, height: 800}, [1000, 700], 1.2)).toEqual({x: 360, y: 44, width: 640, height: 656});
    expect(clampDockBounds({x: NaN, y: 0, width: 500, height: 500}, [1000, 700])).toBeNull();
    expect(clampDockBounds({x: 1200, y: 50, width: 500, height: 500}, [1000, 700])).toBeNull();
  });
  it('keeps a newly mounted view hidden until its owner supplies valid geometry', () => {
    const {host, first, bounds, detachOtherHost} = fixture();
    host.bind({surfaceId: 'one', sessionPath: 'alpha', tabId: 'a', view: first});
    expect(first.setVisible).toHaveBeenLastCalledWith(false);
    expect(detachOtherHost).toHaveBeenCalledWith(first);
    host.layout({surfaceId: 'one', sequence: 1, bounds, visible: true});
    expect(first.setVisible).toHaveBeenLastCalledWith(true);
    expect(first.setBounds).toHaveBeenLastCalledWith(bounds);
  });
  it('rejects stale layouts and releases without closing the page or its form', () => {
    const {host, first, second, bounds} = fixture();
    host.bind({surfaceId: 'one', sessionPath: 'alpha', tabId: 'a', view: first});
    host.layout({surfaceId: 'one', sequence: 2, bounds, visible: true});
    expect(host.layout({surfaceId: 'one', sequence: 1, bounds, visible: false})).toBe(false);
    host.bind({surfaceId: 'two', sessionPath: 'beta', tabId: 'b', view: second});
    expect(first.setVisible).toHaveBeenLastCalledWith(false);
    expect(host.release('one')).toBeNull();
    expect(host.layout({surfaceId: 'one', sequence: 3, bounds, visible: true})).toBe(false);
    expect(host.owns('two')).toBe(true);
    host.release('two');
    expect(second.webContents.close).not.toHaveBeenCalled();
    expect(second.setVisible).toHaveBeenLastCalledWith(false);
  });
  it('keeps an overlay-hidden state when the model switches to another tab', () => {
    const {host, first, second, bounds} = fixture();
    host.bind({surfaceId: 'one', sessionPath: 'alpha', tabId: 'a', view: first});
    host.layout({surfaceId: 'one', sequence: 1, bounds, visible: false});
    expect(host.switchView('beta', 'b', second)).toBe(false);
    expect(host.switchView('alpha', 'b', second)).toBe(true);
    expect(second.setVisible).toHaveBeenLastCalledWith(false);
    host.layout({surfaceId: 'one', sequence: 2, bounds, visible: true});
    expect(second.setVisible).toHaveBeenLastCalledWith(true);
  });
  it('discards a captured placeholder when ownership has changed', async () => {
    const {host, first, second, notify} = fixture();
    let finish: (value: unknown) => void;
    first.webContents.capturePage.mockReturnValue(new Promise(resolve => {finish = resolve;}));
    host.bind({surfaceId: 'one', sessionPath: 'alpha', tabId: 'a', view: first});
    const capture = host.capturePlaceholder();
    host.bind({surfaceId: 'two', sessionPath: 'beta', tabId: 'b', view: second});
    finish!({resize: () => ({toJPEG: () => Buffer.from('old-page')})});
    await capture;
    expect(notify).not.toHaveBeenCalled();
  });
  it('hides on minimization and can recover after the last page is closed', () => {
    const {host, win, first, second, bounds} = fixture();
    host.bind({surfaceId: 'one', sessionPath: 'alpha', tabId: 'a', view: first});
    host.layout({surfaceId: 'one', sequence: 1, bounds, visible: true});
    win.isMinimized = () => true; host.refresh();
    expect(first.setVisible).toHaveBeenLastCalledWith(false);
    host.forget(first); expect(host.owns('one')).toBe(true);
    win.isMinimized = () => false;
    host.switchView('alpha', 'b', second);
    expect(second.setVisible).toHaveBeenLastCalledWith(true);
  });
});
