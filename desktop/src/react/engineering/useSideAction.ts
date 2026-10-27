import { useEffect, useRef, useState } from 'react';
import { useEngineering } from './state';

/** Keep a slow side operation's UI receipt attached to its original view.
 * Navigation does not abort an already accepted server-side write. */
export function useSideAction(sessionPath: string, viewKey = '') {
  const connection = useEngineering(s => s.connectionId);
  const scope = JSON.stringify([connection, sessionPath, viewKey]);
  const lifecycle = useRef(0), pending = useRef<{ scope: string; id: number } | null>(null), sequence = useRef(0);
  const [view, setView] = useState({ scope, busy: '', error: '' });
  useEffect(() => { lifecycle.current++; pending.current = null; setView({scope,busy:'',error:''}); return () => { lifecycle.current++; }; }, [scope]);
  const run = async <T,>(name: string, request: () => Promise<T>, receive?: (value: T) => void | Promise<void>) => {
    const current = useEngineering.getState();
    if (!sessionPath || current.sessionPath !== sessionPath || current.connectionId !== connection || pending.current?.scope === scope) return;
    const ticket = { scope, id: ++sequence.current }, version = lifecycle.current;
    const isCurrent = () => lifecycle.current === version && useEngineering.getState().sessionPath === sessionPath && useEngineering.getState().connectionId === connection;
    pending.current = ticket; setView({ scope, busy: name, error: '' });
    try { const result = await request(); if (isCurrent()) await receive?.(result); }
    catch (error) { if (isCurrent()) setView({ scope, busy: '', error: error instanceof Error ? error.message : String(error) }); }
    finally {
      if (pending.current === ticket) pending.current = null;
      if (isCurrent()) setView(current => ({ ...current, busy: '' }));
    }
  };
  return { busy: view.scope === scope ? view.busy : '', error: view.scope === scope ? view.error : '', run };
}
