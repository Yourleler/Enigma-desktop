// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import{useState}from'react';
import{cleanup,render,fireEvent,screen}from'@testing-library/react';
import{afterEach,expect,it,vi}from'vitest';
import{StructuredTextInput}from'../form-fields';
afterEach(cleanup);
it('keeps trailing and blank lines in the edit buffer while emitting the parsed argument array',()=>{
 const parsed=vi.fn();function Form(){const[value,set]=useState<unknown>(['node']);return <StructuredTextInput label="命令" kind="lines" value={value} change={next=>{set(next);parsed(next);}}/>;}
 render(<Form/>);const input=screen.getByLabelText('命令');fireEvent.change(input,{target:{value:'node\n'}});expect(input).toHaveValue('node\n');expect(parsed).toHaveBeenLastCalledWith(['node']);
 fireEvent.change(input,{target:{value:'node\n\n-e\n'}});expect(input).toHaveValue('node\n\n-e\n');expect(parsed).toHaveBeenLastCalledWith(['node','-e']);
});
it('does not rewrite unfinished keys and rejects duplicate keys without silently hiding them',()=>{
 function Form(){const[value,set]=useState<unknown>({});return <StructuredTextInput label="环境" kind="pairs" value={value} change={set}/>;}
 render(<Form/>);const input=screen.getByLabelText('环境') as HTMLTextAreaElement;fireEvent.change(input,{target:{value:'BASE_'}});expect(input).toHaveValue('BASE_');expect(input.checkValidity()).toBe(false);
 fireEvent.change(input,{target:{value:'BASE_URL=https://example.invalid?q=a=b\n'}});expect(input).toHaveValue('BASE_URL=https://example.invalid?q=a=b\n');expect(input.checkValidity()).toBe(true);
 fireEvent.change(input,{target:{value:'PORT=1\nPORT=2'}});expect(input).toHaveValue('PORT=1\nPORT=2');expect(input.validationMessage).toContain('重复');
});
it('replaces its buffer for externally selected records without retaining an old draft',()=>{
 const props={label:'参数',kind:'lines' as const,change:vi.fn()};const {rerender}=render(<StructuredTextInput {...props} value={['old']}/>);rerender(<StructuredTextInput {...props} value={['new','value']}/>);expect(screen.getByLabelText('参数')).toHaveValue('new\nvalue');
});
