import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { ChatMessage, getAgentColor } from './ChatMessage';
import type { ChatMessage as ChatMsg } from '../hooks/useTeamChat';
import type { Agent } from '../store/useStore';

interface Props {
  messages: ChatMsg[];
  loading: boolean;
  sending: boolean;
  members: Agent[];
  hasMore?: boolean;
  loadingMore?: boolean;
  onSend: (text: string) => void;
  onLoadMore?: () => void;
}

export function ChatPanel({ messages, loading, sending, members, hasMore, loadingMore, onSend, onLoadMore }: Props) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);
  const isInitialMount = useRef(true);
  const prevScrollHeightRef = useRef(0);

  // Scroll to bottom instantly on initial load
  useEffect(() => {
    if (!loading && isInitialMount.current && messages.length > 0) {
      isInitialMount.current = false;
      bottomRef.current?.scrollIntoView();
    }
  }, [loading, messages.length]);

  // Scroll to bottom when new messages are appended at the end
  useEffect(() => {
    if (isInitialMount.current) return;
    const prevCount = prevMsgCountRef.current;
    const newCount = messages.length;
    prevMsgCountRef.current = newCount;

    if (newCount <= prevCount) return;

    // Check if user is near bottom (within 150px)
    const el = scrollRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;

    if (isNearBottom) {
      // Use instant scroll — no smooth animation through entire history
      bottomRef.current?.scrollIntoView();
    }
  }, [messages.length]);

  // Preserve scroll position when older messages are prepended
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !prevScrollHeightRef.current) return;

    const newScrollHeight = el.scrollHeight;
    const diff = newScrollHeight - prevScrollHeightRef.current;
    if (diff > 0) {
      el.scrollTop += diff;
    }
    prevScrollHeightRef.current = 0;
  }, [messages]);

  // Infinite scroll up — load older messages
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore || loadingMore) return;

    if (el.scrollTop < 100 && onLoadMore) {
      prevScrollHeightRef.current = el.scrollHeight;
      onLoadMore();
    }
  }, [hasMore, loadingMore, onLoadMore]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    ta.style.overflowY = ta.scrollHeight > 120 ? 'auto' : 'hidden';
  }, []);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending) return;
    onSend(input);
    setInput('');
    // Scroll to bottom after sending
    setTimeout(() => bottomRef.current?.scrollIntoView(), 50);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const agentNames = new Map(members.map((m) => [m.id, `${m.avatar_emoji} ${m.name}`]));

  return (
    <div className="flex h-full flex-col">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-500">Chat</h3>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden"
      >
        {loadingMore && (
          <div className="py-2 text-center text-xs text-gray-500">Loading older messages...</div>
        )}
        {hasMore === false && messages.length > 0 && (
          <div className="py-2 text-center text-xs text-gray-600">Beginning of conversation</div>
        )}
        {loading ? (
          <div className="text-sm text-gray-500">Loading chat...</div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-600">
            Send a message to the team leader
          </div>
        ) : (
          messages.map((msg, i) => {
            const prev = i > 0 ? messages[i - 1] : null;
            const sameAgent = prev
              && prev.role === 'assistant'
              && msg.role === 'assistant'
              && prev.agent_id === msg.agent_id
              && Math.abs(Number(msg.created_at) - Number(prev.created_at)) < 60000;
            const agentId = msg.agent_id ?? '';
            const color = msg.role === 'assistant' ? getAgentColor(agentId) : undefined;

            return (
              <div key={msg.id} className={sameAgent ? 'mt-1' : 'mt-3 first:mt-0'}>
                <ChatMessage
                  message={msg}
                  agentName={msg.agent_id ? agentNames.get(msg.agent_id) : undefined}
                  isGrouped={!!sameAgent}
                  agentColor={color}
                />
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="mt-3 flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message the team..."
          disabled={sending}
          rows={1}
          className="flex-1 resize-none rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
          style={{ overflowY: 'hidden' }}
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-600 transition-colors hover:bg-blue-500 disabled:opacity-50"
        >
          {sending ? (
            <span className="text-sm text-white">...</span>
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 15V3M9 3L3.5 8.5M9 3L14.5 8.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </form>
    </div>
  );
}
