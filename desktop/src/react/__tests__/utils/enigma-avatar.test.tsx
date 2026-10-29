// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';import {cleanup,fireEvent,render,screen} from '@testing-library/react';import {afterEach,expect,it,vi} from 'vitest';
import {yuanFallbackAvatar} from '../../utils/agent-helpers';import {yuanFallbackAvatar as settingsAvatar} from '../../settings/api';import {AgentAvatar,resolveAgentDisplayInfo} from '../../utils/agent-display';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('Enigma avatar resolves without a locale entry in all shared display paths',()=>{
 vi.stubGlobal('t',()=>({hanako:{avatar:'Hanako.png'},kong:{avatar:'Kong.png'}}));expect(yuanFallbackAvatar('enigma')).toBe('assets/enigma/avatar.png');expect(settingsAvatar('enigma')).toBe('assets/enigma/avatar.png');expect(yuanFallbackAvatar('kong')).toBe('assets/Kong.png');
 const info=resolveAgentDisplayInfo({id:'hanako',agents:[{id:'hanako',name:'Enigma',yuan:'enigma',hasAvatar:false} as any]});render(<AgentAvatar info={info}/>);expect(screen.getByRole('img',{name:'Enigma'})).toHaveAttribute('src','assets/enigma/avatar.png');
});
it('keeps a custom avatar and falls back to the correct product icon only when that file fails',()=>{
 const info={id:'enigma',displayName:'Enigma',avatarUrl:'/custom.png',fallbackAvatar:yuanFallbackAvatar('enigma'),isUser:false};render(<AgentAvatar info={info}/>);const image=screen.getByRole('img');expect(image).toHaveAttribute('src','/custom.png');fireEvent.error(image);expect(image).toHaveAttribute('src','assets/enigma/avatar.png');
});
