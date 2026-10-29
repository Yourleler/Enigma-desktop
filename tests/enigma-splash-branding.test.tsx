// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';import {cleanup,render,screen,waitFor} from '@testing-library/react';import {afterEach,expect,it,vi} from 'vitest';import {SplashApp} from '../desktop/src/react/splash/SplashApp';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('startup product branding wins over a legacy selected agent avatar and does not fetch persona prose',async()=>{
 vi.stubGlobal('hana',{getAvatarPath:async()=>'/old/Hanako.png',getSplashInfo:async()=>({productName:'Enigma',agentName:'Enigma',yuan:'enigma',locale:'zh-CN'})});vi.stubGlobal('platform',{getFileUrl:(s:string)=>s});const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const {container}=render(<SplashApp/>);expect(await screen.findByText('正在启动 Enigma…')).toBeVisible();await waitFor(()=>expect(container.querySelector('img')).toHaveAttribute('src','assets/enigma/avatar.png'));expect(fetch).not.toHaveBeenCalled();expect(container.textContent).not.toContain('Hanako');
});
