// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {useState} from 'react';
import {HeaderSlot} from '../../components/app/HeaderSlot';
afterEach(cleanup);
it('renders the controls exactly once in the titlebar and keeps their state across content rerenders',()=>{
 function Controls(){const [n,set]=useState(0);return <button onClick={()=>set(n+1)}>Tool {n}</button>;}
 function Layout({label}:{label:string}){return <><header id="slot"/><main><span>{label}</span><HeaderSlot id="slot"><Controls/></HeaderSlot></main></>;}
 const view=render(<Layout label="first"/>);fireEvent.click(screen.getByText('Tool 0'));
 view.rerender(<Layout label="second"/>);expect(screen.getAllByText('Tool 1')).toHaveLength(1);
 expect(screen.getByText('Tool 1').closest('header')).toHaveAttribute('id','slot');
 expect(document.querySelector('main button')).toBeNull();
});
it('retains a local fallback for embedded surfaces without the app titlebar',()=>{
 render(<main><HeaderSlot id="missing"><button>Local tool</button></HeaderSlot></main>);
 expect(screen.getByText('Local tool').closest('main')).not.toBeNull();
});
