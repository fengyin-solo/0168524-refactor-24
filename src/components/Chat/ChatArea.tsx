import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
import { useChat } from '../../hooks/useChat';
import './ChatArea.css';

/**
 * 聊天区域主组件
 */
export function ChatArea() {
  const {
    messages,
    isStreaming,
    streamingMessageId,
    sendMessage,
    stopStreaming,
  } = useChat();

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
