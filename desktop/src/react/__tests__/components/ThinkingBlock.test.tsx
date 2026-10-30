// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';import {afterEach,expect,it} from 'vitest';import {ThinkingBlock} from '../../components/chat/ThinkingBlock';
afterEach(cleanup);
it('does not present an empty completed reasoning block as expandable content',async()=>{
 const view=render(<ThinkingBlock content="   " sealed/>);expect(view.container.querySelector('details')).toBeNull();
 view.rerender(<ThinkingBlock content="" sealed={false}/>);expect(view.container.querySelector('summary')).toBeNull();expect(view.container.textContent).not.toBe('');
 view.rerender(<ThinkingBlock content="A short reasoning summary" sealed/>);expect(view.container.querySelector('details')).toBeTruthy();fireEvent.click(view.container.querySelector('summary')!);await waitFor(()=>expect(screen.getByText('A short reasoning summary')).toBeVisible());
});
