export interface DriveAttachment {
  id: string;
  name: string;
  mimeType: string;
  content: string;
  sizeBytes?: number;
  webViewLink?: string;
}

export interface Message {
  id: string;
  sessionId?: string;
  userId?: string;
  role: 'user' | 'model';
  text: string;
  attachmentNames?: string[];
  timestamp: number;
}

export interface ChatSession {
  id: string;
  userId?: string;
  title: string;
  messages: Message[];
  lastUpdated: number;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
}
