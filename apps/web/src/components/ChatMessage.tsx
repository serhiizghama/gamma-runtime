import { useState, useRef, useEffect, useCallback } from 'react';
import { marked, Renderer, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import type { ChatMessage as ChatMsg } from '../hooks/useTeamChat';
import { highlightCode } from '../utils/highlight';

function escapeForAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const renderer = new Renderer();

renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const langLabel = lang ? `<span>${lang}</span>` : '';
  const highlighted = highlightCode(text, lang || undefined);
  return `<div class="chat-code-block"><div class="chat-code-header">${langLabel}<button class="chat-copy-btn" data-code="${escapeForAttr(text)}">Copy</button></div><pre class="chat-code-pre"><code class="hljs">${highlighted}</code></pre></div>`;
};

renderer.table = function ({ header, rows }: Tokens.Table) {
  const alignAttr = (a: string | null) => a ? ` style="text-align:${a}"` : '';
  const renderCell = (cell: Tokens.TableCell) => this.parser.parseInline(cell.tokens);
  const headerHtml = '<tr>' + header.map((cell) =>
    `<th${alignAttr(cell.align)}>${renderCell(cell)}</th>`
  ).join('') + '</tr>';
  const bodyHtml = rows.map((row) =>
    '<tr>' + row.map((cell) =>
      `<td${alignAttr(cell.align)}>${renderCell(cell)}</td>`
    ).join('') + '</tr>'
  ).join('');
  return `<div class="chat-table-wrap"><table><thead>${headerHtml}</thead><tbody>${bodyHtml}</tbody></table></div>`;
};

renderer.image = ({ href, title, text }: { href: string; title?: string | null; text: string }) => {
  const titleAttr = title ? ` title="${escapeForAttr(title)}"` : '';
  return `<a href="${href}" target="_blank" rel="noopener noreferrer"><img class="chat-image" src="${href}" alt="${escapeForAttr(text)}"${titleAttr} loading="lazy" /></a>`;
};

marked.use({ renderer, gfm: true, breaks: true });

function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html);
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
  const contentRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(true);
  const [needsCollapse, setNeedsCollapse] = useState(false);
  const [copied, setCopied] = useState(false);

  const isAssistant = message.role === 'assistant';

  const handleCopyMessage = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  useEffect(() => {
    if (!isAssistant || !contentRef.current) return;
    setNeedsCollapse(contentRef.current.scrollHeight > 288);
  }, [message.content, isAssistant]);

  const handleContentClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const btn = (e.target as HTMLElement).closest('.chat-copy-btn') as HTMLElement | null;
    if (!btn) return;
    e.preventDefault();
    const code = btn.getAttribute('data-code') ?? '';
    navigator.clipboard.writeText(code).then(() => {
      const prev = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = prev; }, 1500);
    });
  }, []);

  if (message.role === 'system') {
    return (
      <div className="mx-auto max-w-md rounded-lg bg-gray-800/50 px-4 py-2 text-center text-xs text-gray-500">
        {message.content}
      </div>
    );
  }

  const isUser = message.role === 'user';
  const showCollapsed = isAssistant && needsCollapse && collapsed;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`group relative rounded-xl px-4 py-2.5 ${
          isUser
            ? 'max-w-[80%] bg-blue-600 text-white'
            : 'max-w-[85%] bg-gray-800 text-gray-200'
        }`}
        style={!isUser && agentColor ? { borderLeft: `3px solid ${agentColor}` } : undefined}
      >
        {!isUser && (
          <button
            onClick={handleCopyMessage}
            className="absolute right-2 top-2 z-10 rounded bg-gray-700/50 p-1 text-gray-500 opacity-0 transition-opacity hover:bg-gray-700 hover:text-gray-300 group-hover:opacity-100"
            title="Copy message"
          >
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        )}
        {!isUser && !isGrouped && (
          <div className="mb-1 text-xs font-medium text-gray-400">
            {agentName ?? 'Assistant'}
          </div>
        )}
        <div className="relative">
          <div
            ref={contentRef}
            onClick={handleContentClick}
            className={`chat-content text-sm leading-relaxed ${showCollapsed ? 'max-h-[192px] overflow-hidden' : ''}`}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
          />
          {showCollapsed && (
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-gray-800 to-transparent" />
          )}
        </div>
        {isAssistant && needsCollapse && (
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="mt-1 text-xs text-gray-400 hover:text-gray-300"
          >
            {collapsed ? 'Show more' : 'Show less'}
          </button>
        )}
        <div className={`mt-1 text-[10px] ${isUser ? 'text-blue-300' : 'text-gray-600'}`}>
          {new Date(Number(message.created_at)).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
