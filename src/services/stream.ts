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
  /** 首字节时间（毫秒） */
  firstByteTime?: number;
}

/**
 * 流处理器回调
 */
export interface StreamCallbacks {
  /** 收到内容片段时调用 */
  onChunk: (chunk: string) => void;
  /** 流完成时调用 */
  onComplete: (stats: ResponseStats) => void;
  /** 发生错误时调用 */
  onError: (error: Error) => void;
}

/**
 * 流处理器类
 * 管理流式响应的生命周期
 */
export class StreamHandler {
  private abortController: AbortController | null = null;
  private isActive = false;
  private startTime = 0;
  private firstByteTime: number | null = null;
  private accumulatedContent = '';

  /**
   * 开始处理流
   * @param stream 异步迭代器
   * @param callbacks 回调函数
   */
  async start(
    stream: AsyncGenerator<string, void, unknown>,
    callbacks: StreamCallbacks
  ): Promise<void> {
    if (this.isActive) {
      this.abort();
    }

    this.abortController = new AbortController();
    this.isActive = true;
    this.startTime = Date.now();
    this.firstByteTime = null;
    this.accumulatedContent = '';

    try {
      for await (const chunk of stream) {
        // 检查是否已中止
        if (this.abortController?.signal.aborted) {
          break;
        }

        // 记录首字节时间
        if (this.firstByteTime === null) {
          this.firstByteTime = Date.now() - this.startTime;
        }

        this.accumulatedContent += chunk;
        callbacks.onChunk(chunk);
      }

      // 流正常完成
      if (!this.abortController?.signal.aborted) {
        const stats = this.calculateStats();
        callbacks.onComplete(stats);
      }
    } catch (error) {
      if (!this.abortController?.signal.aborted) {
        callbacks.onError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      this.isActive = false;
      this.abortController = null;
    }
  }

  /**
   * 中止当前流
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.isActive = false;
    }
  }

  /**
   * 检查流是否正在处理
   */
  getIsActive(): boolean {
    return this.isActive;
  }

  /**
   * 获取已累积的内容
   */
  getAccumulatedContent(): string {
    return this.accumulatedContent;
  }

  /**
   * 计算响应统计信息
   * Token 估算统一使用 utils/tokenCounter 中的实现，
   * 保证与应用中其他地方对同一段文本的计数结果一致
   */
  private calculateStats(): ResponseStats {
    const responseTime = Date.now() - this.startTime;
    const tokenCount = estimateTokens(this.accumulatedContent);

    return {
      responseTime,
      tokenCount,
      firstByteTime: this.firstByteTime ?? undefined,
    };
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
  };
}
