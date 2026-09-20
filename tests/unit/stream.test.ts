import { describe, it, expect, vi } from 'vitest';
import { StreamAccumulator, StreamHandler, toMessageStats } from '../../src/services/stream';

async function* createStream(chunks: string[], delay = 0): AsyncGenerator<string> {
  for (const chunk of chunks) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    yield chunk;
  }
}

function createCancellableStream(chunks: string[], signal: AbortSignal) {
      return (async function* () {
    for (const chunk of chunks) {
      if (signal.aborted) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield chunk;
    }
  })();
}

describe('StreamAccumulator', () => {
  it('所有入口按同一顺序累积得到同一份内容和长度', () => {
    const accumulator = new StreamAccumulator(100);

    const first = accumulator.append('你好', 110);
    const second = accumulator.append('，world', 125);
    const third = accumulator.append('123!', 140);

    expect(first).toBe('你好');
    expect(second).toBe('你好，world');
    expect(third).toBe('你好，world123!');
    expect(accumulator.getContent()).toBe(third);
    expect(third.length).toBe(accumulator.getStats(150).contentLength);
  });

  it('首字节、响应时间和 token 统计只由同一份累积结果计算', () => {
    const accumulator = new StreamAccumulator(100);
    accumulator.append('hello', 130);
    accumulator.append(' world', 180);

    const stats = accumulator.getStats(200);

    expect(stats.firstByteTime).toBe(30);
    expect(stats.responseTime).toBe(100);
    expect(stats.contentLength).toBe(11);
    expect(stats.tokenCount).toBeGreaterThan(0);
  });

  it('空内容的长度和 token 数均为零', () => {
    const stats = new StreamAccumulator(0).getStats(0);

    expect(stats.contentLength).toBe(0);
    expect(stats.tokenCount).toBe(0);
    expect(stats.firstByteTime).toBeUndefined();
  });
});

describe('StreamHandler', () => {
  it('完成时回调内容、累积器内容和统计长度一致', async () => {
    const handler = new StreamHandler();
    const chunks = ['你好', '，world', '123!'];
    const received: Array<{ chunk: string; content: string }> = [];
    const onComplete = vi.fn();

    await handler.start(createStream(chunks), {
      onChunk: (chunk, content) => received.push({ chunk, content }),
      onComplete,
      onError: (error) => {
        throw error;
      },
    });

    const expected = chunks.join('');
    expect(received.map((item) => item.chunk).join('')).toBe(expected);
    expect(received.at(-1)?.content).toBe(expected);
    expect(handler.getAccumulatedContent()).toBe('');

    const stats = onComplete.mock.calls[0]?.[0];
    expect(stats).toBeDefined();
    expect(stats?.contentLength).toBe(expected.length);
    expect(stats?.canceled).toBeUndefined();
    expect(toMessageStats(stats!).contentLength).toBe(expected.length);
  });

  it('取消后保留已接收内容，并返回截至取消时刻的统计', async () => {
    vi.useFakeTimers();
    const handler = new StreamHandler();
    const onComplete = vi.fn();
    const promise = handler.start(
      (signal) => createCancellableStream(['a', 'b', 'c'], signal),
      {
        onChunk: vi.fn(),
        onComplete,
        onError: vi.fn(),
      }
    );

    await vi.advanceTimersByTimeAsync(25);
    const result = handler.abort();
    await vi.advanceTimersByTimeAsync(10);
    await promise;
    vi.useRealTimers();

    expect(result).not.toBeNull();
    expect(result?.content).toBe('ab');
    expect(result?.stats.canceled).toBe(true);
    expect(result?.stats.contentLength).toBe(2);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('新一轮开始时清空上一轮内容和统计', async () => {
    const handler = new StreamHandler();
    let secondChunkContent = '';

    await handler.start(createStream(['first']), {
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    });

    await handler.start(createStream(['second']), {
      onChunk: (_chunk, content) => {
        secondChunkContent = content;
      },
      onComplete: (stats) => {
        expect(stats.contentLength).toBe('second'.length);
      },
      onError: (error) => {
        throw error;
      },
    });

    expect(secondChunkContent).toBe('second');
    expect(handler.getAccumulatedContent()).toBe('');
  });

  it('新流替换旧流时，旧流的完成回调不会污染新流', async () => {
    vi.useFakeTimers();
    const handler = new StreamHandler();
    const oldOnComplete = vi.fn();
    const newOnComplete = vi.fn();

    const oldPromise = handler.start(
      (signal) => createCancellableStream(['old-1', 'old-2'], signal),
      {
        onChunk: vi.fn(),
        onComplete: oldOnComplete,
        onError: vi.fn(),
      }
    );

    await vi.advanceTimersByTimeAsync(15);
    const newPromise = handler.start(
      (signal) => createCancellableStream(['new-1'], signal),
      {
        onChunk: vi.fn(),
        onComplete: newOnComplete,
        onError: vi.fn(),
      }
    );

    await vi.runAllTimersAsync();
    await Promise.all([oldPromise, newPromise]);
    vi.useRealTimers();

    expect(oldOnComplete).not.toHaveBeenCalled();
    expect(newOnComplete).toHaveBeenCalledTimes(1);
    expect(newOnComplete.mock.calls[0]?.[0].contentLength).toBe('new-1'.length);
  });

  it('流中的错误只触发 onError，不触发完成回调', async () => {
    const handler = new StreamHandler();
    const onComplete = vi.fn();
    const onError = vi.fn();
    const error = new Error('stream failed');

    async function* failedStream() {
      yield 'partial';
      throw error;
    }

    await handler.start(failedStream(), {
      onChunk: vi.fn(),
      onComplete,
      onError,
    });

    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(error);
  });
});
