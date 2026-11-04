import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Send,
  Bot,
  User,
  Loader2,
  Sparkles,
  PlusCircle,
  HardDrive,
  FileText,
  X,
  AlertCircle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Message, ChatSession, DriveAttachment } from '../types';
import {
  sendMessageStream,
  generateSuggestions,
  summarizeChat,
  PRO_MODEL,
} from '../services/geminiService';
import { openGoogleDrivePicker, fetchDriveFileContent } from '../services/drivePickerService';

interface ChatInterfaceProps {
  session: ChatSession;
  onUpdateSession: (session: ChatSession) => void;
  onNewChat: () => void;
  accessToken: string | null;
  onRequestDriveAuth: () => Promise<string | null>;
  onPersistMessage?: (
    sessionId: string,
    message: Message,
    isUpdate?: boolean
  ) => Promise<void>;
  onPersistTitle?: (sessionId: string, title: string) => Promise<void>;
}

function formatMimeLabel(mimeType: string): string {
  if (mimeType.includes('document')) return 'Google Doc';
  if (mimeType.includes('spreadsheet')) return 'Google Sheet';
  if (mimeType.includes('presentation')) return 'Google Slides';
  if (mimeType.includes('pdf')) return 'PDF';
  if (mimeType.includes('csv')) return 'CSV';
  if (mimeType.includes('json')) return 'JSON';
  if (mimeType.includes('markdown') || mimeType.includes('plain')) return 'Text';
  const parts = mimeType.split('/');
  return parts[parts.length - 1]?.toUpperCase().slice(0, 12) || 'File';
}

function formatFileSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ChatInterface({
  session,
  onUpdateSession,
  onNewChat,
  accessToken,
  onRequestDriveAuth,
  onPersistMessage,
  onPersistTitle,
}: ChatInterfaceProps) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [stagedAttachments, setStagedAttachments] = useState<DriveAttachment[]>([]);
  const [isPickingDrive, setIsPickingDrive] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [session.messages, isLoading]);

  const handleOpenDrivePicker = async () => {
    if (isPickingDrive || isLoading) return;
    setDriveError(null);
    setIsPickingDrive(true);

    try {
      let token = accessToken;
      if (!token) {
        token = await onRequestDriveAuth();
      }
      if (!token) {
        setDriveError('Sign in with Google to attach files from Google Drive.');
        return;
      }

      const pickedFiles = await openGoogleDrivePicker(token);
      if (pickedFiles.length === 0) return;

      const remainingSlots = Math.max(0, 5 - stagedAttachments.length);
      const filesToProcess = pickedFiles.slice(0, remainingSlots);

      const loadedAttachments = await Promise.all(
        filesToProcess.map((file) => fetchDriveFileContent(file, token!))
      );

      setStagedAttachments((prev) => {
        const existingIds = new Set(prev.map((item) => item.id));
        const uniqueNew = loadedAttachments.filter((item) => !existingIds.has(item.id));
        return [...prev, ...uniqueNew].slice(0, 5);
      });
    } catch (error: any) {
      console.error('Google Drive Picker error:', error);
      setDriveError(error?.message || 'Unable to load files from Google Drive.');
    } finally {
      setIsPickingDrive(false);
    }
  };

  const removeStagedAttachment = (id: string) => {
    setStagedAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  const handleSend = async (text: string = input) => {
    const trimmedText = text.trim();
    if ((!trimmedText && stagedAttachments.length === 0) || isLoading) return;

    const currentAttachments = [...stagedAttachments];
    const promptText =
      trimmedText ||
      `Please analyze the attached Google Drive ${
        currentAttachments.length === 1 ? 'document' : 'documents'
      }: ${currentAttachments.map((a) => a.name).join(', ')}.`;

    const userMsg: Message = {
      id: `msg_${Date.now()}`,
      sessionId: session.id,
      role: 'user',
      text: promptText,
      attachmentNames:
        currentAttachments.length > 0 ? currentAttachments.map((a) => a.name) : undefined,
      timestamp: Date.now(),
    };

    const updatedMessages = [...session.messages, userMsg];
    const newSession: ChatSession = {
      ...session,
      messages: updatedMessages,
      lastUpdated: Date.now(),
    };

    onUpdateSession(newSession);
    setInput('');
    setStagedAttachments([]);
    setDriveError(null);
    setIsLoading(true);
    setSuggestions([]);

    if (onPersistMessage) {
      try {
        await onPersistMessage(session.id, userMsg, false);
      } catch (e) {
        console.error('Failed to persist user message:', e);
      }
    }

    const modelMsgId = `msg_${Date.now() + 1}`;
    const modelMsg: Message = {
      id: modelMsgId,
      sessionId: session.id,
      role: 'model',
      text: '',
      timestamp: Date.now(),
    };

    try {
      let fullResponse = '';
      const sessionWithPlaceholder = {
        ...newSession,
        messages: [...updatedMessages, modelMsg],
      };
      onUpdateSession(sessionWithPlaceholder);

      const stream = sendMessageStream(
        promptText,
        session.messages,
        PRO_MODEL,
        currentAttachments
      );

      for await (const chunk of stream) {
        fullResponse += chunk;
        const updatedModelMsg: Message = { ...modelMsg, text: fullResponse };
        const currentMessages = [...updatedMessages, updatedModelMsg];
        onUpdateSession({ ...newSession, messages: currentMessages });
      }

      const finalModelMsg: Message = {
        ...modelMsg,
        text: fullResponse || 'No response generated.',
      };

      if (onPersistMessage) {
        try {
          await onPersistMessage(session.id, finalModelMsg, false);
        } catch (e) {
          console.error('Failed to persist model message:', e);
        }
      }

      // Generate follow-up suggestions using Flash Lite
      const newSuggestions = await generateSuggestions(fullResponse);
      setSuggestions(newSuggestions);

      // Summarize first exchange for session title
      if (updatedMessages.length === 1) {
        const title = await summarizeChat([userMsg, finalModelMsg]);
        const titledSession = {
          ...newSession,
          title,
          messages: [...updatedMessages, finalModelMsg],
        };
        onUpdateSession(titledSession);
        if (onPersistTitle) {
          try {
            await onPersistTitle(session.id, title);
          } catch (e) {
            console.error('Failed to persist session title:', e);
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMsg: Message = {
        id: `msg_${Date.now() + 2}`,
        sessionId: session.id,
        role: 'model',
        text: 'Sorry, I encountered an error processing your request. Please try again.',
        timestamp: Date.now(),
      };
      onUpdateSession({ ...newSession, messages: [...updatedMessages, errorMsg] });
      if (onPersistMessage) {
        try {
          await onPersistMessage(session.id, errorMsg, false);
        } catch {}
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-emerald-500/10 rounded-lg shrink-0">
            <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="min-w-0">
            <h1 className="font-semibold text-sm leading-tight truncate">
              {session.title || 'New Chat'}
            </h1>
            <div className="flex items-center gap-1.5 text-xs text-zinc-500 mt-0.5">
              <span>Gemini 3.1 Pro</span>
              <span aria-hidden="true">·</span>
              <span>Google Drive Ready</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onNewChat}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            title="New Chat"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>New Chat</span>
          </button>
        </div>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth"
      >
        {session.messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-3 text-zinc-500 dark:text-zinc-400">
            <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-1">
              <Bot className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              How can I help you today?
            </h2>
            <p className="max-w-sm text-sm">
              Ask complex questions or attach Google Drive documents using the Drive icon below for instant analysis.
            </p>
          </div>
        ) : (
          session.messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
              className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div
                className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                  msg.role === 'user'
                    ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200'
                    : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {msg.role === 'user' ? (
                  <User className="w-4 h-4" />
                ) : (
                  <Bot className="w-4 h-4" />
                )}
              </div>
              <div
                className={`max-w-[80%] p-3.5 rounded-2xl ${
                  msg.role === 'user'
                    ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-tr-none'
                    : 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-tl-none'
                }`}
              >
                {msg.attachmentNames && msg.attachmentNames.length > 0 && (
                  <div
                    className={`flex flex-wrap items-center gap-2 pb-2 mb-2 border-b text-xs ${
                      msg.role === 'user'
                        ? 'border-zinc-700 dark:border-zinc-300 text-zinc-300 dark:text-zinc-600'
                        : 'border-zinc-200 dark:border-zinc-800 text-zinc-500'
                    }`}
                  >
                    <HardDrive className="w-3.5 h-3.5 shrink-0" />
                    <span>{msg.attachmentNames.join(' · ')}</span>
                  </div>
                )}
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
                <span
                  className="w-1.5 h-1.5 bg-zinc-400 dark:bg-zinc-600 rounded-full animate-bounce"
                  style={{ animationDelay: '0ms' }}
                ></span>
                <span
                  className="w-1.5 h-1.5 bg-zinc-400 dark:bg-zinc-600 rounded-full animate-bounce"
                  style={{ animationDelay: '150ms' }}
                ></span>
                <span
                  className="w-1.5 h-1.5 bg-zinc-400 dark:bg-zinc-600 rounded-full animate-bounce"
                  style={{ animationDelay: '300ms' }}
                ></span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer / Input */}
      <div className="p-4 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800">
        {/* Drive Error Notice */}
        {driveError && (
          <div className="flex items-center justify-between gap-2 mb-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-xs text-red-700 dark:text-red-300">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{driveError}</span>
            </div>
            <button
              type="button"
              onClick={() => setDriveError(null)}
              className="p-1 hover:bg-red-100 dark:hover:bg-red-900/50 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Staged Google Drive Attachments Tray */}
        <AnimatePresence>
          {stagedAttachments.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.15 }}
              className="flex flex-wrap gap-2 mb-3"
            >
              {stagedAttachments.map((file) => {
                const sizeLabel = formatFileSize(file.sizeBytes);
                return (
                  <div
                    key={file.id}
                    className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs"
                  >
                    <FileText className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate max-w-[180px]">
                        {file.name}
                      </span>
                      <span className="text-zinc-400" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                        {formatMimeLabel(file.mimeType)}
                      </span>
                      {sizeLabel && (
                        <>
                          <span className="text-zinc-400" aria-hidden="true">
                            ·
                          </span>
                          <span className="font-mono tabular-nums text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                            {sizeLabel}
                          </span>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeStagedAttachment(file.id)}
                      className="p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded transition-colors"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Follow-up Suggestions */}
        <AnimatePresence>
          {suggestions.length > 0 && !isLoading && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.15 }}
              className="flex flex-wrap gap-2 mb-3"
            >
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSend(s)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors border border-zinc-200 dark:border-zinc-700 text-left"
                >
                  {s}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="relative flex items-center gap-2"
        >
          <div className="relative flex-1 flex items-center">
            {/* Google Drive Picker Attachment Button inside the chat input bar */}
            <button
              type="button"
              onClick={handleOpenDrivePicker}
              disabled={isLoading || isPickingDrive}
              title="Attach files from Google Drive"
              aria-label="Attach files from Google Drive"
              className="absolute left-2.5 p-2 rounded-lg text-zinc-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-700/70 transition-colors disabled:opacity-50"
            >
              {isPickingDrive ? (
                <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              ) : (
                <HardDrive className="w-4 h-4" />
              )}
            </button>

            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                stagedAttachments.length > 0
                  ? 'Ask a question about your attached Google Drive files...'
                  : 'Type a message or click the Drive icon to attach files...'
              }
              className="w-full py-3 pl-11 pr-12 bg-zinc-100 dark:bg-zinc-800 rounded-xl border border-transparent focus:border-emerald-500/50 focus:bg-white dark:focus:bg-zinc-900 transition-colors outline-none text-sm"
            />

            <button
              type="submit"
              disabled={(!input.trim() && stagedAttachments.length === 0) || isLoading}
              aria-label="Send message"
              className={`absolute right-2 p-2 rounded-lg transition-colors ${
                (input.trim() || stagedAttachments.length > 0) && !isLoading
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'text-zinc-400'
              }`}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>

        <p className="text-[11px] text-center text-zinc-400 mt-2">
          Gemini can make mistakes. Verify important details from attached Google Drive documents.
        </p>
      </div>
    </div>
  );
}
