import { EnigmaDesign } from './react/ui/EnigmaDesign';
import { createRoot } from 'react-dom/client';
import { BrowserViewerApp } from './react/browser-viewer/BrowserViewerApp';

const el = document.getElementById('react-root');
if (el) {
  createRoot(el).render(<><EnigmaDesign /><BrowserViewerApp /></>);
}
