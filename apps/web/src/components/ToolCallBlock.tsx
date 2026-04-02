import { useState } from 'react';

interface Props {
  toolName: string;
  input?: string;
  output?: string;
  isResult?: boolean;
}

export function ToolCallBlock({ toolName, input, output, isResult }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="w-full rounded-lg border border-gray-800 bg-gray-900/50 px-3 py-2 text-left"
    >
      <div className="flex items-center gap-2 text-xs">
        <svg
          className={`h-3 w-3 text-gray-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className={`font-mono font-medium ${isResult ? 'text-green-500' : 'text-blue-400'}`}>
          {isResult ? 'result' : toolName}
        </span>
        {!isResult && input && !expanded && (
          <span className="truncate text-gray-600">{input.slice(0, 60)}</span>
        )}
      </div>
      {expanded && (
        <div className="mt-2 space-y-2">
          {input && (
            <div>
              <div className="mb-0.5 text-[10px] font-medium uppercase text-gray-600">Input</div>
              <pre className="max-h-48 overflow-auto rounded bg-gray-950 p-2 font-mono text-[11px] text-gray-400">
                {input}
              </pre>
            </div>
          )}
          {output && (
            <div>
              <div className="mb-0.5 text-[10px] font-medium uppercase text-gray-600">Output</div>
              <pre className="max-h-48 overflow-auto rounded bg-gray-950 p-2 font-mono text-[11px] text-gray-400">
                {output}
              </pre>
            </div>
          )}
        </div>
      )}
    </button>
  );
}
