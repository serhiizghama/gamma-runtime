import { useEffect, useState } from 'react';
import { get } from '../api/client';

interface AppStatus {
  exists: boolean;
  lastModified: number | null;
  files: string[];
  sizeBytes: number;
}

interface Props {
  teamId: string;
}

export function AppViewer({ teamId }: Props) {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showViewer, setShowViewer] = useState(false);

  useEffect(() => {
    get<AppStatus>(`/teams/${teamId}/app/status`)
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, [teamId]);

  if (loading) {
    return <div className="text-sm text-gray-500">Checking app...</div>;
  }

  const appUrl = `/api/teams/${teamId}/app/`;

  if (!status?.exists) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-600">
        <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <span className="text-sm">No app created yet</span>
        <span className="text-xs text-gray-700">The team will build it when given a task</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          <span className="text-xs text-gray-400">Available</span>
          <span className="text-[10px] text-gray-600">
            {status.files.length} file{status.files.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowViewer(!showViewer)}
            className="rounded px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
          >
            {showViewer ? 'Hide' : 'Preview'}
          </button>
          <a
            href={appUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded px-2 py-1 text-xs text-blue-400 transition-colors hover:bg-gray-800 hover:text-blue-300"
          >
            Open in New Tab
          </a>
        </div>
      </div>

      {showViewer && (
        <iframe
          src={appUrl}
          title="Team App Preview"
          className="flex-1 rounded-lg border border-gray-700 bg-white"
          sandbox="allow-scripts allow-same-origin"
        />
      )}
    </div>
  );
}
