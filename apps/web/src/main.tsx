import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/playfair-display';
import App from './App.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
