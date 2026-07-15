import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Global fetch interceptor to show a full screen loader for all network requests
let activeRequests = 0;
const originalFetch = window.fetch;
window.fetch = async function (...args) {
  const requestUrl = typeof args[0] === 'string' ? args[0] : (args[0] instanceof Request ? args[0].url : '');
  
  // The React application uses React Query which provides fine-grained, localized
  // loading states (spinners on buttons, loaders in tables, etc).
  // We completely bypass this legacy global full-screen interceptor for the admin portal.
  const isAdminPortal = window.location.pathname.startsWith('/admin');
  const isAuthRequest = requestUrl.includes('/api/auth/');
  const isLoginPage = window.location.pathname.includes('login');
  
  const skipLoader = isAdminPortal || isAuthRequest || isLoginPage;

  if (!skipLoader) {
    activeRequests++;
    const adminLoader = document.getElementById('admin-main-loader');
    const globalLoader = document.getElementById('global-loader');
    if (adminLoader) {
      adminLoader.style.display = 'flex';
    } else if (globalLoader) {
      globalLoader.style.display = 'flex';
    }
  }

  try {
    return await originalFetch(...args);
  } finally {
    if (!skipLoader) {
      activeRequests--;
      if (activeRequests <= 0) {
        activeRequests = 0;
        const adminLoaderToHide = document.getElementById('admin-main-loader');
        const globalLoaderToHide = document.getElementById('global-loader');
        if (adminLoaderToHide) adminLoaderToHide.style.display = 'none';
        if (globalLoaderToHide) globalLoaderToHide.style.display = 'none';
      }
    }
  }
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
