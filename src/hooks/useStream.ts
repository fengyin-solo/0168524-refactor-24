import { useState, useCallback, useRef, useEffect } from 'react';
import { StreamHandler, type ResponseStats, type StreamSource } from '../services/stream';

interface UseStreamOptions {
  onChunk?: (chunk: string, content: string) => void;
  onComplete?: (stats: ResponseStats) => void;
  onError?: (error: Error) => void;
}

interface UseStreamReturn {
  isStreaming: boolean;
  content: string;
  stats: ResponseStats | null;
  error: Error | null;
  start: (stream: StreamSource) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

/**
 * 流式响应处理 Hook
 */
export function useStream(options: UseStreamOptions = {}): UseStreamReturn {
  const [isStreaming, setIsStreaming] = useState(false);
  const [content, setContent] = useState('');
  const [stats, setStats] = useState<ResponseStats | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const handlerRef = useRef<StreamHandler | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  if (!handlerRef.current) {
    handlerRef.current = new StreamHandler();
  }

  const start = useCallback(async (stream: StreamSource) => {
    // 每一轮都从空白状态开始，避免上一条回复的内容或统计残留
    setIsStreaming(true);
    setContent('');
    setStats(null);
    setError(null);

    await handlerRef.current?.start(stream, {
      onChunk: (chunk, fullContent) => {
        setContent(fullContent);
        optionsRef.current.onChunk?.(chunk, fullContent);
      },
      onComplete: (responseStats) => {
        setStats(responseStats);
        setIsStreaming(false);
        optionsRef.current.onComplete?.(responseStats);
      },
      onError: (err) => {
        setError(err);
        setIsStreaming(false);
        optionsRef.current.onError?.(err);
      },
    });
  }, []);

  const stop = useCallback(() => {
    const result = handlerRef.current?.abort();
    if (result) {
      // 取消不清空已经收到的内容；下一次 start 会重新初始化
      setContent(result.content);
      setStats(result.stats);
      setIsStreaming(false);
    }
  }, []);

  const reset = useCallback(() => {
    handlerRef.current?.abort();
    setIsStreaming(false);
    setContent('');
    setStats(null);
    setError(null);
  }, []);

  return {
    isStreaming,
    content,
    stats,
    error,
    start,
    stop,
    reset,
  };
}
