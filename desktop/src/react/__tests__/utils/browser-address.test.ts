import {expect,it} from 'vitest';
import {resolveBrowserAddress} from '../../utils/browser-address';
it('defaults loopback development pages to HTTP and public hosts to HTTPS',()=>{
 for(const address of ['localhost:3000/page','127.0.0.1:8080','[::1]:5000/?q=test'])expect(resolveBrowserAddress(address)).toBe('http://'+address+(address==='127.0.0.1:8080'?'/':''));
 expect(resolveBrowserAddress('example.com?q=test')).toBe('https://example.com/?q=test');
 expect(resolveBrowserAddress('https://localhost:3000')).toBe('https://localhost:3000/');
});
it('rejects executable and filesystem protocols',()=>{
 for(const address of ['javascript:alert(1)','data:text/html,test','file:///tmp/new-test.html'])expect(()=>resolveBrowserAddress(address)).toThrow('只支持');
});
