import { useState } from 'react';

interface Props {
  content: string;
}

export function ThinkingBlock({ content }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="w-full rounded-lg border border-gray-800 bg-gray-900/50 px-3 py-2 text-left"
    >
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <svg
          className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium">Thinking</span>
      </div>
      {expanded && (
        <div className="mt-2 whitespace-pre-wrap text-xs italic text-gray-500">{content}</div>
      )}
    </button>
  );
}
