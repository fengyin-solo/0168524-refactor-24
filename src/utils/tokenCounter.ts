import type { Message, APIMessage } from '../types';

/**
 * Token 计数结果
 */
export interface TokenCountResult {
  /** 总 Token 数 */
  total: number;
  /** 按消息分类的 Token 数 */
  byMessage: number[];
}

/**
 * 估算文本的 Token 数量
 * 
 * 这是一个简化的估算方法，基于以下规则：
 * - 英文单词约 1 token
 * - 中文字符约 2 token
 * - 标点符号约 1 token
 * - 空格不计入
 * 
 * 注意：这只是估算，实际 Token 数量取决于具体的 tokenizer
 * 
 * @param text 文本内容
 * @returns 估算的 Token 数量
 */
export function estimateTokens(text: string): number {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  
  let tokenCount = 0;
  
  // 匹配中文字符
  const chineseChars = text.match(/[\u4e00-\u9fff]/g);
  if (chineseChars) {
    // 中文字符通常需要 2 个 token
    tokenCount += chineseChars.length * 2;
  }
  
  // 匹配英文单词
  const englishWords = text.match(/[a-zA-Z]+/g);
  if (englishWords) {
    // 英文单词通常是 1 个 token，长单词可能更多
    tokenCount += englishWords.reduce((sum, word) => {
      return sum + Math.ceil(word.length / 4);
    }, 0);
  }
  
  // 匹配数字
  const numbers = text.match(/\d+/g);
  if (numbers) {
    tokenCount += numbers.reduce((sum, num) => {
      return sum + Math.ceil(num.length / 3);
    }, 0);
  }
  
  // 匹配标点符号和特殊字符
  const punctuation = text.match(/[^\w\s\u4e00-\u9fff]/g);
  if (punctuation) {
    tokenCount += punctuation.length;
  }
  
  return tokenCount;
}

/**
 * 估算消息数组的总 Token 数量
 * @param messages 消息数组
 * @returns Token 计数结果
 */
export function estimateMessagesTokens(messages: Message[] | APIMessage[]): TokenCountResult {
  const byMessage = messages.map(msg => estimateTokens(msg.content));
  const total = byMessage.reduce((sum, count) => sum + count, 0);
  
  // 添加消息格式开销（每条消息约 4 token）
  const overhead = messages.length * 4;
  
  return {
    total: total + overhead,
    byMessage,
  };
}

/**
 * 检查消息是否超过 Token 限制
 * @param messages 消息数组
 * @param maxTokens 最大 Token 数
 * @returns 是否超过限制
 */
export function isOverTokenLimit(messages: Message[] | APIMessage[], maxTokens: number): boolean {
  const { total } = estimateMessagesTokens(messages);
  return total > maxTokens;
}

/**
 * 截断消息以适应 Token 限制
 * 保留最新的消息，移除较早的消息
 * 
 * @param messages 消息数组
 * @param maxTokens 最大 Token 数
 * @param reserveForResponse 为响应预留的 Token 数
 * @returns 截断后的消息数组
 */
export function truncateMessagesToFit<T extends Message | APIMessage>(
  messages: T[],
  maxTokens: number,
  reserveForResponse: number = 1000
): T[] {
  const availableTokens = maxTokens - reserveForResponse;
  
  if (availableTokens <= 0) {
    return [];
  }
  
  // 从最新的消息开始，逐步添加
  const result: T[] = [];
  let currentTokens = 0;
  
  // 反向遍历，保留最新的消息
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    
    const msgTokens = estimateTokens(msg.content) + 4; // 加上消息格式开销
    
    if (currentTokens + msgTokens <= availableTokens) {
      result.unshift(msg);
      currentTokens += msgTokens;
    } else {
      break;
    }
  }
  
  return result;
}

/**
 * 获取 Token 使用情况摘要
 * @param promptTokens 提示 Token 数
 * @param completionTokens 完成 Token 数
 * @returns 摘要字符串
 */
export function getTokenUsageSummary(promptTokens: number, completionTokens: number): string {
  const total = promptTokens + completionTokens;
  return `提示: ${promptTokens} | 完成: ${completionTokens} | 总计: ${total}`;
}
