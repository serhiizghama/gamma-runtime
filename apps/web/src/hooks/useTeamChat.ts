import { useEffect, useState, useCallback } from 'react';
import { get, post, ApiError } from '../api/client';
import { useStore } from '../store/useStore';

export interface ChatMessage {
  id: string;
  team_id: string;
  role: 'user' | 'assistant' | 'system';
  agent_id: string | null;
  content: string;
  created_at: number;
}

export function useTeamChat(teamId: string | undefined) {
  const addNotification = useStore((s) => s.addNotification);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!teamId) return;
    try {
      setLoading(true);
      const data = await get<ChatMessage[]>(`/teams/${teamId}/chat`);
      setMessages(data);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch chat';
      addNotification({ type: 'error', message });
    } finally {
      setLoading(false);
    }
  }, [teamId, addNotification]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!teamId || !text.trim()) return;
      setSending(true);
      // Optimistically add user message
      const optimistic: ChatMessage = {
        id: `temp_${Date.now()}`,
        team_id: teamId,
        role: 'user',
        agent_id: null,
        content: text.trim(),
        created_at: Date.now(),
      };
      setMessages((prev) => [...prev, optimistic]);
      try {
        await post(`/teams/${teamId}/message`, { message: text.trim() });
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Failed to send message';
        addNotification({ type: 'error', message });
      } finally {
        setSending(false);
      }
    },
    [teamId, addNotification],
  );

  const appendMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      if (prev.find((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  return { messages, loading, sending, sendMessage, appendMessage, refetch: fetchHistory };
}
