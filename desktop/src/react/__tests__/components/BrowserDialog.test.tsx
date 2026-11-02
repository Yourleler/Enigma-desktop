// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {BrowserDialog} from '../../components/preview/BrowserDialog';
afterEach(cleanup);
it('focuses the prompt and sends only the explicit response',async()=>{
  const reply=vi.fn(async()=>{});render(<BrowserDialog dialog={{dialogId:'new',type:'prompt',message:'备注',defaultPrompt:'默认',url:'https://example.invalid'}} onRespond={reply}/>);
  const input=screen.getByRole('textbox',{name:'网页弹窗输入'});expect(document.activeElement).toBe(input);
  fireEvent.change(input,{target:{value:'中文'}});fireEvent.click(screen.getByRole('button',{name:'确定'}));
  await waitFor(()=>expect(reply).toHaveBeenCalledWith(true,'中文'));
});
it('handles Escape as cancel and keeps a failed response available for retry',async()=>{
  const reply=vi.fn(async()=>{throw new Error('弹窗已变化');});render(<BrowserDialog dialog={{dialogId:'new',type:'confirm',message:'确认？'}} onRespond={reply}/>);
  fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});await screen.findByRole('alert');
  expect(reply).toHaveBeenCalledWith(false,undefined);expect(screen.getByRole('button',{name:'取消'}).hasAttribute('disabled')).toBe(false);
});
it('does not submit during IME composition or dispatch duplicate Enter responses',()=>{
 const reply=vi.fn(()=>new Promise(()=>{}));render(<BrowserDialog dialog={{dialogId:'ime',type:'prompt',message:'输入'}} onRespond={reply}/>);
 const input=screen.getByRole('textbox',{name:'网页弹窗输入'});
 fireEvent.keyDown(input,{key:'Enter',isComposing:true});expect(reply).not.toHaveBeenCalled();
 fireEvent.keyDown(input,{key:'Enter'});fireEvent.keyDown(input,{key:'Enter'});expect(reply).toHaveBeenCalledTimes(1);
});
