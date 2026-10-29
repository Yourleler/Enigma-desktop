// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMotionEnabled, saveMaterialPreferences } from '../../ui/material-preferences';
afterEach(()=>{cleanup();localStorage.clear();document.body.className='';vi.unstubAllGlobals();});
function Probe(){return <span>{useMotionEnabled()?'motion':'static'}</span>;}
it('keeps JS animation preferences synchronized with the material switch',()=>{
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));render(<Probe/>);
 expect(screen.getByText('motion')).toBeTruthy();act(()=>saveMaterialPreferences({glass:true,motion:false}));expect(screen.getByText('static')).toBeTruthy();
});
it('respects OS reduce-motion even when application motion is enabled',()=>{
 vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}));render(<Probe/>);expect(screen.getByText('static')).toBeTruthy();
});
