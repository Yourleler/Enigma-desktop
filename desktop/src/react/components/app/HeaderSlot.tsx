import {useLayoutEffect,useState} from 'react';
import type {ReactNode} from 'react';
import {createPortal} from 'react-dom';

/** Keep one owner for each toolbar. Embedded/test surfaces retain the local
 * fallback; the app shell moves it into its single titlebar after mounting. */
export function HeaderSlot({id,children}:{id:string;children:ReactNode}) {
  const [host,setHost]=useState<HTMLElement|null>(null);
  useLayoutEffect(()=>{setHost(document.getElementById(id));},[id]);
  return host?createPortal(children,host):<>{children}</>;
}
