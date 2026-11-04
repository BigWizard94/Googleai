import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  getDocFromServer,
  Timestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { ChatSession, Message } from '../types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}

// Validate connection to Firestore on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((p) => ({
          providerId: p.providerId,
          email: p.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Blueprint validation constants & helpers
const ID_PATTERN = /^[a-zA-Z0-9_\-]+$/;

function sanitizeId(rawId: string): string {
  const cleaned = rawId.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
  return cleaned.length > 0 && ID_PATTERN.test(cleaned) ? cleaned : `id_${Date.now()}`;
}

function truncateText(text: string, maxLength: number, fallback = 'Untitled'): string {
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
}

// In-memory OAuth access token cache (never persisted to localStorage or sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthChange: (user: User | null, accessToken: string | null) => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      try {
        await upsertUserProfile(user);
      } catch (e) {
        console.warn('Profile sync warning on auth state change:', e);
      }
      if (cachedAccessToken) {
        onAuthChange(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthChange(user, null);
      }
    } else {
      cachedAccessToken = null;
      onAuthChange(null, null);
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Firebase Auth');
    }

    cachedAccessToken = credential.accessToken;
    await upsertUserProfile(result.user);
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

// UserProfile upsert (/users/{userId})
export async function upsertUserProfile(user: User): Promise<void> {
  const uid = sanitizeId(user.uid);
  const path = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  const displayName = truncateText(
    user.displayName || user.email?.split('@')[0] || 'User',
    100,
    'User'
  );
  const email = truncateText(user.email || 'user@example.com', 254, 'user@example.com');
  const photoURL = user.photoURL ? user.photoURL.slice(0, 1024) : '';

  try {
    const existingSnap = await getDoc(userRef);
    if (!existingSnap.exists()) {
      await setDoc(userRef, {
        uid,
        displayName,
        email,
        photoURL,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        displayName,
        email,
        photoURL,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// Subscribe to user's chat sessions (/users/{userId}/sessions)
// Uses where('userId', '==', uid) to satisfy Firestore Security Rules Query Enforcer
export function subscribeToUserSessions(
  userId: string,
  onSessionsUpdate: (sessions: Omit<ChatSession, 'messages'>[]) => void
) {
  const uid = sanitizeId(userId);
  const path = `users/${uid}/sessions`;
  const sessionsQuery = query(
    collection(db, 'users', uid, 'sessions'),
    where('userId', '==', uid)
  );

  return onSnapshot(
    sessionsQuery,
    (snapshot) => {
      const loadedSessions: Omit<ChatSession, 'messages'>[] = snapshot.docs
        .map((docSnap) => {
          const data = docSnap.data();
          const updatedAtTs = data.updatedAt as Timestamp | null;
          return {
            id: data.id || docSnap.id,
            userId: data.userId || uid,
            title: data.title || 'New Chat',
            lastUpdated: updatedAtTs?.toMillis ? updatedAtTs.toMillis() : Date.now(),
          };
        })
        .sort((a, b) => b.lastUpdated - a.lastUpdated);
      onSessionsUpdate(loadedSessions);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

// Subscribe to messages inside a specific session (/users/{userId}/sessions/{sessionId}/messages)
// Uses where('userId', '==', uid) to satisfy Firestore Security Rules Query Enforcer
export function subscribeToSessionMessages(
  userId: string,
  sessionId: string,
  onMessagesUpdate: (messages: Message[]) => void
) {
  const uid = sanitizeId(userId);
  const sid = sanitizeId(sessionId);
  const path = `users/${uid}/sessions/${sid}/messages`;
  const messagesQuery = query(
    collection(db, 'users', uid, 'sessions', sid, 'messages'),
    where('userId', '==', uid)
  );

  return onSnapshot(
    messagesQuery,
    (snapshot) => {
      const loadedMessages: Message[] = snapshot.docs
        .map((docSnap): Message => {
          const data = docSnap.data();
          const createdAtTs = data.createdAt as Timestamp | null;
          return {
            id: data.id || docSnap.id,
            sessionId: data.sessionId || sid,
            userId: data.userId || uid,
            role: data.role === 'model' ? 'model' : 'user',
            text: data.text || '',
            attachmentNames: Array.isArray(data.attachmentNames)
              ? data.attachmentNames
              : undefined,
            timestamp: createdAtTs?.toMillis ? createdAtTs.toMillis() : Date.now(),
          };
        })
        .sort((a, b) => a.timestamp - b.timestamp);
      onMessagesUpdate(loadedMessages);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

// Create a new session in Firestore (/users/{userId}/sessions/{sessionId})
export async function createFirestoreSession(
  userId: string,
  sessionId: string,
  title: string
): Promise<void> {
  const uid = sanitizeId(userId);
  const sid = sanitizeId(sessionId);
  const path = `users/${uid}/sessions/${sid}`;

  try {
    await setDoc(doc(db, 'users', uid, 'sessions', sid), {
      id: sid,
      userId: uid,
      title: truncateText(title, 120, 'New Chat'),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

// Update session title in Firestore
export async function updateFirestoreSessionTitle(
  userId: string,
  sessionId: string,
  title: string
): Promise<void> {
  const uid = sanitizeId(userId);
  const sid = sanitizeId(sessionId);
  const path = `users/${uid}/sessions/${sid}`;

  try {
    await updateDoc(doc(db, 'users', uid, 'sessions', sid), {
      title: truncateText(title, 120, 'Chat Session'),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// Save or update a message in Firestore (/users/{userId}/sessions/{sessionId}/messages/{messageId})
export async function saveFirestoreMessage(
  userId: string,
  sessionId: string,
  message: {
    id: string;
    role: 'user' | 'model';
    text: string;
    attachmentNames?: string[];
  },
  isUpdate = false
): Promise<void> {
  const uid = sanitizeId(userId);
  const sid = sanitizeId(sessionId);
  const mid = sanitizeId(message.id);
  const path = `users/${uid}/sessions/${sid}/messages/${mid}`;
  const msgRef = doc(db, 'users', uid, 'sessions', sid, 'messages', mid);

  const safeText = truncateText(message.text, 50000, '...');
  const safeAttachments =
    message.attachmentNames && message.attachmentNames.length > 0
      ? message.attachmentNames.slice(0, 5).map((name) => truncateText(name, 200, 'file'))
      : undefined;

  try {
    if (!isUpdate) {
      const payload: Record<string, unknown> = {
        id: mid,
        sessionId: sid,
        userId: uid,
        role: message.role === 'model' ? 'model' : 'user',
        text: safeText,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (safeAttachments) {
        payload.attachmentNames = safeAttachments;
      }
      await setDoc(msgRef, payload);
    } else {
      const updatePayload: Record<string, unknown> = {
        text: safeText,
        updatedAt: serverTimestamp(),
      };
      if (safeAttachments) {
        updatePayload.attachmentNames = safeAttachments;
      }
      await updateDoc(msgRef, updatePayload);
    }
  } catch (error) {
    handleFirestoreError(
      error,
      isUpdate ? OperationType.UPDATE : OperationType.CREATE,
      path
    );
  }
}

// Delete a session and its messages from Firestore
export async function deleteFirestoreSession(userId: string, sessionId: string): Promise<void> {
  const uid = sanitizeId(userId);
  const sid = sanitizeId(sessionId);
  const messagesPath = `users/${uid}/sessions/${sid}/messages`;
  const sessionPath = `users/${uid}/sessions/${sid}`;

  try {
    const msgsQuery = query(
      collection(db, 'users', uid, 'sessions', sid, 'messages'),
      where('userId', '==', uid)
    );
    const msgsSnap = await getDocs(msgsQuery);
    for (const msgDoc of msgsSnap.docs) {
      await deleteDoc(msgDoc.ref);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, messagesPath);
  }

  try {
    await deleteDoc(doc(db, 'users', uid, 'sessions', sid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, sessionPath);
  }
}
