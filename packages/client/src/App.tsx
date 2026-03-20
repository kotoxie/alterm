import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { SetupPage } from './pages/SetupPage';
import { LoginPage } from './pages/LoginPage';
import { MainLayout } from './pages/MainLayout';

export function App() {
  const { user, loading, needsSetup } = useAuth();

  if (loading || needsSetup === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-surface">
        <div className="text-text-secondary text-lg">Loading...</div>
      </div>
    );
  }

  if (needsSetup) {
    return (
      <Routes>
        <Route path="*" element={<SetupPage />} />
      </Routes>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/*" element={<MainLayout />} />
    </Routes>
  );
}
