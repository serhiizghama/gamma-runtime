import { classifyGatewayEventKind, isReasoningStream } from './event-classifier';

describe('classifyGatewayEventKind', () => {
  it('classifies "agent" as runtime-agent', () => {
    expect(classifyGatewayEventKind('agent')).toBe('runtime-agent');
  });

  it('classifies "chat" as runtime-chat', () => {
    expect(classifyGatewayEventKind('chat')).toBe('runtime-chat');
  });

  it('classifies "presence" as summary-refresh', () => {
    expect(classifyGatewayEventKind('presence')).toBe('summary-refresh');
  });

  it('classifies "heartbeat" as summary-refresh', () => {
    expect(classifyGatewayEventKind('heartbeat')).toBe('summary-refresh');
  });

  it('classifies unknown events as ignore', () => {
    expect(classifyGatewayEventKind('unknown')).toBe('ignore');
    expect(classifyGatewayEventKind('')).toBe('ignore');
    expect(classifyGatewayEventKind('system')).toBe('ignore');
  });
});

describe('isReasoningStream', () => {
  it('returns true for "thinking"', () => {
    expect(isReasoningStream('thinking')).toBe(true);
  });

  it('returns true for reasoning-related streams', () => {
    expect(isReasoningStream('reasoning')).toBe(true);
    expect(isReasoningStream('analysis')).toBe(true);
    expect(isReasoningStream('trace')).toBe(true);
    expect(isReasoningStream('deep-thinking')).toBe(true);
  });

  it('returns false for "assistant"', () => {
    expect(isReasoningStream('assistant')).toBe(false);
  });

  it('returns false for "tool"', () => {
    expect(isReasoningStream('tool')).toBe(false);
  });

  it('returns false for "lifecycle"', () => {
    expect(isReasoningStream('lifecycle')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isReasoningStream('')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isReasoningStream('THINKING')).toBe(true);
    expect(isReasoningStream('Analysis')).toBe(true);
  });
});
