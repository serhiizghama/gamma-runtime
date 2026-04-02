import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { NotFound } from './pages/NotFound';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tasks" element={<div className="text-gray-400">Tasks — coming soon</div>} />
        <Route path="/trace" element={<div className="text-gray-400">Trace — coming soon</div>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
