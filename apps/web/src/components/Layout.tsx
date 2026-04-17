import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useStore } from '../store/useStore';

export function Layout() {
  const { notifications, dismissNotification } = useStore();

  return (
    <div className="flex h-screen ambient-bg text-gray-100">
      <div className="noise-overlay" />
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
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
