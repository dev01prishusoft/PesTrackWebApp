import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ConfirmProvider } from './components/ConfirmDialog';
import { ToastProvider } from './components/Toast';
// import { FrontendPage } from './pages/FrontendPage';
import { AdminLayout } from './admin/AdminLayout';
import { UsersPage } from './admin/pages/UsersPage';
import { SitesPage } from './admin/pages/SitesPage';
import { AuditPage } from './admin/pages/AuditPage';
import { Loader2 } from 'lucide-react';
import { LoginPage } from './pages/LoginPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function EntryRouter() {
  const { user, loading } = useAuth();
  
  if (loading) return null;
  if (!user) return <Navigate to="/admin/login" replace />;
  if (user.role === 'admin') return <Navigate to="/admin/users" replace />;
  
  // Non-admins should use the map app, not the React dashboard
  window.location.replace('/PesTrack.html');
  return null;
}

function RequireAuth({ children, requireAdmin }: { children: React.ReactNode; requireAdmin?: boolean }) {
  const { user, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-white text-slate-800" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: '3px solid rgba(45, 138, 78, 0.2)',
          borderTop: '3px solid #2d8a4e',
          borderRadius: '50%',
          animation: 'global-spin 1s linear infinite',
          marginBottom: '16px'
        }}></div>
        <span style={{ fontWeight: 600, letterSpacing: '0.05em', fontSize: '13px', textTransform: 'uppercase', color: '#475569' }}>Loading...</span>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/admin/login" replace />;
  }

  if (requireAdmin && user.role !== 'admin') {
    window.location.replace('/PesTrack.html');
    return null;
  }

  return children;
}

function NavigationRouter() {
  return (
    <Routes>
      <Route path="/" element={<EntryRouter />} />
      
      {/* <Route path="/frontend/login" element={<LoginPage />} /> */}
      <Route path="/admin/login" element={<LoginPage />} />
      
      {/* <Route 
        path="/frontend/dashboard" 
        element={
          <RequireAuth>
            <FrontendPage />
          </RequireAuth>
        } 
      /> */}
      
      <Route 
        path="/admin" 
        element={
          <RequireAuth requireAdmin>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/admin/users" replace />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="sites" element={<SitesPage />} />
        <Route path="logs" element={<AuditPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <ConfirmProvider>
              <NavigationRouter />
            </ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
