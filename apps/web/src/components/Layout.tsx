import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useStore } from '../store/useStore';
import { post } from '../api/client';

export function Layout() {
  const { notifications, dismissNotification, addNotification } = useStore();

  const handleEmergencyStop = async () => {
    try {
      await post('/emergency-stop', {});
      addNotification({ type: 'success', message: 'All agents stopped' });
    } catch (err) {
      addNotification({ type: 'error', message: err instanceof Error ? err.message : 'Emergency stop failed' });
    }
  };

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-between border-b border-gray-800 px-6">
          <div />
          <button
            onClick={handleEmergencyStop}
            className="rounded-lg bg-red-600/20 px-4 py-1.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-600/30"
          >
            Emergency Stop
          </button>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
        {notifications.length > 0 && (
          <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg ${
                  n.type === 'error'
                    ? 'border-red-800 bg-red-950 text-red-300'
                    : n.type === 'success'
                      ? 'border-green-800 bg-green-950 text-green-300'
                      : 'border-gray-700 bg-gray-800 text-gray-300'
                }`}
              >
                <span className="text-sm">{n.message}</span>
                <button
                  onClick={() => dismissNotification(n.id)}
                  className="ml-2 text-gray-500 hover:text-gray-300"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
