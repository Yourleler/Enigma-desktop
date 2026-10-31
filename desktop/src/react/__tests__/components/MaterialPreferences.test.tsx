// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';import {afterEach,beforeEach,expect,it} from 'vitest';
import {useMaterialPreferences,saveMaterialPreferences} from '../../ui/material-preferences';
beforeEach(()=>{localStorage.clear();document.body.className='';});afterEach(cleanup);
function Control({name}:{name:string}){const [state,set]=useMaterialPreferences();return <button onClick={()=>set({...state,glass:!state.glass})}>{name} {state.glass?'on':'off'}</button>;}
it('keeps settings and toolbar material controls synchronized without resetting the motion preference',()=>{render(<><Control name="settings"/><Control name="toolbar"/></>);act(()=>saveMaterialPreferences({glass:true,motion:false}));fireEvent.click(screen.getByRole('button',{name:'settings on'}));expect(screen.getByRole('button',{name:'toolbar off'})).toBeVisible();expect(document.body).toHaveClass('enigma-glass-off','enigma-motion-off');expect(JSON.parse(localStorage.getItem('enigma-appearance')!)).toEqual({glass:false,motion:false});});

it('extends only the dense end while retaining the original strongest glass and default values',()=>{
 act(()=>saveMaterialPreferences({glass:true,motion:true,tint:0}));expect(document.body.style.getPropertyValue('--glass-composer-mix')).toBe('3%');expect(document.body.style.getPropertyValue('--glass-control-blur')).toBe('0.5px');
 act(()=>saveMaterialPreferences({glass:true,motion:true,tint:50}));expect(document.body.style.getPropertyValue('--glass-composer-mix')).toBe('38%');
 act(()=>saveMaterialPreferences({glass:true,motion:true,tint:100}));expect(document.body.style.getPropertyValue('--glass-composer-mix')).toBe('98%');expect(document.body.style.getPropertyValue('--glass-navigation-mix')).toBe('98%');
});

it('covers small controls at the dense end while preserving their clear endpoint',()=>{
 act(()=>saveMaterialPreferences({glass:true,motion:true,tint:0}));
 expect(document.body.style.getPropertyValue('--glass-control-cover')).toBe('0%');
 expect(document.body.style.getPropertyValue('--glass-control-edge-opacity')).toBe('1');
 act(()=>saveMaterialPreferences({glass:true,motion:true,tint:50}));
 expect(document.body.style.getPropertyValue('--glass-control-cover')).toBe('10%');
 expect(document.body.style.getPropertyValue('--glass-control-edge-opacity')).toBe('1');
 act(()=>saveMaterialPreferences({glass:true,motion:true,tint:100}));
 expect(document.body.style.getPropertyValue('--glass-control-cover')).toBe('96%');
 expect(Number(document.body.style.getPropertyValue('--glass-control-edge-opacity'))).toBeCloseTo(.14);
 expect(document.body.style.getPropertyValue('--glass-control-blur')).toBe('20.5px');
});
it('adjusts the main content and outer chrome together, keeping content material denser',()=>{
 for(const tint of [0,50,100]){
  act(()=>saveMaterialPreferences({glass:true,motion:true,tint}));
  const style=document.body.style;
  expect(parseFloat(style.getPropertyValue('--glass-content-blur'))).toBeGreaterThan(parseFloat(style.getPropertyValue('--glass-chrome-blur')));
  expect(parseFloat(style.getPropertyValue('--glass-content-mix'))).toBeGreaterThan(parseFloat(style.getPropertyValue('--glass-chrome-mix')));
 }
 expect(document.body.style.getPropertyValue('--glass-content-mix')).toBe('96%');
});
