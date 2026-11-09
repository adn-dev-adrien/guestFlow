// The studio's phone preview (specs/guest-app.md rule 49): a page of its own, inside the studio's iframe, rendering
// the guest app's real components with the guest app's real styles.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PreviewApp from './PreviewApp';
import '@guest/styles.css';
import './preview.css';

createRoot(document.getElementById('root')).render(<StrictMode><PreviewApp /></StrictMode>);
