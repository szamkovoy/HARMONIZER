/**
 * Локальное состояние сессии чата (типы для расширения store при необходимости).
 */

import type { CommunicatorHistoryMessage } from "../core/types";

export interface CommunicatorChatSession {
  messages: CommunicatorHistoryMessage[];
  revision: number;
}
