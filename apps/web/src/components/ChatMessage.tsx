import type { ChatMessage as ChatMsg } from '../hooks/useTeamChat';

function renderMarkdown(text: string): string {
  // Escape HTML
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Process line by line for block elements
  const lines = html.split('\n');
  const processed: string[] = [];
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Empty line = paragraph break
    if (trimmed === '') {
      if (inList) { processed.push('</ul>'); inList = false; }
      processed.push('<div class="h-2"></div>');
      continue;
    }

    // Headings
    const h3 = trimmed.match(/^###\s+(.+)$/);
    if (h3) {
      if (inList) { processed.push('</ul>'); inList = false; }
      processed.push(`<div class="mt-2 mb-0.5 font-semibold">${h3[1]}</div>`);
      continue;
    }
    const h2 = trimmed.match(/^##\s+(.+)$/);
    if (h2) {
      if (inList) { processed.push('</ul>'); inList = false; }
      processed.push(`<div class="mt-2 mb-0.5 font-semibold">${h2[1]}</div>`);
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(trimmed)) {
      if (inList) { processed.push('</ul>'); inList = false; }
      processed.push('<hr class="my-1.5 border-current opacity-20" />');
      continue;
    }

    // List items
    const li = trimmed.match(/^[-*]\s+(.+)$/);
    if (li) {
      if (!inList) { processed.push('<ul class="ml-3 my-0.5">'); inList = true; }
      processed.push(`<li class="before:content-['•'] before:mr-1.5 before:opacity-40">${li[1]}</li>`);
      continue;
    }

    // Regular line
    if (inList) { processed.push('</ul>'); inList = false; }
    processed.push(`${line}<br/>`);
  }
  if (inList) processed.push('</ul>');

  html = processed.join('');

  // Inline formatting
  html = html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="rounded bg-black/20 px-1 py-0.5 text-[13px] font-mono">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="underline opacity-80 hover:opacity-100">$1</a>');

  // Clean up trailing <br/> before block elements or at end
  html = html.replace(/<br\/>(<div|<hr|<ul|$)/g, '$1');
  html = html.replace(/(<\/ul>|<\/div>)<br\/>/g, '$1');

  return html;
}

const AGENT_COLORS = [
  '#2dd4bf99', // teal
  '#818cf899', // indigo
  '#f59e0b99', // amber
  '#fb718599', // rose
  '#34d39999', // emerald
  '#a78bfa99', // violet
  '#38bdf899', // sky
  '#fb923c99', // orange
];

function getAgentColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

interface Props {
  message: ChatMsg;
  agentName?: string;
  isGrouped?: boolean;
  agentColor?: string;
}

export { getAgentColor };

export function ChatMessage({ message, agentName, isGrouped, agentColor }: Props) {
  if (message.role === 'system') {
    return (
      <div className="mx-auto max-w-md rounded-lg bg-gray-800/50 px-4 py-2 text-center text-xs text-gray-500">
        {message.content}
      </div>
    );
  }

  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`rounded-xl px-4 py-2.5 ${
          isUser
            ? 'max-w-[80%] bg-blue-600 text-white'
            : 'max-w-[85%] bg-gray-800 text-gray-200'
        }`}
        style={!isUser && agentColor ? { borderLeft: `3px solid ${agentColor}` } : undefined}
      >
        {!isUser && !isGrouped && (
          <div className="mb-1 text-xs font-medium text-gray-400">
            {agentName ?? 'Assistant'}
          </div>
        )}
        <div
          className="text-sm leading-snug"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
        />
        <div className={`mt-1 text-[10px] ${isUser ? 'text-blue-300' : 'text-gray-600'}`}>
          {new Date(Number(message.created_at)).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
