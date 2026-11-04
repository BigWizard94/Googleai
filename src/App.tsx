import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  MessageSquare,
  Plus,
  Trash2,
  Menu,
  X,
  Sparkles,
  Search,
  Bot,
  LogOut,
  HardDrive,
  Cloud,
  User as UserIcon,
} from 'lucide-react';
import { User } from 'firebase/auth';
import { ChatSession, Message } from './types';
import ChatInterface from './components/ChatInterface';
import GoogleSignInButton from './components/GoogleSignInButton';
import {
  initAuth,
  googleSignIn,
  logout,
  subscribeToUserSessions,
  subscribeToSessionMessages,
  createFirestoreSession,
  updateFirestoreSessionTitle,
  saveFirestoreMessage,
  deleteFirestoreSession,
} from './services/firebaseService';

export default function App() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Firebase Auth & OAuth token state
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  // Delete confirmation modal state
  const [sessionPendingDelete, setSessionPendingDelete] = useState<ChatSession | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Initialize Firebase Auth listener
  useEffect(() => {
    const unsubscribe = initAuth((firebaseUser, token) => {
      setUser(firebaseUser);
      setAccessToken(token);
      setAvatarError(false);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Load from localStorage when signed out
  useEffect(() => {
    if (!isAuthReady || user) return;
    const saved = localStorage.getItem('gemini-chat-sessions');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setSessions(parsed);
          if (parsed.length > 0 && !activeSessionId) {
            setActiveSessionId(parsed[0].id);
          }
        }
      } catch (e) {
        console.error('Failed to load local sessions', e);
      }
    }
  }, [isAuthReady, user]);

  // Save to localStorage when signed out
  useEffect(() => {
    if (!isAuthReady || user) return;
    localStorage.setItem('gemini-chat-sessions', JSON.stringify(sessions));
  }, [sessions, isAuthReady, user]);

  // Subscribe to Firestore sessions when authenticated
  useEffect(() => {
    if (!isAuthReady || !user) return;

    const unsubscribe = subscribeToUserSessions(user.uid, (remoteSessions) => {
      setSessions((prev) => {
        const prevMessagesMap = new Map(prev.map((s) => [s.id, s.messages]));
        const merged: ChatSession[] = remoteSessions.map((rs) => ({
          ...rs,
          messages: prevMessagesMap.get(rs.id) || [],
        }));
        return merged;
      });

      setActiveSessionId((currentId) => {
        if (currentId && remoteSessions.some((s) => s.id === currentId)) {
          return currentId;
        }
        return remoteSessions.length > 0 ? remoteSessions[0].id : null;
      });
    });

    return () => unsubscribe();
  }, [isAuthReady, user]);

  // Subscribe to messages for the active Firestore session
  useEffect(() => {
    if (!isAuthReady || !user || !activeSessionId) return;

    const unsubscribe = subscribeToSessionMessages(
      user.uid,
      activeSessionId,
      (remoteMessages) => {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId
              ? {
                  ...s,
                  messages: remoteMessages.length >= s.messages.length ? remoteMessages : s.messages,
                }
              : s
          )
        );
      }
    );

    return () => unsubscribe();
  }, [isAuthReady, user, activeSessionId]);

  const handleGoogleLogin = async (): Promise<string | null> => {
    if (isLoggingIn) return null;
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setAccessToken(result.accessToken);
        return result.accessToken;
      }
      return null;
    } catch (error) {
      console.error('Google Sign-In failed:', error);
      return null;
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      setUser(null);
      setAccessToken(null);
      setSessions([]);
      setActiveSessionId(null);
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  const createNewChat = async () => {
    const newId = `chat_${Date.now()}`;
    const newSession: ChatSession = {
      id: newId,
      userId: user?.uid,
      title: 'New Chat',
      messages: [],
      lastUpdated: Date.now(),
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);

    if (user) {
      try {
        await createFirestoreSession(user.uid, newSession.id, newSession.title);
      } catch (e) {
        console.error('Failed to create Firestore session:', e);
      }
    }
  };

  const updateSession = (updated: ChatSession) => {
    setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handlePersistMessage = async (
    sessionId: string,
    message: Message,
    isUpdate = false
  ) => {
    if (!user) return;
    await saveFirestoreMessage(
      user.uid,
      sessionId,
      {
        id: message.id,
        role: message.role,
        text: message.text,
        attachmentNames: message.attachmentNames,
      },
      isUpdate
    );
  };

  const handlePersistTitle = async (sessionId: string, title: string) => {
    if (!user) return;
    await updateFirestoreSessionTitle(user.uid, sessionId, title);
  };

  const requestDeleteSession = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessionPendingDelete(session);
  };

  const confirmDeleteSession = async () => {
    if (!sessionPendingDelete || isDeleting) return;
    setIsDeleting(true);
    const idToDelete = sessionPendingDelete.id;

    try {
      if (user) {
        await deleteFirestoreSession(user.uid, idToDelete);
      }
      const remaining = sessions.filter((s) => s.id !== idToDelete);
      setSessions(remaining);
      if (activeSessionId === idToDelete) {
        setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
      }
      setSessionPendingDelete(null);
    } catch (error) {
      console.error('Failed to delete session:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, searchQuery]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <div className="flex h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <AnimatePresence mode="wait">
        {isSidebarOpen && (
          <motion.aside
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.15 }}
            className="w-[280px] flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col"
          >
            {/* Sidebar Header */}
            <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white shrink-0">
                  <Bot className="w-4 h-4" />
                </div>
                <span className="font-bold text-sm tracking-tight whitespace-nowrap">
                  Gemini Chatbot
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsSidebarOpen(false)}
                aria-label="Close sidebar"
                className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* New Chat + Search */}
            <div className="p-3.5 space-y-2.5">
              <button
                type="button"
                onClick={createNewChat}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl hover:opacity-90 transition-opacity font-medium text-sm whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>New Chat</span>
              </button>

              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter chats..."
                  className="w-full py-1.5 pl-8 pr-3 text-xs bg-zinc-100 dark:bg-zinc-800 rounded-lg border border-transparent focus:border-zinc-300 dark:focus:border-zinc-700 outline-none transition-colors"
                />
              </div>
            </div>

            {/* Chat List */}
            <div className="flex-1 overflow-y-auto px-2.5 space-y-1">
              <div className="px-2 py-1.5 flex items-center justify-between text-xs font-medium text-zinc-500">
                <span>Conversations</span>
                <span className="font-mono tabular-nums">{filteredSessions.length}</span>
              </div>
              {filteredSessions.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-zinc-400">
                  {searchQuery ? 'No matching chats found' : 'No conversations yet'}
                </div>
              ) : (
                filteredSessions.map((session) => (
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
                    className={`w-full group flex items-center gap-3 p-2.5 rounded-xl transition-colors text-left text-sm cursor-pointer select-none ${
                      activeSessionId === session.id
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium'
                        : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    <MessageSquare
                      className={`w-4 h-4 flex-shrink-0 ${
                        activeSessionId === session.id ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400'
                      }`}
                    />
                    <span className="flex-1 truncate">{session.title}</span>
                    <button
                      type="button"
                      aria-label={`Delete ${session.title}`}
                      onClick={(e) => requestDeleteSession(session, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-md transition-opacity text-zinc-400 hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Sidebar Footer: Account & Cloud Sync */}
            <div className="p-3.5 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
              {user ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {user.photoURL && !avatarError ? (
                        <img
                          src={user.photoURL}
                          alt={user.displayName || 'User avatar'}
                          referrerPolicy="no-referrer"
                          onError={() => setAvatarError(true)}
                          className="w-8 h-8 rounded-full object-cover border border-zinc-200 dark:border-zinc-700 shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center font-semibold text-xs shrink-0">
                          {(user.displayName || user.email || 'U').charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                          {user.displayName || 'Google User'}
                        </p>
                        <p className="text-[11px] text-zinc-500 truncate">
                          {user.email}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleLogout}
                      title="Sign Out"
                      aria-label="Sign Out"
                      className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors shrink-0"
                    >
                      <LogOut className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-1 border-t border-zinc-100 dark:border-zinc-800/80">
                    <div className="flex items-center gap-1.5">
                      <Cloud className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>Firestore Synced</span>
                    </div>
                    {!accessToken ? (
                      <button
                        type="button"
                        onClick={handleGoogleLogin}
                        className="text-emerald-600 dark:text-emerald-400 hover:underline font-medium"
                      >
                        Connect Drive
                      </button>
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                        Drive Connected
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-snug">
                    Sign in to sync chats with Firebase and attach files from Google Drive.
                  </p>
                  <GoogleSignInButton
                    onClick={handleGoogleLogin}
                    disabled={isLoggingIn}
                    label={isLoggingIn ? 'Signing in...' : 'Sign in with Google'}
                  />
                </div>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative min-w-0">
        {/* Toggle Sidebar Button */}
        {!isSidebarOpen && (
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Open sidebar"
            className="absolute left-4 top-3 z-10 p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            <Menu className="w-4 h-4" />
          </button>
        )}

        {activeSession ? (
          <ChatInterface
            session={activeSession}
            onUpdateSession={updateSession}
            onNewChat={createNewChat}
            accessToken={accessToken}
            onRequestDriveAuth={handleGoogleLogin}
            onPersistMessage={user ? handlePersistMessage : undefined}
            onPersistTitle={user ? handlePersistTitle : undefined}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-zinc-50 dark:bg-zinc-950">
            <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-6">
              <Sparkles className="w-8 h-8" />
            </div>
            <h2 className="text-3xl font-bold tracking-tight mb-2 text-balance">
              Welcome to Gemini Chat
            </h2>
            <p className="text-zinc-500 dark:text-zinc-400 max-w-md mb-8 text-sm leading-relaxed">
              Start a conversation with Gemini 3.1 Pro, attach Google Drive documents via Google Picker, and sync your chat history across devices with Firebase.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={createNewChat}
                className="flex items-center gap-2 px-5 py-2.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>Start New Chat</span>
              </button>
              {!user && (
                <div className="w-52">
                  <GoogleSignInButton
                    onClick={handleGoogleLogin}
                    disabled={isLoggingIn}
                    label={isLoggingIn ? 'Signing in...' : 'Sign in with Google'}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {sessionPendingDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 shadow-xl"
            >
              <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
                Delete Conversation?
              </h3>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed mb-6">
                Are you sure you want to delete{' '}
                <span className="font-medium text-zinc-900 dark:text-zinc-200">
                  "{sessionPendingDelete.title}"
                </span>
                ? This will permanently remove all messages in this chat session.
              </p>
              <div className="flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setSessionPendingDelete(null)}
                  disabled={isDeleting}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteSession}
                  disabled={isDeleting}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors"
                >
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
