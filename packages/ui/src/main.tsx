import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { BrainstormApp } from './brainstorm/BrainstormApp';
import { ErrorBoundary } from './ErrorBoundary';
import './styles.css';

const isBrainstorm = new URLSearchParams(window.location.search).get('view') === 'brainstorm';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isBrainstorm ? <BrainstormApp /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
);
