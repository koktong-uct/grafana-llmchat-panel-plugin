type SeriesSize = 'sm' | 'md' | 'lg';

export const DEFAULT_CHAT_ENDPOINT = '/api/plugin-proxy/uct-llmchat-app/chat';

export interface SimpleOptions {
  chatEndpoint?: string;
  text: string;
  showSeriesCount: boolean;
  seriesCountSize: SeriesSize;
}
