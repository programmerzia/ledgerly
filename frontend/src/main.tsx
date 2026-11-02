import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { initDexiePersistence } from './mock/store';
import { queryClient } from './api/queryClient';
import { IS_LIVE } from './api/config';
import { installLiveSessionGuard } from './data/session';

initDexiePersistence();
if (IS_LIVE) installLiveSessionGuard();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
