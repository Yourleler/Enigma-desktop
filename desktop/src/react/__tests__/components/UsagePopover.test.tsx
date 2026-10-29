// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {useRef,useState} from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {AnchoredPortal} from '../../ui/AnchoredPortal';
import {SelectWidget} from '../../ui/SelectWidget';
afterEach(cleanup);
it('keeps the usage popover open when selecting a nested filter and closes the nested menu first on Escape',()=>{
 function Example(){const anchor=useRef<HTMLButtonElement>(null),[open,setOpen]=useState(true),[value,setValue]=useState('all');return <><button ref={anchor}>用量</button><AnchoredPortal open={open} anchorRef={anchor} role="dialog" ariaLabel="用量" onClose={()=>setOpen(false)}><SelectWidget ariaLabel="筛选模型" options={[{value:'all',label:'全部'},{value:'test',label:'指定模型'}]} value={value} onChange={setValue}/></AnchoredPortal></>;}
 render(<Example/>);fireEvent.click(screen.getByRole('button',{name:'筛选模型'}));const option=screen.getByRole('option',{name:'指定模型'});fireEvent.mouseDown(option);fireEvent.click(option);expect(screen.getByRole('dialog',{name:'用量'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'筛选模型'})).toHaveTextContent('指定模型');
 fireEvent.click(screen.getByRole('button',{name:'筛选模型'}));fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('listbox')).not.toBeInTheDocument();expect(screen.getByRole('dialog')).toBeInTheDocument();fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
