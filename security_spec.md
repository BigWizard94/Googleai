# Firestore Security Specification (`security_spec.md`)

## 1. Data Invariants

1. **Default-Deny Catch-All**: All paths not explicitly matched (`/{document=**}`) deny all `read` and `write` operations unconditionally.
2. **Verified Identity & Ownership**: Every write operation requires an authenticated user (`request.auth != null`) with a verified email (`request.auth.token.email_verified == true`), and `userId` / `uid` fields must strictly match `request.auth.uid` and the `{userId}` path parameter.
3. **PII Isolation (`/users/{userId}`)**: User profile documents contain PII (`email`, `displayName`, `photoURL`) and are strictly readable (`get`) and writable (`create`, `update`, `delete`) only by the owner (`request.auth.uid == userId`). Blanket `list` queries on `/users` are strictly prohibited (`allow list: if false;`).
4. **Master Gate Relational Sync**:
   - Creating or accessing a session `/users/{userId}/sessions/{sessionId}` requires verifying that the parent `/users/{userId}` document exists and belongs to `request.auth.uid`.
   - Creating or accessing a message `/users/{userId}/sessions/{sessionId}/messages/{messageId}` requires verifying via `get()` that the parent session `/users/{userId}/sessions/{sessionId}` exists and `data.userId == request.auth.uid`.
5. **Query Enforcer (Cost-Optimized `allow list`)**:
   - `allow list` on `/users/{userId}/sessions` requires `request.auth.uid == userId && resource.data.userId == request.auth.uid` (no `get()` inside `list`).
   - `allow list` on `/users/{userId}/sessions/{sessionId}/messages` requires `request.auth.uid == userId && resource.data.userId == request.auth.uid && resource.data.sessionId == sessionId` (no `get()` inside `list`).
6. **Temporal & Immutable Field Integrity**:
   - On `create`: `createdAt == request.time` and `updatedAt == request.time`.
   - On `update`: `createdAt == resource.data.createdAt` (immutable), `updatedAt == request.time`, and identity keys (`id`, `userId`, `sessionId`, `uid`) remain immutable.

---

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 1 (Shadow Field Injection on UserProfile)**:
   ```json
   { "uid": "user_1", "displayName": "Alice", "email": "alice@example.com", "isAdmin": true, "createdAt": "SERVER_TIME", "updatedAt": "SERVER_TIME" }
   ```
   *Rejected by*: `data.keys().hasOnly(['uid', 'displayName', 'email', 'photoURL', 'createdAt', 'updatedAt'])`.

2. **Payload 2 (Unverified Email Spoof)**:
   Authenticated token with `email_verified: false` attempting to create `/users/user_1`.
   *Rejected by*: `isVerifiedUser()` (`request.auth.token.email_verified == true`).

3. **Payload 3 (Cross-User PII Scraping)**:
   `user_2` executing `get(/users/user_1)` or `list(/users)`.
   *Rejected by*: `isOwner(userId)` on `get` and `allow list: if false;`.

4. **Payload 4 (ID Poisoning / 1.5KB Junk ID)**:
   Creating `/users/user_1/sessions/{1500_char_junk_id}`.
   *Rejected by*: `isValidId(sessionId)` (`id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\-]+$')`).

5. **Payload 5 (Identity Spoofing on Session Create)**:
   `user_1` creating `/users/user_1/sessions/sess_1` with `{ "userId": "user_2", ... }`.
   *Rejected by*: `data.userId == request.auth.uid && data.userId == userId`.

6. **Payload 6 (Orphaned Session Create Without User Profile)**:
   `user_1` creating `/users/user_1/sessions/sess_1` before `/users/user_1` exists.
   *Rejected by*: `exists(/databases/$(database)/documents/users/$(userId))`.

7. **Payload 7 (Orphaned Message Create Without Parent Session)**:
   `user_1` creating `/users/user_1/sessions/nonexistent_sess/messages/msg_1`.
   *Rejected by*: Master Gate `get(/databases/$(database)/documents/users/$(userId)/sessions/$(sessionId)).data.userId == request.auth.uid`.

8. **Payload 8 (Client Timestamp Forgery)**:
   `user_1` creating a session with `createdAt: Timestamp(2020, 1, 1)` instead of `request.time`.
   *Rejected by*: `data.createdAt == request.time && data.updatedAt == request.time`.

9. **Payload 9 (Immortal Field Mutation on Update)**:
   `user_1` updating a session's `createdAt` or `userId` field.
   *Rejected by*: `incoming().diff(existing()).affectedKeys().hasOnly(['title', 'updatedAt'])` and `incoming().createdAt == existing().createdAt`.

10. **Payload 10 (Denial-of-Wallet 1MB Message Text)**:
    `user_1` creating a message with a 200,000-character `text` string.
    *Rejected by*: `data.text is string && data.text.size() >= 1 && data.text.size() <= 50000`.

11. **Payload 11 (Unbounded Array Injection in `attachmentNames`)**:
    `user_1` creating a message with 25 elements in `attachmentNames` or non-string first element `[12345]`.
    *Rejected by*: `data.attachmentNames is list && data.attachmentNames.size() <= 5 && (data.attachmentNames.size() == 0 || (data.attachmentNames[0] is string && data.attachmentNames[0].size() <= 200))`.

12. **Payload 12 (Unauthorized Session List Scraping)**:
    `user_2` executing a collection query on `/users/user_1/sessions`.
    *Rejected by*: `request.auth.uid == userId && resource.data.userId == request.auth.uid`.

---

## 3. Red Team Audit & Conflict Report

- **Collection `/users/{userId}`**:
  - *Identity Spoofing*: Blocked (`data.uid == request.auth.uid && userId == request.auth.uid`).
  - *PII Blanket Test*: Passed (`allow get: if isOwner(userId); allow list: if false;`).
  - *Value Poisoning*: Blocked (`isValidUserProfile(incoming(), userId)` wraps both `create` and `update`).
- **Collection `/users/{userId}/sessions/{sessionId}`**:
  - *Identity Spoofing*: Blocked (`data.userId == request.auth.uid`).
  - *Query Trust Test*: Passed (`allow list` checks `resource.data.userId == request.auth.uid` without `get()`).
  - *Value Poisoning*: Blocked (`isValidChatSession(incoming(), userId, sessionId)` wraps `create` and `update`).
- **Collection `/users/{userId}/sessions/{sessionId}/messages/{messageId}`**:
  - *Master Gate Relational Sync*: Passed (`get()` verifies parent session ownership on single-doc operations).
  - *Query Trust Test*: Passed (`allow list` checks `resource.data.userId == request.auth.uid && resource.data.sessionId == sessionId`).
  - *Value Poisoning*: Blocked (`isValidChatMessage(incoming(), userId, sessionId, messageId)` wraps `create` and `update`).
