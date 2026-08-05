import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Self-hosted faces. Anton is the headline, Oswald does labels and every numeral,
// Lora sets the article voice for "why it matters", and Hind Siliguri covers
// Bengali — the bank already carries Bangla script in its display answers, so the
// Bengali subset is not optional.
import '@fontsource/anton/400.css';
import '@fontsource/oswald/500.css';
import '@fontsource/oswald/600.css';
import '@fontsource/oswald/700.css';
import '@fontsource/lora/400.css';
import '@fontsource/lora/400-italic.css';
import '@fontsource/lora/600.css';
import '@fontsource/hind-siliguri/bengali-400.css';
import '@fontsource/hind-siliguri/bengali-600.css';

import './press/tokens.css';
import './press/press.css';
import './views/shared.css';
import './views/host/host.css';
import './views/player/player.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
