import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from './i18n.tsx';
import { App } from './App.tsx';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
