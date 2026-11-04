import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  MessageSquare, 
  Plus, 
  Trash2, 
  Settings, 
  Menu, 
  X, 
  Sparkles,
  Search,
  ChevronLeft,
  ChevronRight,
  Bot
} from 'lucide-react';
import { ChatSession } from './types';
import ChatInterface from './components/ChatInterface';

export default function App() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('gemini-chat-sessions');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSessions(parsed);
        if (parsed.length > 0) {
          setActiveSessionId(parsed[0].id);
        }
      } catch (e) {
        console.error("Failed to load sessions", e);
      }
    }
  }, []);

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem('gemini-chat-sessions', JSON.stringify(sessions));
  }, [sessions]);

  const createNewChat = () => {
    const newSession: ChatSession = {
      id: Date.now().toString(),
      title: 'New Chat',
      messages: [],
      lastUpdated: Date.now(),
    };
    setSessions([newSession, ...sessions]);
    setActiveSessionId(newSession.id);
  };

  const updateSession = (updated: ChatSession) => {
    setSessions(sessions.map(s => s.id === updated.id ? updated : s));
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSessions = sessions.filter(s => s.id !== id);
    setSessions(newSessions);
    if (activeSessionId === id) {
      setActiveSessionId(newSessions.length > 0 ? newSessions[0].id : null);
    }
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);

  return (
    <div className="flex h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <AnimatePresence mode="wait">
        {isSidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col"
          >
            {/* Sidebar Header */}
            <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center text-white">
                  <Bot className="w-5 h-5" />
                </div>
                <span className="font-bold text-sm tracking-tight">Gemini AI</span>
              </div>
              <button 
                onClick={() => setIsSidebarOpen(false)}
                className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors lg:hidden"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* New Chat Button */}
            <div className="p-4">
              <button
                onClick={createNewChat}
                className="w-full flex items-center justify-center gap-2 p-2.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl hover:opacity-90 transition-all font-medium text-sm shadow-lg shadow-zinc-900/10 dark:shadow-none"
              >
                <Plus className="w-4 h-4" />
                New Chat
              </button>
            </div>

            {/* Chat List */}
            <div className="flex-1 overflow-y-auto px-2 space-y-1">
              <div className="px-2 py-2 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Recent Chats</div>
              {sessions.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-zinc-400 italic">No chats yet</div>
              ) : (
                sessions.map((session) => (
                  <div
                    key={session.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveSessionId(session.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setActiveSessionId(session.id);
                      }
                    }}
                    className={`w-full group flex items-center gap-3 p-2.5 rounded-xl transition-all text-left text-sm cursor-pointer select-none ${
                      activeSessionId === session.id
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium'
                        : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    <MessageSquare className={`w-4 h-4 flex-shrink-0 ${
                      activeSessionId === session.id ? 'text-emerald-500' : 'text-zinc-400'
                    }`} />
                    <span className="flex-1 truncate">{session.title}</span>
                    <button
                      type="button"
                      aria-label="Delete chat"
                      onClick={(e) => deleteSession(session.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-md transition-all text-zinc-400 hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Sidebar Footer */}
            <div className="p-4 border-t border-zinc-200 dark:border-zinc-800">
              <button className="w-full flex items-center gap-3 p-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-all text-sm text-zinc-600 dark:text-zinc-400">
                <Settings className="w-4 h-4" />
                Settings
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative">
        {/* Toggle Sidebar Button (Floating) */}
        {!isSidebarOpen && (
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="absolute left-4 top-4 z-10 p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        {activeSession ? (
          <ChatInterface 
            session={activeSession} 
            onUpdateSession={updateSession}
            onNewChat={createNewChat}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-zinc-50 dark:bg-zinc-950">
            <div className="w-20 h-20 bg-emerald-500/10 rounded-3xl flex items-center justify-center text-emerald-600 mb-6 animate-pulse">
              <Sparkles className="w-10 h-10" />
            </div>
            <h2 className="text-3xl font-bold tracking-tight mb-2">Welcome to Gemini Chat</h2>
            <p className="text-zinc-500 dark:text-zinc-400 max-w-md mb-8">
              Start a new conversation to experience the power of Gemini 3.1 Pro.
            </p>
            <button
              onClick={createNewChat}
              className="flex items-center gap-2 px-6 py-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-2xl font-semibold hover:scale-105 transition-all shadow-xl shadow-zinc-900/20 dark:shadow-none"
            >
              <Plus className="w-5 h-5" />
              Start New Chat
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
