import { useState, useRef, useEffect } from 'react';
import { ChatMessage } from './ChatMessage';
import type { ChatMessage as ChatMsg } from '../hooks/useTeamChat';
import type { Agent } from '../store/useStore';

interface Props {
  messages: ChatMsg[];
  loading: boolean;
  sending: boolean;
  members: Agent[];
  onSend: (text: string) => void;
}

export function ChatPanel({ messages, loading, sending, members, onSend }: Props) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending) return;
    onSend(input);
    setInput('');
  };

  const agentNames = new Map(members.map((m) => [m.id, `${m.avatar_emoji} ${m.name}`]));

  return (
    <div className="flex h-full flex-col">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-500">Chat</h3>

      <div className="flex-1 space-y-3 overflow-y-auto overflow-x-hidden">
        {loading ? (
          <div className="text-sm text-gray-500">Loading chat...</div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-600">
            Send a message to the team leader
          </div>
        ) : (
          messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              message={msg}
              agentName={msg.agent_id ? agentNames.get(msg.agent_id) : undefined}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message the team..."
          disabled={sending}
          className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
        >
          {sending ? '...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
