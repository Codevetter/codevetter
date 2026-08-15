import './globals.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { AppErrorBoundary } from './components/app-error-boundary';
import {
  initializeVerificationStateBridge,
  type VerificationWindow,
} from './lib/verification-state-bridge';

void initializeVerificationStateBridge();

function VerificationCrashTrigger({ children }: { children: React.ReactNode }) {
  const request = (window as unknown as VerificationWindow).__CODEVETTER_VERIFY__;
  const previewState = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get('__codevetter_preview')
    : null;
  if (request?.stateName === 'shell-crash-recovery' || previewState === 'shell-crash-recovery') {
    throw new Error('Synthetic verification crash');
  }
  return children;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary scope="application">
      <VerificationCrashTrigger>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </VerificationCrashTrigger>
    </AppErrorBoundary>
  </StrictMode>
);
