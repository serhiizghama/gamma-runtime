import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { TeamDetail } from './pages/TeamDetail';
import { TraceViewer } from './pages/TraceViewer';
import { NotFound } from './pages/NotFound';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/teams/:id" element={<TeamDetail />} />
        <Route path="/tasks" element={<div className="text-gray-400">Tasks — coming soon</div>} />
        <Route path="/trace" element={<TraceViewer />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
