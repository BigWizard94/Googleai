import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, GenerateContentResponse } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '10mb' }));

const apiKey = process.env.GEMINI_API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', hasApiKey: Boolean(process.env.GEMINI_API_KEY) });
});

// Chat streaming endpoint via Server-Sent Events (SSE)
app.post('/api/chat/stream', async (req, res) => {
  const { message, history = [], modelName = 'gemini-3.1-pro-preview' } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    const formattedHistory = (Array.isArray(history) ? history : []).map((msg: any) => ({
      role: msg.role === 'model' ? 'model' : 'user',
      parts: [{ text: String(msg.text || '') }],
    }));

    const chat = ai.chats.create({
      model: modelName,
      config: {
        systemInstruction:
          'You are a helpful, friendly AI assistant. Use Markdown for formatting. Be concise but thorough.',
      },
      history: formattedHistory,
    });

    const streamResponse = await chat.sendMessageStream({ message });

    for await (const chunk of streamResponse) {
      const c = chunk as GenerateContentResponse;
      const text = c.text || '';
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err: any) {
    console.error('Chat stream error:', err);
    let errorMsg = err?.message || 'Chat generation error';
    try {
      const parsed = JSON.parse(errorMsg);
      if (parsed?.error?.message) {
        try {
          const innerParsed = JSON.parse(parsed.error.message);
          errorMsg = innerParsed?.error?.message || parsed.error.message;
        } catch {
          errorMsg = parsed.error.message;
        }
      }
    } catch {}
    res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
    res.end();
  }
});

// Follow-up suggestions endpoint
app.post('/api/chat/suggestions', async (req, res) => {
  try {
    const { context = '' } = req.body;
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite-preview',
      contents: `Based on this chat context, suggest 3 short follow-up questions or topics. Return only a JSON array of strings. Context: ${context}`,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const suggestions = JSON.parse(response.text || '[]');
    res.json({ suggestions: Array.isArray(suggestions) ? suggestions : [] });
  } catch (err: any) {
    console.error('Suggestions error:', err);
    res.json({ suggestions: [] });
  }
});

// Summarize chat endpoint
app.post('/api/chat/summarize', async (req, res) => {
  try {
    const { messages = [] } = req.body;
    if (!messages.length) {
      return res.json({ title: 'New Chat' });
    }
    const text = messages
      .map((m: any) => `${m.role}: ${m.text}`)
      .join('\n')
      .slice(0, 1000);

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite-preview',
      contents: `Summarize this chat in 3-5 words for a title: \n${text}`,
    });

    res.json({ title: response.text?.trim() || 'Chat Session' });
  } catch (err: any) {
    console.error('Summarize error:', err);
    res.json({ title: 'Chat Session' });
  }
});

// Mount Vite middleware in dev or static files in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
