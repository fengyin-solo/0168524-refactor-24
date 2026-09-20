import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { StreamHandler, createStreamHandler, type ResponseStats } from '../../src/services/stream';
import { estimateTokens } from '../../src/utils/tokenCounter';

/**
 * 根据片段数组构造一个异步生成器，模拟 API 流式响应
 */
async function* makeStream(chunks: string[]): AsyncGenerator<string, void, unknown> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

interface RunResult {
  stats: ResponseStats | null;
  error: Error | null;
}

/**
 * 跑完一次完整的流式处理，收集完成/错误回调
 */
async function runHandler(
  handler: StreamHandler,
  chunks: string[],
  onChunk?: (chunk: string) => void
): Promise<RunResult> {
  const result: RunResult = { stats: null, error: null };
  await handler.start(makeStream(chunks), {
    onChunk: (chunk) => onChunk?.(chunk),
    onComplete: (stats) => {
      result.stats = stats;
    },
    onError: (error) => {
      result.error = error;
    },
  });
  return result;
}

describe('StreamHandler（统一的流式路径）', () => {
  it('同一段回复的 token 计数与共享的 estimateTokens 完全一致（差额为零）', async () => {
    // 这段文本在旧的两套算法下结果不同（英文/数字的计法不一样）
    const chunks = ['hello', ' world', ' 12345', '，你好', '！'];
    const handler = createStreamHandler();

    const { stats, error } = await runHandler(handler, chunks);

    expect(error).toBeNull();
    const content = chunks.join('');
    expect(handler.getAccumulatedContent()).toBe(content);
    expect(stats).not.toBeNull();
    expect(stats!.tokenCount).toBe(estimateTokens(content));
    expect(stats!.tokenCount - estimateTokens(content)).toBe(0);
  });

  it('任意片段序列：累积内容与 token 计数都和共享算法一致', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.string(), { maxLength: 50 }), async (chunks) => {
        const handler = createStreamHandler();
        const { stats, error } = await runHandler(handler, chunks);

        expect(error).toBeNull();
        const content = chunks.join('');
        expect(handler.getAccumulatedContent()).toBe(content);
        expect(stats).not.toBeNull();
        expect(stats!.tokenCount).toBe(estimateTokens(content));
      })
    );
  });

  it('完成时给出响应时间与首字节时间', async () => {
    const handler = createStreamHandler();
    const { stats } = await runHandler(handler, ['a', 'b', 'c']);

    expect(stats).not.toBeNull();
    expect(stats!.responseTime).toBeGreaterThanOrEqual(0);
    expect(stats!.firstByteTime).toBeDefined();
    expect(stats!.firstByteTime!).toBeLessThanOrEqual(stats!.responseTime);
  });

  it('中途取消：保留已累积的内容，不触发完成/错误回调', async () => {
    const handler = createStreamHandler();
    const received: string[] = [];

    const result = await runHandler(handler, ['第一', '第二', '第三'], (chunk) => {
      received.push(chunk);
      // 收到第二个片段后取消
      if (received.length === 2) {
        handler.abort();
      }
    });

    expect(result.stats).toBeNull();
    expect(result.error).toBeNull();
    // 已收到的内容被保留
    expect(handler.getAccumulatedContent()).toBe('第一第二');
  });

  it('接着发下一条：不会把上一条的累积与统计带过来', async () => {
    const handler = createStreamHandler();

    const first = await runHandler(handler, ['上一条回复的内容']);
    expect(first.stats).not.toBeNull();

    const second = await runHandler(handler, ['新内容']);
    expect(second.stats).not.toBeNull();

    // 累积内容被重置，只包含本次回复
    expect(handler.getAccumulatedContent()).toBe('新内容');
    // 统计只针对本次回复计算
    expect(second.stats!.tokenCount).toBe(estimateTokens('新内容'));
    // 上一条的统计对象不受影响
    expect(first.stats!.tokenCount).toBe(estimateTokens('上一条回复的内容'));
  });

  it('空流：统计为零值，不报错', async () => {
    const handler = createStreamHandler();
    const { stats, error } = await runHandler(handler, []);

    expect(error).toBeNull();
    expect(stats).not.toBeNull();
    expect(stats!.tokenCount).toBe(0);
    expect(stats!.firstByteTime).toBeUndefined();
  });
});
