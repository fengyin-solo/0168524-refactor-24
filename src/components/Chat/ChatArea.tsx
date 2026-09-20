import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
import { useChat } from '../../hooks/useChat';
import './ChatArea.css';

/**
 * 聊天区域主组件
 * 发送 / 停止等流式逻辑统一走 useChat 的共同路径
 */
export function ChatArea() {
  const { messages, isStreaming, streamingMessageId, sendMessage, stopStreaming } = useChat();

  return (
    <div className="chat-area">
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        streamingMessageId={streamingMessageId}
      />
      <InputArea
        onSend={sendMessage}
        onStop={stopStreaming}
        isLoading={false}
        isStreaming={isStreaming}
        disabled={false}
      />
    </div>
  );
}
