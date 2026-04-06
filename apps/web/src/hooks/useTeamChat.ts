import { useEffect, useState, useCallback, useRef } from 'react';
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

const PAGE_SIZE = 20;

export function useTeamChat(teamId: string | undefined) {
  const addNotification = useStore((s) => s.addNotification);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const initialLoadDone = useRef(false);

  // Load latest messages (initial load)
  const fetchLatest = useCallback(async () => {
    if (!teamId) return;
    try {
      setLoading(true);
      const data = await get<ChatMessage[]>(`/teams/${teamId}/chat?limit=${PAGE_SIZE}`);
      setMessages(data);
      setHasMore(data.length >= PAGE_SIZE);
      initialLoadDone.current = true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch chat';
      addNotification({ type: 'error', message });
    } finally {
      setLoading(false);
    }
  }, [teamId, addNotification]);

  useEffect(() => {
    initialLoadDone.current = false;
    fetchLatest();
  }, [fetchLatest]);

  // Load older messages (infinite scroll up)
  const loadMore = useCallback(async () => {
    if (!teamId || loadingMore || !hasMore || messages.length === 0) return;
    const oldest = messages[0];
    try {
      setLoadingMore(true);
      const data = await get<ChatMessage[]>(
        `/teams/${teamId}/chat?limit=${PAGE_SIZE}&before=${oldest.created_at}`,
      );
      if (data.length < PAGE_SIZE) setHasMore(false);
      if (data.length > 0) {
        setMessages((prev) => {
          // Deduplicate
          const existingIds = new Set(prev.map((m) => m.id));
          const newMsgs = data.filter((m) => !existingIds.has(m.id));
          return [...newMsgs, ...prev];
        });
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load more messages';
      addNotification({ type: 'error', message });
    } finally {
      setLoadingMore(false);
    }
  }, [teamId, messages, loadingMore, hasMore, addNotification]);

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

  return {
    messages,
    loading,
    sending,
    hasMore,
    loadingMore,
    sendMessage,
    appendMessage,
    loadMore,
    refetch: fetchLatest,
  };
}
