# Gemini AI Chatbot with Google Drive, Google Picker & Firebase Sync

Integrate Google Sign-In, Firebase Firestore real-time cloud persistence, Google Picker, and Google Drive file extraction so users can attach Drive documents directly into their chat prompts for Gemini analysis while syncing their user profile and multi-session chat histories across devices.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following product and architecture decisions reflect your confirmed preferences from our clarification questions and govern how Google Drive, Picker, and Firebase will be integrated.

- **Confirmed Decision 1 (Google Drive & Picker Workflow)**: Files selected via the Google Picker widget will be attached directly to the chat prompt context so Gemini 3.1 Pro can analyze, summarize, and answer questions about their contents.
- **Confirmed Decision 2 (Firebase Firestore Persistence)**: Firestore will persist both your authenticated user profile and synchronized multi-session chat histories (including message transcripts and attached Drive file metadata) with strict owner-only security rules.
- **Confirmed Decision 3 (Google Picker Trigger Placement)**: An interactive Google Drive attachment button will be placed directly inside the chat input bar alongside staged attachment previews.
- **Default Choice (Content Extraction Strategy)**: Google Docs, Sheets, and Slides selected from Drive will be exported as plain text/CSV via the Drive API (`files.export`), while plain text, Markdown, JSON, CSV, and PDF/image files will be read via `files.get?alt=media` so Gemini receives accurate document content.

---

## 1. Overview & Core Concept

- **What It Does**: Elevates the Gemini AI Chatbot into a cloud-synced, document-aware workspace. Users sign in with their Google account to synchronize all conversations in Firebase Firestore and click the Drive attachment control in the composer to pick files from Google Drive via the official Google Picker modal. Selected files are fetched and passed into the server-side Gemini 3.1 Pro streaming context.
- **Target Audience / Persona**: Knowledge workers, researchers, developers, and teams who want to analyze documents stored in Google Drive and maintain a persistent, searchable history of AI conversations across sessions.
- **Key Value**: Eliminates manual copy-pasting from Google Drive documents and replaces volatile browser-only storage with authenticated, zero-trust cloud persistence in Firebase Firestore.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Authentication & Cloud Sync**: Users click the official "Sign in with Google" button in the sidebar/header. Upon sign-in, Firebase Auth issues a session and caches the Google OAuth access token in memory (`drive.file` and `drive.metadata.readonly` scopes). User profile data and existing chat sessions sync in real time from Firestore (with seamless fallback/migration for local sessions).
  2. **Picking & Staged Drive Attachments**: Inside the chat input bar, clicking the Google Drive attachment icon opens the native Google Picker modal (`ViewId.DOCS` and `DocsUploadView`). When the user picks one or more Drive files, their content/metadata is fetched using the user's OAuth token and staged above the text input with file name, MIME type label, and a remove (`×`) action.
  3. **Document-Grounded Gemini Streaming**: Submitting a prompt sends the message, conversation history, and extracted Drive file contents to the server-side Gemini 3.1 Pro streaming endpoint. Both the message and Drive file references are persisted to the active Firestore chat session, and Gemini 3.1 Flash Lite generates follow-up suggestions and session titles.
  4. **Session Search & Management**: Users can filter saved chat sessions via a live search input in the sidebar, switch sessions with zero latency, or delete sessions with confirmation.

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: High-craft SaaS workspace (`260px`–`280px` sidebar + clean 3-zone top bar + focused conversation canvas) with single-elevation surfaces and crisp `1px` structural borders.
  - *Color Palette & Mood*: 60% neutral slate/zinc canvas (`#FAFAFA` light / `#09090B` dark), 30% structural surfaces (`#FFFFFF` / `#18181B` with `#E4E4E7` / `#27272A` hairline borders), and 10% emerald accent (`#10B981` / `#059669`) for primary actions and active states.
  - *Typography & Hierarchy*: `Plus Jakarta Sans` for crisp workspace headings and navigation paired with `DM Sans` for readable long-form chat prose and `JetBrains Mono` (`tabular-nums`) for code blocks, token/file sizes, and timestamps.
  - *Component Styling & Layout*: Unboxed inline metadata separated by middots (`·`) adhering to zero-pill discipline; single-line button labels (`whitespace-nowrap shrink-0`); official Google Material Sign-In button styling.

- **Interactive Feedback & Motion**:
  - Fast `150ms` opacity and transform transitions for message arrival, staged attachment cards, and sidebar toggles.
  - Explicit loading states while extracting Drive file content, skeleton placeholders when syncing Firestore sessions, and clear inline error banners if OAuth re-authentication is required.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Client-Side OAuth + Google Picker with Server-Side Gemini Streaming**
  - *Chosen Approach*: Authenticate with Firebase Google Auth in the browser, open the Google Picker widget client-side using the in-memory OAuth access token, fetch/export the selected file content via Drive API, and send the structured document context to `/api/chat/stream` on the Express server.
  - *Why*: Google Picker is strictly a client-side JavaScript widget, and client-side popup OAuth avoids ephemeral preview URL `redirect_uri_mismatch` errors while keeping the `GEMINI_API_KEY` strictly on the backend server.
  - *Alternatives Considered*: Server-side OAuth redirect flows (incompatible with dynamic preview URLs).

- **Decision 2: Subcollection-Based Firestore Schema & Owner-Only Security Rules**
  - *Chosen Approach*: Store user profiles under `/users/{userId}` and chat sessions under `/users/{userId}/sessions/{sessionId}`, with messages stored in `/users/{userId}/sessions/{sessionId}/messages/{messageId}` to respect Firestore's scalability and bounded-list rules.
  - *Why*: Prevents unbounded array growth in session documents, satisfies the Eight Pillars of Hardened Firestore Security Rules, and ensures instant owner-scoped queries and strict PII isolation.
  - *Alternatives Considered*: Storing all messages in a single array inside a session document (violates Firestore array scalability limits and security rule best practices).

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        Browser Client (React 19 SPA)                       │
│                                                                            │
│  ┌──────────────────────────┐      ┌────────────────────────────────────┐  │
│  │   Sidebar & Auth Panel   │      │         ChatInterface View         │  │
│  │  - Google Sign-In / Out  │      │  - Header (Session Title & Actions)│  │
│  │  - Session Search Filter │      │  - Message Stream & Drive Citations│  │
│  │  - Firestore Session List│      │  - Staged Drive File Tray          │  │
│  └────────────┬─────────────┘      │  - Input Bar + Drive Picker Button │  │
│               │                    └─────────┬──────────────────┬───────┘  │
│               ▼                              │                  │          │
│  ┌───────────────────────────────────────────┴──┐    ┌──────────▼───────┐  │
│  │     Firebase Auth & Firestore Service        │    │  Google Picker & │  │
│  │  - In-memory OAuth Access Token Cache        │    │  Drive API Client│  │
│  │  - /users/{uid} Profile Sync                 │    │  - gapi / picker │  │
│  │  - /users/{uid}/sessions/{sid}/messages/{mid}│    │  - files.get /   │  │
│  └───────────────────────────┬──────────────────┘    │    files.export  │  │
│                              │                       └──────────┬───────┘  │
└──────────────────────────────┼──────────────────────────────────┼──────────┘
                               │                                  │
                               ▼                                  ▼
┌─────────────────────────────────────────┐    ┌─────────────────────────────┐
│     Firebase Cloud (Auth & Firestore)   │    │  Express Server (server.ts) │
│  - Hardened ABAC firestore.rules        │    │  - POST /api/chat/stream    │
│  - Real-time onSnapshot listeners       │    │  - POST /api/chat/suggestions│
│  - Zero-trust UID & schema validation   │    │  - POST /api/chat/summarize │
└─────────────────────────────────────────┘    └─────────────────────────────┘
```

### Data Model & State

- **UserProfile (`/users/{userId}`)**:
  - `uid` (string, required, matches `request.auth.uid`)
  - `displayName` (string, required, 1–100 chars)
  - `email` (string, required, email format)
  - `photoURL` (string, optional, URL)
  - `updatedAt` (number, timestamp)
- **ChatSession (`/users/{userId}/sessions/{sessionId}`)**:
  - `id` (string, required, regex `^[a-zA-Z0-9_\-]+$`)
  - `userId` (string, required, matches `request.auth.uid`)
  - `title` (string, required, 1–120 chars)
  - `lastUpdated` (number, required)
  - `createdAt` (number, required)
- **ChatMessage (`/users/{userId}/sessions/{sessionId}/messages/{messageId}`)**:
  - `id` (string, required)
  - `sessionId` (string, required)
  - `userId` (string, required, matches `request.auth.uid`)
  - `role` (`'user' | 'model'`, required)
  - `text` (string, required, 1–50000 chars)
  - `timestamp` (number, required)
  - `attachmentNames` (bounded list of strings, optional, max 5 items for displaying attached Drive file names on the message)

### Interactive Component & State Mapping

- **Authentication Lifecycle**:
  - `initAuth` listens to `onAuthStateChanged`. When signed in with a valid in-memory OAuth token, user profile is upserted to `/users/{uid}` and an `onSnapshot` listener subscribes to `/users/{uid}/sessions`.
  - If the user refreshes the page (Firebase Auth persists the user, but the in-memory Google OAuth access token is cleared for security), clicking the Google Picker button prompts a one-click re-consent popup via `googleSignIn()` to obtain a fresh access token.
- **Google Picker & Drive File Extraction**:
  - Clicking the Drive attachment button in the chat input bar loads `https://apis.google.com/js/api.js` (`gapi.load('picker')`), configures `google.picker.PickerBuilder()` with `ViewId.DOCS`, `DocsUploadView`, `setOAuthToken(accessToken)`, and `setOrigin(pickerOrigin)`.
  - Upon `Action.PICKED`, the client fetches the selected file's content using `Authorization: Bearer ${accessToken}`:
    - Google Workspace documents (`application/vnd.google-apps.document`, `spreadsheet`, `presentation`) are exported to text/CSV via `https://www.googleapis.com/drive/v3/files/{fileId}/export`.
    - Standard text/code/PDF/image files are downloaded or inspected via `https://www.googleapis.com/drive/v3/files/{fileId}?alt=media`, and staged in the composer tray with clear file size and status indicators.
- **Chat Streaming & Firestore Sync**:
  - Submitting a message writes the user message document to Firestore, streams the Gemini 3.1 Pro response from `/api/chat/stream` (passing the prompt + attached Drive file contents), updates the UI live during streaming, and saves the completed model message and summarized session title to Firestore.
