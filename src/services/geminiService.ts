import { Message } from '../types';

export const PRO_MODEL = 'gemini-3.1-pro-preview';
export const FLASH_LITE_MODEL = 'gemini-3.1-flash-lite-preview';

export async function* sendMessageStream(
  message: string,
  history: Message[] = [],
  modelName: string = PRO_MODEL
): AsyncGenerator<string, void, unknown> {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, history, modelName }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Server error: ${response.status}`);
  }

  if (!response.body) {
    throw new Error('ReadableStream not supported');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const event of events) {
        const line = event.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;

        try {
          const parsed = JSON.parse(payload);
          if (parsed.error) {
            throw new Error(parsed.error);
          }
          if (parsed.text) {
            yield parsed.text;
          }
        } catch (e: any) {
          if (e.message && !e.message.includes('JSON')) {
            throw e;
          }
        }
      }
    }

    if (buffer.trim()) {
      const line = buffer.trim();
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (payload !== '[DONE]') {
          try {
            const parsed = JSON.parse(payload);
            if (parsed.text) yield parsed.text;
          } catch {}
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function generateSuggestions(context: string): Promise<string[]> {
  try {
    const response = await fetch('/api/chat/suggestions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ context }),
    });

    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.suggestions) ? data.suggestions : [];
  } catch (error) {
    console.error('Failed to generate suggestions:', error);
    return [];
  }
}

export async function summarizeChat(messages: Message[]): Promise<string> {
  if (messages.length === 0) return 'New Chat';

  try {
    const response = await fetch('/api/chat/summarize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages }),
    });

    if (!response.ok) return 'Chat Session';
    const data = await response.json();
    return data.title || 'Chat Session';
  } catch (error) {
    console.error('Failed to summarize chat:', error);
    return 'Chat Session';
  }
}
