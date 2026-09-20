import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { estimateTokens } from '../../src/utils/tokenCounter';
import { useChatStore } from '../../src/stores/chatStore';

vi.mock('../../src/services/storage', () => ({
  loadConversations: () => [],
  saveConversations: vi.fn(),
}));

describe('chatStore 流式状态', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isStreaming: false,
      streamingContent: '',
      streamingMessageId: null,
      initialized: true,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('外部流式累积器传入的完整内容就是消息内容，不再二次拼接', () => {
    const conversationId = useChatStore.getState().createConversation();
    useChatStore.getState().startStreaming(conversationId);
    useChatStore.getState().appendStreamContent('a', 'a');
    useChatStore.getState().appendStreamContent('b', 'ab');

    const state = useChatStore.getState();
    const message = state.conversations.find((conv) => conv.id === conversationId)
      ?.messages[0];

    expect(state.streamingContent).toBe('ab');
    expect(message?.content).toBe('ab');
    expect(message?.content.length).toBe(2);
  });

  it('取消时保留已接收内容；新一轮开始时不携带旧内容', () => {
    const firstConversationId = useChatStore.getState().createConversation();
    useChatStore.getState().startStreaming(firstConversationId);
    useChatStore.getState().appendStreamContent('保留', '保留');
    useChatStore.getState().cancelStreaming();

    const firstState = useChatStore.getState();
    const firstMessage = firstState.conversations.find(
      (conv) => conv.id === firstConversationId
    )?.messages[0];

    expect(firstMessage?.content).toBe('保留');
    expect(firstMessage?.status).toBe('error');
    expect(firstState.streamingContent).toBe('');
    expect(firstState.streamingMessageId).toBeNull();
    expect(firstState.isStreaming).toBe(false);

    const secondConversationId = useChatStore.getState().createConversation();
    useChatStore.getState().startStreaming(secondConversationId);

    const secondState = useChatStore.getState();
    const secondMessage = secondState.conversations.find(
      (conv) => conv.id === secondConversationId
    )?.messages[0];

    expect(secondState.streamingContent).toBe('');
    expect(secondMessage?.content).toBe('');
    expect(secondMessage?.stats).toBeUndefined();
  });

  it('完成时内容长度与统计 token 均以最终内容为准', () => {
    const conversationId = useChatStore.getState().createConversation();
    useChatStore.getState().startStreaming(conversationId);

    const finalContent = 'hello world';
    useChatStore.getState().appendStreamContent('ignored-chunk', finalContent);
    useChatStore.getState().finishStreaming(
      {
        responseTime: 12,
        tokenCount: estimateTokens(finalContent),
        contentLength: finalContent.length,
      },
      finalContent
    );

    const state = useChatStore.getState();
    const message = state.conversations.find((conv) => conv.id === conversationId)
      ?.messages[0];

    expect(message?.content).toBe(finalContent);
    expect(message?.status).toBe('complete');
    expect(message?.stats?.contentLength).toBe(finalContent.length);
    expect(state.streamingContent).toBe('');
  });
});
