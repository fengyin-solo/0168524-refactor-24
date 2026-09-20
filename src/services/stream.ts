import type { MessageStats } from '../types';
import { estimateTokens } from '../utils/tokenCounter';

/**
 * 响应统计信息
 */
export interface ResponseStats {
  /** 响应时间（毫秒） */
  responseTime: number;
  /** 估算的 Token 数量 */
  tokenCount: number;
  /** 已接收内容长度 */
  contentLength: number;
  /** 首字节时间（毫秒） */
  firstByteTime?: number;
  /** 是否由取消操作收尾 */
  canceled?: boolean;
}

/**
 * 流处理器回调
 */
export interface StreamCallbacks {
  /** 收到内容片段时调用，第二个参数为当前完整内容 */
  onChunk: (chunk: string, content: string) => void;
  /** 流完成时调用 */
  onComplete: (stats: ResponseStats) => void;
  /** 发生错误时调用 */
  onError: (error: Error) => void;
}

export type AsyncStream = AsyncGenerator<string, void, unknown>;
export type StreamFactory = (signal: AbortSignal) => AsyncStream | Promise<AsyncStream>;
export type StreamSource = AsyncStream | StreamFactory;

export interface StreamAbortResult {
  content: string;
  stats: ResponseStats;
}

/**
 * 流式内容累积器
 * 所有入口共用同一份内容、长度和时间统计逻辑
 */
export class StreamAccumulator {
  private readonly startTime: number;
  private firstByteTime: number | null = null;
  private accumulatedContent = '';

  constructor(startTime: number = Date.now()) {
    this.startTime = startTime;
  }

  append(chunk: string, receiveTime: number = Date.now()): string {
    if (this.firstByteTime === null) {
      this.firstByteTime = receiveTime - this.startTime;
    }

    this.accumulatedContent += chunk;
    return this.accumulatedContent;
  }

  getContent(): string {
    return this.accumulatedContent;
  }

  getStats(endTime: number = Date.now(), canceled = false): ResponseStats {
    const stats: ResponseStats = {
      responseTime: endTime - this.startTime,
      tokenCount: estimateTokens(this.accumulatedContent),
      contentLength: this.accumulatedContent.length,
      firstByteTime: this.firstByteTime ?? undefined,
    };

    if (canceled) {
      stats.canceled = true;
    }

    return stats;
  }
}

interface ActiveStream {
  controller: AbortController;
  accumulator: StreamAccumulator;
}

/**
 * 流处理器类
 * 管理流式响应的生命周期
 */
export class StreamHandler {
  private activeStream: ActiveStream | null = null;

  /**
   * 开始处理流
   * @param streamOrFactory 异步迭代器，或接收 AbortSignal 后创建迭代器的工厂
   * @param callbacks 回调函数
   */
  async start(
    streamOrFactory: StreamSource,
    callbacks: StreamCallbacks
  ): Promise<void> {
    // 新的一轮开始时完全替换旧状态，避免上一条回复的统计或内容带入本轮
    if (this.activeStream) {
      this.activeStream.controller.abort();
    }

    const controller = new AbortController();
    const accumulator = new StreamAccumulator();
    const currentStream: ActiveStream = { controller, accumulator };
    this.activeStream = currentStream;

    try {
      const stream =
        typeof streamOrFactory === 'function'
          ? await streamOrFactory(controller.signal)
          : streamOrFactory;

      for await (const chunk of stream) {
        if (currentStream.controller.signal.aborted) {
          break;
        }

        const content = accumulator.append(chunk);
        callbacks.onChunk(chunk, content);
      }

      if (
        this.activeStream === currentStream &&
        !currentStream.controller.signal.aborted
      ) {
        callbacks.onComplete(accumulator.getStats());
      }
    } catch (error) {
      if (
        this.activeStream === currentStream &&
        !currentStream.controller.signal.aborted
      ) {
        callbacks.onError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      if (this.activeStream === currentStream) {
        this.activeStream = null;
      }
    }
  }

  /**
   * 中止当前流，并返回已经累积的内容和截至取消时刻的统计
   */
  abort(): StreamAbortResult | null {
    const currentStream = this.activeStream;
    if (!currentStream) {
      return null;
    }

    const { controller, accumulator } = currentStream;
    const result = {
      content: accumulator.getContent(),
      stats: accumulator.getStats(Date.now(), true),
    };

    controller.abort();
    this.activeStream = null;

    return result;
  }

  /**
   * 检查流是否正在处理
   */
  getIsActive(): boolean {
    return this.activeStream !== null;
  }

  /**
   * 获取当前流已累积的内容
   */
  getAccumulatedContent(): string {
    return this.activeStream?.accumulator.getContent() ?? '';
  }
}

/**
 * 创建流处理器实例
 */
export function createStreamHandler(): StreamHandler {
  return new StreamHandler();
}

/**
 * 将 ResponseStats 转换为 MessageStats
 */
export function toMessageStats(stats: ResponseStats): MessageStats {
  return {
    responseTime: stats.responseTime,
    tokenCount: stats.tokenCount,
    contentLength: stats.contentLength,
    firstByteTime: stats.firstByteTime,
  };
}
