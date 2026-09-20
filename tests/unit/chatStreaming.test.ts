import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { useChatStore } from '../../src/stores/chatStore';
import { createStreamHandler, toMessageStats, type ResponseStats } from '../../src/services/stream';
import { estimateTokens } from '../../src/utils/tokenCounter';

/**
 * 根据片段数组构造一个异步生成器，模拟 API 流式响应
 */
async function* makeStream(chunks: string[]): AsyncGenerator<string, void, unknown> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

/**
 * 按照 useChat 的共同路径接线：
 * startStreaming 开始一条流式响应，
 * 一个 StreamHandler + chatStore，onChunk 累积、onComplete 写入统计
 */
async function runCommonPath(chunks: string[], abortAfterChunks?: number) {
  const handler = createStreamHandler();
  let received = 0;
  const result: { completed: ResponseStats | null } = { completed: null };

  const conversationId = useChatStore.getState().activeConversationId!;
  useChatStore.getState().startStreaming(conversationId);

  await handler.start(makeStream(chunks), {
    onChunk: (chunk) => {
      useChatStore.getState().appendStreamContent(chunk);
      received += 1;
      if (abortAfterChunks !== undefined && received === abortAfterChunks) {
        handler.abort();
      }
    },
    onComplete: (stats) => {
      result.completed = stats;
      useChatStore.getState().finishStreaming(toMessageStats(stats));
    },
    onError: () => {
      useChatStore.getState().cancelStreaming();
    },
  });

  return { handler, completed: result.completed };
}

function getStreamingMessage() {
  const state = useChatStore.getState();
  const conversation = state.conversations.find((c) => c.id === state.activeConversationId);
  return conversation?.messages.find((m) => m.role === 'assistant');
}

describe('流式响应的共同路径（StreamHandler + chatStore）', () => {
  beforeAll(() => {
    // node 环境下 stub localStorage，避免持久化报错
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const key of Object.keys(store)) {
          delete store[key];
        }
      },
    });
  });

  beforeEach(() => {
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isStreaming: false,
      streamingContent: '',
      streamingMessageId: null,
      initialized: true,
    });
    useChatStore.getState().createConversation();
  });

  it('两个累积方同时累积时拿到同样的结果与统计（差额为零）', async () => {
    const chunks = ['你好', '，这是', '一段回复 123', '。'];
    const { handler, completed } = await runCommonPath(chunks);

    const content = chunks.join('');
    const message = getStreamingMessage();

    // handler 与 store 两处累积的结果一致
    expect(handler.getAccumulatedContent()).toBe(content);
    expect(message?.content).toBe(content);
    expect(message?.content).toBe(handler.getAccumulatedContent());

    // 统计只计算一次，且与共享算法的差额为零
    expect(completed).not.toBeNull();
    expect(message?.status).toBe('complete');
    expect(message?.stats?.tokenCount).toBe(estimateTokens(content));
    expect(message?.stats?.tokenCount! - estimateTokens(content)).toBe(0);
    expect(message?.stats?.responseTime).toBe(completed!.responseTime);
    expect(message?.stats?.responseTime).toBeGreaterThanOrEqual(0);

    // 流式状态被复位
    const state = useChatStore.getState();
    expect(state.isStreaming).toBe(false);
    expect(state.streamingContent).toBe('');
    expect(state.streamingMessageId).toBeNull();
  });

  it('中途取消：保留已经收到的内容', async () => {
    const chunks = ['第一', '第二', '第三', '第四'];
    const { handler, completed } = await runCommonPath(chunks, 2);

    // 取消后不再触发完成回调
    expect(completed).toBeNull();

    // 模拟入口在 abort 后的收尾
    useChatStore.getState().cancelStreaming();

    const message = getStreamingMessage();
    expect(handler.getAccumulatedContent()).toBe('第一第二');
    expect(message?.content).toBe('第一第二');
    expect(message?.status).toBe('error');

    const state = useChatStore.getState();
    expect(state.isStreaming).toBe(false);
    expect(state.streamingContent).toBe('');
  });

  it('接着发下一条：不会把上一条的统计带过来，已完成的回复保持不变', async () => {
    // 第一条回复
    const firstChunks = ['第一条', '回复 abc'];
    const first = await runCommonPath(firstChunks);
    const firstContent = firstChunks.join('');
    const firstMessage = getStreamingMessage();
    const firstStats = firstMessage?.stats;
    expect(first.handler.getAccumulatedContent()).toBe(firstContent);
    expect(firstMessage?.content).toBe(firstContent);
    expect(firstStats?.tokenCount).toBe(estimateTokens(firstContent));

    // 第二条回复（同一个会话、同一个入口）
    const secondChunks = ['第二条', '完全不同的内容 98765'];
    const second = await runCommonPath(secondChunks);
    const secondContent = secondChunks.join('');

    const state = useChatStore.getState();
    const conversationId = state.activeConversationId!;
    const conversation = state.conversations.find((c) => c.id === conversationId);
    const assistantMessages = conversation?.messages.filter((m) => m.role === 'assistant');
    expect(assistantMessages).toHaveLength(2);

    const firstMsg = assistantMessages![0]!;
    const secondMsg = assistantMessages![1]!;
    // 已完成的回复与统计保持不变
    expect(firstMsg.content).toBe(firstContent);
    expect(firstMsg.stats).toEqual(firstStats);
    // 新一条只携带自己的统计
    expect(second.handler.getAccumulatedContent()).toBe(secondContent);
    expect(secondMsg.content).toBe(secondContent);
    expect(secondMsg.stats?.tokenCount).toBe(estimateTokens(secondContent));
    expect(secondMsg.stats?.tokenCount).not.toBe(
      estimateTokens(firstContent + secondContent)
    );
  });
});
