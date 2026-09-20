import { useCallback, useRef } from 'react';
import { message } from 'antd';
import { useChatStore } from '../stores/chatStore';
import { useConfigStore } from '../stores/configStore';
import { useUIStore } from '../stores/uiStore';
import { sendMessageStream } from '../services/api';
import { createStreamHandler, toMessageStats, type StreamAbortResult } from '../services/stream';
import { parseError, logError, shouldShowConfigPanel } from '../services/errorHandler';
import type { APIMessage } from '../types';

/**
 * 聊天功能 Hook
 */
export function useChat() {
  const {
    conversations,
    activeConversationId,
    isStreaming,
    streamingMessageId,
    getActiveConversation,
    createConversation,
    deleteConversation,
    setActiveConversation,
    addMessage,
    startStreaming,
    appendStreamContent,
    finishStreaming,
    cancelStreaming,
  } = useChatStore();

  const { config, isValid: isConfigValid } = useConfigStore();
  const { setConfigPanelVisible } = useUIStore();
  const streamHandlerRef = useRef(createStreamHandler());
  const conversation = getActiveConversation();
  const messages = conversation?.messages || [];

  /**
   * 发送消息
   */
  const sendMessage = useCallback(
    async (content: string) => {
      if (!isConfigValid) {
        message.warning('请先配置 API Key');
        setConfigPanelVisible(true);
        return;
      }

      const conversationId = activeConversationId ?? createConversation();

      // 从 store 读取添加本轮用户消息之前的历史，避免闭包中的 messages 少一轮
      const historyMessages =
        useChatStore
          .getState()
          .conversations.find((conv) => conv.id === conversationId)?.messages ?? [];

      // 添加用户消息
      addMessage(conversationId, {
        role: 'user',
        content,
        status: 'complete',
      });

      // 准备 API 消息
      const apiMessages: APIMessage[] = [
        ...historyMessages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        { role: 'user' as const, content },
      ];

      // 开始流式响应
      startStreaming(conversationId);

      const showStreamError = (error: unknown, source: string) => {
        const appError = parseError(error);
        logError(appError, source);
        message.error(appError.message);
        cancelStreaming();

        if (shouldShowConfigPanel(appError)) {
          setConfigPanelVisible(true);
        }
      };

      try {
        await streamHandlerRef.current.start(
          (signal) =>
            sendMessageStream(
              apiMessages,
              {
                ...config,
                stream: true,
              },
              signal
            ),
          {
            onChunk: (chunk, fullContent) => {
              appendStreamContent(chunk, fullContent);
            },
            onComplete: (stats) => {
              finishStreaming(toMessageStats(stats));
            },
            onError: (error) => {
              showStreamError(error, 'useChat.sendMessage');
            },
          }
        );
      } catch (error) {
        showStreamError(error, 'useChat.sendMessage');
      }
    },
    [
      activeConversationId,
      isConfigValid,
      config,
      createConversation,
      addMessage,
      startStreaming,
      appendStreamContent,
      finishStreaming,
      cancelStreaming,
      setConfigPanelVisible,
    ]
  );

  /**
   * 停止流式响应
   */
  const stopStreaming = useCallback(() => {
    const result: StreamAbortResult | null = streamHandlerRef.current.abort();

    if (result) {
      // 使用共同累积结果收尾，保留已收到的内容，并维持原有的取消样式
      cancelStreaming(result.content);
      message.info('已停止响应');
    }
  }, [cancelStreaming]);

  /**
   * 创建新对话并发送消息
   */
  const startNewChat = useCallback(
    async (content?: string) => {
      const id = createConversation();
      if (content) {
        await sendMessage(content);
      }
      return id;
    },
    [createConversation, sendMessage]
  );

  return {
    // State
    conversations,
    activeConversationId,
    conversation,
    messages,
    isStreaming,
    streamingMessageId,
    isConfigValid,

    // Actions
    sendMessage,
    stopStreaming,
    startNewChat,
    createConversation,
    deleteConversation,
    setActiveConversation,
  };
}
