// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';import {act,cleanup,renderHook} from '@testing-library/react';import {useAnimatedNumber} from '../../hooks/use-animated-number';
afterEach(()=>{cleanup();vi.useRealTimers();});
it('interpolates between observations, stops at the measured target, and resets immediately between runs',()=>{
 vi.useFakeTimers();const {result,rerender}=renderHook(({value,id,animate})=>useAnimatedNumber(value,id,animate),{initialProps:{value:10,id:'a',animate:true}});
 rerender({value:100,id:'a',animate:true});act(()=>vi.advanceTimersByTime(100));expect(result.current).toBeGreaterThan(10);expect(result.current).toBeLessThan(100);
 act(()=>vi.advanceTimersByTime(1000));expect(result.current).toBe(100);
 rerender({value:5,id:'b',animate:true});expect(result.current).toBe(5);
 rerender({value:3,id:'b',animate:false});expect(result.current).toBe(3);
});
