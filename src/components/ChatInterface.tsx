import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, Bot, User, Loader2, Sparkles, Trash2, PlusCircle, MessageSquare, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Message, ChatSession } from '../types';
import { sendMessageStream, generateSuggestions, summarizeChat } from '../services/geminiService';

interface ChatInterfaceProps {
  session: ChatSession;
  onUpdateSession: (session: ChatSession) => void;
  onNewChat: () => void;
}

export default function ChatInterface({ session, onUpdateSession, onNewChat }: ChatInterfaceProps) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [session.messages, isLoading]);

  const handleSend = async (text: string = input) => {
    if (!text.trim() || isLoading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: text.trim(),
      timestamp: Date.now(),
    };

    const updatedMessages = [...session.messages, userMsg];
    const newSession = { ...session, messages: updatedMessages, lastUpdated: Date.now() };
    onUpdateSession(newSession);
    setInput('');
    setIsLoading(true);
    setSuggestions([]);

    try {
      let fullResponse = '';
      const modelMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: '',
        timestamp: Date.now(),
      };

      // Add placeholder for model response
      const sessionWithPlaceholder = { ...newSession, messages: [...updatedMessages, modelMsg] };
      onUpdateSession(sessionWithPlaceholder);

      const stream = sendMessageStream(text.trim(), session.messages);
      
      for await (const chunk of stream) {
        fullResponse += chunk;
        const updatedModelMsg = { ...modelMsg, text: fullResponse };
        const currentMessages = [...updatedMessages, updatedModelMsg];
        onUpdateSession({ ...newSession, messages: currentMessages });
      }

      // Generate suggestions using Flash Lite after the main response
      const newSuggestions = await generateSuggestions(fullResponse);
      setSuggestions(newSuggestions);

      // If it's the first message, summarize for a title
      if (updatedMessages.length === 1) {
        const title = await summarizeChat([userMsg, { ...modelMsg, text: fullResponse }]);
        onUpdateSession({ ...newSession, title, messages: [...updatedMessages, { ...modelMsg, text: fullResponse }] });
      }

    } catch (error) {
      console.error("Chat error:", error);
      const errorMsg: Message = {
        id: (Date.now() + 2).toString(),
        role: 'model',
        text: "Sorry, I encountered an error. Please try again.",
        timestamp: Date.now(),
      };
      onUpdateSession({ ...newSession, messages: [...updatedMessages, errorMsg] });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 rounded-lg">
            <Sparkles className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h1 className="font-semibold text-sm leading-none">{session.title || 'New Chat'}</h1>
            <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-wider font-medium">Gemini 3.1 Pro</p>
          </div>
        </div>
        <button 
          onClick={onNewChat}
          className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors"
          title="New Chat"
        >
          <PlusCircle className="w-5 h-5" />
        </button>
      </header>

      {/* Messages */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth"
      >
        {session.messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50">
            <Bot className="w-12 h-12 mb-2" />
            <h2 className="text-xl font-medium">How can I help you today?</h2>
            <p className="max-w-xs text-sm">Ask me anything, from coding questions to creative writing.</p>
          </div>
        ) : (
          session.messages.map((msg) => (
            <motion.div 
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                msg.role === 'user' ? 'bg-zinc-200 dark:bg-zinc-800' : 'bg-emerald-500/10 text-emerald-600'
              }`}>
                {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>
              <div className={`max-w-[80%] p-3 rounded-2xl ${
                msg.role === 'user' 
                  ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-tr-none' 
                  : 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-tl-none'
              }`}>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                </div>
              </div>
            </motion.div>
          ))
        )}
        {isLoading && (
          <div className="flex gap-4">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3 rounded-2xl rounded-tl-none">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-zinc-300 dark:bg-zinc-700 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                <span className="w-1.5 h-1.5 bg-zinc-300 dark:bg-zinc-700 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                <span className="w-1.5 h-1.5 bg-zinc-300 dark:bg-zinc-700 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer / Input */}
      <div className="p-4 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800">
        {/* Suggestions */}
        <AnimatePresence>
          {suggestions.length > 0 && !isLoading && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="flex flex-wrap gap-2 mb-4"
            >
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(s)}
                  className="text-xs px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-emerald-500/10 hover:text-emerald-600 transition-all border border-zinc-200 dark:border-zinc-700"
                >
                  {s}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <form 
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="relative flex items-center"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            className="w-full p-3 pr-12 bg-zinc-100 dark:bg-zinc-800 rounded-xl border-none focus:ring-2 focus:ring-emerald-500/50 transition-all outline-none text-sm"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className={`absolute right-2 p-2 rounded-lg transition-all ${
              input.trim() && !isLoading 
                ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' 
                : 'text-zinc-400'
            }`}
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
        <p className="text-[10px] text-center text-zinc-400 mt-2">
          Gemini can make mistakes. Check important info.
        </p>
      </div>
    </div>
  );
}
