import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { queryClient } from './lib/query-client';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import '@fontsource-variable/inter';
import '@fontsource-variable/lora';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
      <Toaster position="bottom-center" richColors closeButton />
    </QueryClientProvider>
  </React.StrictMode>,
);
