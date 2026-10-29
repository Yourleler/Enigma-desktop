// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {MoodBlock} from '../../components/chat/MoodBlock';
afterEach(cleanup);
it('exposes the work explanation as a named disclosure button with an associated panel',()=>{
 render(<MoodBlock yuan="enigma" text="来源已核对"/>);
 const button=screen.getByRole('button',{name:/工作说明/});expect(button).toHaveAttribute('aria-expanded','false');
 fireEvent.click(button);expect(button).toHaveAttribute('aria-expanded','true');expect(document.getElementById(button.getAttribute('aria-controls')!)).toHaveTextContent('来源已核对');
 fireEvent.click(button);expect(button).toHaveAttribute('aria-expanded','false');
});
