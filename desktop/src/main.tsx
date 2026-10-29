import { createRoot } from 'react-dom/client';
import App from './react/App';
import {useStore} from './react/stores';

function markLaunch(event: string, details?: unknown) {
  if (details === undefined) {
    console.info(`[hana-launch] ${event}`);
  } else {
    console.info(`[hana-launch] ${event}`, details);
  }
}

markLaunch('renderer-entry');

window.addEventListener('securitypolicyviolation', (event) => {
  markLaunch('securitypolicyviolation', JSON.stringify({
    blockedURI: event.blockedURI,
    violatedDirective: event.violatedDirective,
    effectiveDirective: event.effectiveDirective,
    originalPolicy: event.originalPolicy,
    disposition: event.disposition,
    sourceFile: event.sourceFile,
    lineNumber: event.lineNumber,
    columnNumber: event.columnNumber,
  }));
});

async function mountApp() {
  // Local translation assets should be ready before interactive labels mount;
  // server connection/auth latency must not expose raw translation keys.
  let locale=document.documentElement.lang||'zh-CN';
  try { locale=localStorage.getItem('enigma-last-locale')||locale; } catch { /* Optional preference. */ }
  await window.i18n?.load(locale);
  window.i18n.defaultName='Enigma';
  useStore.setState({agentName:'Enigma',agentYuan:'enigma'});
  const el = document.getElementById('react-root');
  if (el) {
    markLaunch('root-mount-start');
    createRoot(el).render(<App />);
    markLaunch('root-mounted');
  } else markLaunch('react-root-missing');
}
void mountApp();
