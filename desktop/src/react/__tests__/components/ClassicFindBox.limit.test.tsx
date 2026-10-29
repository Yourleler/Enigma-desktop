// @vitest-environment jsdom
import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ClassicFindBox} from '../../ui/ClassicFindBox';
afterEach(cleanup);
it('shows a visible truncation explanation only when more results exist',()=>{
 const props={open:true,query:'word',resultIndex:0,resultCount:2000,onQueryChange:vi.fn(),onPrevious:vi.fn(),onNext:vi.fn(),onClose:vi.fn(),inline:true};const view=render(<ClassicFindBox {...props}/>);expect(screen.getByText('1/2000')).toBeTruthy();expect(screen.queryByText(/已显示前/)).toBeNull();view.rerender(<ClassicFindBox {...props} truncated/>);expect(screen.getByText('1/2000+')).toBeTruthy();expect(screen.getByText('已显示前 2000 项，请缩小查询范围。')).toBeTruthy();
});
