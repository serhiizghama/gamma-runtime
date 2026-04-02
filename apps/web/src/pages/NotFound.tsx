import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-gray-400">
      <h1 className="mb-2 text-6xl font-bold text-gray-600">404</h1>
      <p className="mb-6 text-lg">Page not found</p>
      <Link
        to="/"
        className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
