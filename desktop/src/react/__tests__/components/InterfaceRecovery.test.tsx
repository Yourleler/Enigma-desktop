// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {lazy,Suspense} from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ErrorBoundary} from '../../components/ErrorBoundary';
import {RegionalErrorBoundary} from '../../components/RegionalErrorBoundary';
import {reloadInterface} from '../../utils/interface-recovery';
vi.mock('../../utils/interface-recovery',async load=>({...await load<typeof import('../../utils/interface-recovery')>(),reloadInterface:vi.fn()}));
beforeEach(()=>{vi.clearAllMocks();vi.spyOn(console,'error').mockImplementation(()=>{});window.i18n={locale:'zh-CN'} as typeof window.i18n;});afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('recovers a rejected lazy module by explicit reload instead of reusing its cached failure',async()=>{
 const loader=vi.fn(()=>Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/old.js'))),Lazy=lazy(loader);
 await act(async()=>{render(<ErrorBoundary><Suspense><Lazy/></Suspense></ErrorBoundary>);});
 expect(screen.getByText('界面组件未能加载')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'重新加载界面'}));expect(reloadInterface).toHaveBeenCalledTimes(1);expect(loader).toHaveBeenCalledTimes(1);
});
it('retains ordinary render retry without forcing a reload',()=>{
 let broken=true;function Child(){if(broken)throw Error('ordinary render failure');return <p>restored</p>;}
 render(<ErrorBoundary><Child/></ErrorBoundary>);broken=false;fireEvent.click(screen.getByRole('button',{name:'重试'}));expect(screen.getByText('restored')).toBeVisible();expect(reloadInterface).not.toHaveBeenCalled();
});
it('does not waste regional automatic retries on an immutable lazy failure',async()=>{
 const loader=vi.fn(()=>Promise.reject(Error('Importing a module script failed.'))),Lazy=lazy(loader);
 await act(async()=>{render(<RegionalErrorBoundary region="chat" autoRetry={{attempts:2}}><Suspense><Lazy/></Suspense></RegionalErrorBoundary>);});
 expect(screen.getByRole('alert')).toHaveTextContent('界面组件未能加载');fireEvent.click(screen.getByRole('button',{name:'重新加载界面'}));expect(reloadInterface).toHaveBeenCalledOnce();expect(loader).toHaveBeenCalledOnce();
});
