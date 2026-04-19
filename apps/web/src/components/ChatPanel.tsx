import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { ChatMessage, getAgentColor } from './ChatMessage';
import { ActivityIndicator } from './ActivityIndicator';
import type { ChatMessage as ChatMsg } from '../hooks/useTeamChat';
import type { Agent } from '../store/useStore';
import type { AgentActivity } from '../hooks/useAgentActivities';

interface Props {
  messages: ChatMsg[];
  loading: boolean;
  sending: boolean;
  members: Agent[];
  hasMore?: boolean;
  loadingMore?: boolean;
  activities?: AgentActivity[];
  onSend: (text: string) => void;
  onLoadMore?: () => void;
}

const NEAR_BOTTOM_PX = 150;
const AUTO_SCROLL_ANIMATION_MS = 500;

export function ChatPanel({ messages, loading, sending, members, hasMore, loadingMore, activities, onSend, onLoadMore }: Props) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);
  const prevFirstIdRef = useRef<string | null>(null);
  const prevScrollHeightRef = useRef(0);
  // Snapshot of "was the user near the bottom" captured BEFORE the current
  // render. This is the key to bug #5: measuring distance-to-bottom AFTER a
  // tall message is inserted gives a false negative (distance > threshold)
  // and the user gets stranded mid-chat. Updated on scroll events and at the
  // end of each layout effect run.
  const wasNearBottomRef = useRef(true);
  // While we run a smooth auto-scroll, the browser fires scroll events that
  // would otherwise flip wasNearBottomRef to false mid-animation. The lock
  // tells handleScroll and the layout effect to trust the committed intent
  // until the animation settles.
  const isAutoScrollingRef = useRef(false);
  const autoScrollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (autoScrollTimerRef.current !== null) {
        window.clearTimeout(autoScrollTimerRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const prevCount = prevMsgCountRef.current;
    const newCount = messages.length;
    const newFirstId = messages[0]?.id ?? null;
    const prevFirstId = prevFirstIdRef.current;

    const wasPrepend =
      prevFirstId !== null &&
      newFirstId !== prevFirstId &&
      messages.some((m) => m.id === prevFirstId);

    if (wasPrepend && prevScrollHeightRef.current > 0) {
      const diff = el.scrollHeight - prevScrollHeightRef.current;
      if (diff > 0) el.scrollTop += diff;
    } else if (newCount > prevCount && wasNearBottomRef.current) {
      isAutoScrollingRef.current = true;
      if (autoScrollTimerRef.current !== null) {
        window.clearTimeout(autoScrollTimerRef.current);
      }
      autoScrollTimerRef.current = window.setTimeout(() => {
        isAutoScrollingRef.current = false;
        autoScrollTimerRef.current = null;
        const el2 = scrollRef.current;
        if (el2) {
          wasNearBottomRef.current =
            el2.scrollHeight - el2.scrollTop - el2.clientHeight < NEAR_BOTTOM_PX;
        }
      }, AUTO_SCROLL_ANIMATION_MS);
      // On the very first paint there is no prior content to animate from —
      // jumping instantly avoids a visible scroll-through-empty-history.
      const firstPaint = prevCount === 0;
      el.scrollTo({
        top: el.scrollHeight,
        behavior: firstPaint ? 'auto' : 'smooth',
      });
    }

    prevMsgCountRef.current = newCount;
    prevFirstIdRef.current = newFirstId;
    prevScrollHeightRef.current = el.scrollHeight;
    if (!isAutoScrollingRef.current) {
      wasNearBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    }
  }, [messages]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!isAutoScrollingRef.current) {
      wasNearBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    }
    if (!hasMore || loadingMore) return;
    if (el.scrollTop < 100 && onLoadMore) onLoadMore();
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

  // Return focus to the input once the team goes idle again, so the user
  // can type a follow-up immediately without clicking the field.
  const prevBusyRef = useRef(false);
  useEffect(() => {
    const anyRunning = members.some((m) => m.status === 'running');
    const busy = sending || anyRunning;
    if (prevBusyRef.current && !busy) {
      const active = document.activeElement;
      // Only grab focus if nothing else holds it — don't yank the caret out
      // of a modal or another input the user may have opened.
      if (!active || active === document.body) {
        textareaRef.current?.focus();
      }
    }
    prevBusyRef.current = busy;
  }, [sending, members]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending) return;
    onSend(input);
    setInput('');
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

      {activities && activities.length > 0 && (
        <div className="mt-2">
          <ActivityIndicator activities={activities} members={members} />
        </div>
      )}

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
