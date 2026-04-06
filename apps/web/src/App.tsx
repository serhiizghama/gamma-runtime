import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Dashboard } from './pages/Dashboard';
import { TeamDetail } from './pages/TeamDetail';
import { TraceViewer } from './pages/TraceViewer';
import { NotFound } from './pages/NotFound';

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
          <Route path="/teams/:id" element={<ErrorBoundary><TeamDetail /></ErrorBoundary>} />
          <Route path="/tasks" element={<div className="text-gray-400">Tasks — coming soon</div>} />
          <Route path="/trace" element={<ErrorBoundary><TraceViewer /></ErrorBoundary>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
