/**
 * 消息角色类型
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * 消息状态类型
 */
export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

/**
 * 消息统计信息
 */
export interface MessageStats {
  /** 响应时间（毫秒） */
  responseTime: number;
  /** Token 总数 */
  tokenCount: number;
  /** 已接收内容长度 */
  contentLength?: number;
  /** 首字节时间（毫秒） */
  firstByteTime?: number;
  /** 完成 Token 数 */
  completionTokens?: number;
  /** 提示 Token 数 */
  promptTokens?: number;
}

/**
 * 消息对象
 */
export interface Message {
  /** 消息唯一标识 */
  id: string;
  /** 消息角色 */
  role: MessageRole;
  /** 消息内容 */
  content: string;
  /** 创建时间戳 */
  timestamp: number;
  /** 消息状态 */
  status: MessageStatus;
  /** 统计信息（仅 assistant 消息） */
  stats?: MessageStats;
}

/**
 * 创建消息的参数
 */
export interface CreateMessageParams {
  role: MessageRole;
  content: string;
  status?: MessageStatus;
}

/**
 * API 请求的消息格式
 */
export interface APIMessage {
  role: MessageRole;
  content: string;
}
