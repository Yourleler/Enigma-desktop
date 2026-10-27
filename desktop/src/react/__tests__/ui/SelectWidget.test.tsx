// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render,screen } from '@testing-library/react';
import { afterEach, describe, expect, it,vi } from 'vitest';
import { SelectWidget, type SelectOption } from '../../ui/SelectWidget';

const options: SelectOption[] = [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
];

function openPopup(container: HTMLElement) {
  const trigger = container.querySelector('button') as HTMLButtonElement;
  act(() => {
    fireEvent.click(trigger);
  });
  return trigger;
}

function getPopup() {
  return document.body.querySelector('[data-select-widget-popup]');
}

describe('SelectWidget scroll-close scope', () => {
  afterEach(() => {
    cleanup();
  });

  it('stays open when an unrelated container (not an ancestor of the trigger) scrolls', () => {
    const { container } = render(
      <SelectWidget options={options} value="a" onChange={() => {}} />,
    );
    openPopup(container);
    expect(getPopup()).not.toBeNull();

    // A container elsewhere in the document — e.g. a background keep-alive chat panel — that
    // does not contain the trigger. Its scroll event must not close this popup.
    const unrelated = document.createElement('div');
    document.body.appendChild(unrelated);

    act(() => {
      unrelated.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(getPopup()).not.toBeNull();
    unrelated.remove();
  });

  it('closes when an ancestor of the trigger scrolls', () => {
    const { container } = render(
      <SelectWidget options={options} value="a" onChange={() => {}} />,
    );
    const trigger = openPopup(container);
    expect(getPopup()).not.toBeNull();

    const ancestor = trigger.parentElement as HTMLElement;
    act(() => {
      ancestor.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(getPopup()).toBeNull();
  });

  it('closes when the document scrolls', () => {
    const { container } = render(
      <SelectWidget options={options} value="a" onChange={() => {}} />,
    );
    openPopup(container);
    expect(getPopup()).not.toBeNull();

    act(() => {
      document.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(getPopup()).toBeNull();
  });
});

it('supports keyboard navigation across enabled options and Escape returns focus without changing the value',()=>{
 const onChange=vi.fn();const {container}=render(<SelectWidget value="a" onChange={onChange} options={[options[0],{value:'disabled',label:'Unavailable',disabled:true},{value:'c',label:'Option C'}]}/>);const trigger=container.querySelector('button')!;fireEvent.keyDown(trigger,{key:'ArrowDown'});const first=screen.getByRole('option',{name:'Option A'});expect(document.activeElement).toBe(first);fireEvent.keyDown(first,{key:'ArrowDown'});const last=screen.getByRole('option',{name:'Option C'});expect(document.activeElement).toBe(last);fireEvent.keyDown(last,{key:'Escape'});expect(getPopup()).toBeNull();expect(document.activeElement).toBe(trigger);expect(onChange).not.toHaveBeenCalled();
});
it('keeps a wide popup inside a narrow viewport instead of positioning it left of the screen',()=>{
 vi.stubGlobal('innerWidth',320);vi.stubGlobal('innerHeight',600);const mock=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){return this.tagName==='BUTTON'?{left:12,right:32,top:500,bottom:520,width:20,height:20} as DOMRect:{left:0,right:280,top:0,bottom:180,width:280,height:180} as DOMRect;});
 try{const {container}=render(<SelectWidget value="a" options={options} onChange={()=>{}} popupMinWidth={280}/>);openPopup(container);const popup=getPopup() as HTMLElement;expect(popup.style.left).toBe('12px');expect(popup.style.maxWidth).toBe('296px');}finally{mock.mockRestore();vi.unstubAllGlobals();}
});
