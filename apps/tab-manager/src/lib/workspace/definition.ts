/**
 * Workspace schema — branded IDs, table definitions, and awareness shape.
 *
 * Browser-agnostic: no Chrome APIs, no IndexedDB, no Svelte imports.
 * This file can be safely imported by the CLI daemon or any Node/Bun process.
 *
 * The extension-bound wiring lives in `lib/tab-manager/extension.ts`, which
 * imports this schema and composes every attachment inside its `openTabManagerBrowser`
 * factory.
 */

import {
	defineTable,
	generateId,
	type Id,
	type InferTableRow,
} from '@epicenter/workspace';
import { type } from 'arktype';
import type { Brand } from 'wellcrafted/brand';
import type { JsonValue } from 'wellcrafted/json';

export const TAB_MANAGER_WORKSPACE_ID = 'epicenter.tab-manager';

// ─────────────────────────────────────────────────────────────────────────────
// Branded ID Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Branded device ID — nanoid generated once per browser installation.
 *
 * Prevents accidental mixing with other string IDs (conversation, tab, etc.).
 */
export type DeviceId = string & Brand<'DeviceId'>;
export const DeviceId = type('string').as<DeviceId>();

/**
 * Branded saved tab ID — nanoid generated when a tab is explicitly saved.
 *
 * Prevents accidental mixing with composite tab IDs or other string IDs.
 */
export type SavedTabId = Id & Brand<'SavedTabId'>;
export const SavedTabId = type('string').as<SavedTabId>();
/**
 * Generate a unique {@link SavedTabId} for a newly saved tab.
 *
 * Wraps `generateId()` with the branded cast so call sites never
 * need a manual cast.
 *
 * @example
 * ```typescript
 * workspace.tables.savedTabs.set({
 *   id: generateSavedTabId(),
 *   url: tab.url,
 *   title: tab.title || 'Untitled',
 *   // …remaining fields
 * });
 * ```
 */
export const generateSavedTabId = (): SavedTabId => generateId() as SavedTabId;

/**
 * Branded bookmark ID — nanoid generated when a URL is bookmarked.
 *
 * Unlike {@link SavedTabId}, bookmarks persist indefinitely—opening a
 * bookmarked URL does NOT delete the record.
 */
export type BookmarkId = Id & Brand<'BookmarkId'>;
export const BookmarkId = type('string').as<BookmarkId>();
/**
 * Generate a unique {@link BookmarkId} for a newly created bookmark.
 *
 * Wraps `generateId()` with the branded cast so call sites never
 * need a manual cast.
 *
 * @example
 * ```typescript
 * workspace.tables.bookmarks.set({
 *   id: generateBookmarkId(),
 *   url: tab.url,
 *   title: tab.title || 'Untitled',
 *   // …remaining fields
 * });
 * ```
 */
export const generateBookmarkId = (): BookmarkId => generateId() as BookmarkId;

/**
 * Branded conversation ID — nanoid generated when a chat conversation is created.
 *
 * Used as the primary key for conversations and as a foreign key in chat messages.
 * Prevents accidental mixing with message IDs or other string IDs.
 */
export type ConversationId = Id & Brand<'ConversationId'>;
export const ConversationId = type('string').as<ConversationId>();
/**
 * Generate a unique {@link ConversationId} for a new chat conversation.
 *
 * Wraps `generateId()` with the branded cast so call sites never
 * need a manual cast.
 *
 * @example
 * ```typescript
 * const id = generateConversationId();
 * workspace.tables.conversations.set({
 *   id,
 *   title: 'New Chat',
 *   provider: DEFAULT_PROVIDER,
 *   model: DEFAULT_MODEL,
 *   createdAt: Date.now(),
 *   updatedAt: Date.now(),
 *   // …remaining fields
 * });
 * ```
 */
export const generateConversationId = (): ConversationId =>
	generateId() as ConversationId;

/**
 * Branded chat message ID — nanoid generated when a message is created.
 *
 * Prevents accidental mixing with conversation IDs or other string IDs.
 */
export type ChatMessageId = Id & Brand<'ChatMessageId'>;
export const ChatMessageId = type('string').as<ChatMessageId>();
/**
 * Generate a unique {@link ChatMessageId} for a new chat message.
 *
 * Wraps `generateId()` with the branded cast so call sites never
 * need a manual cast.
 *
 * @example
 * ```typescript
 * const userMessageId = generateChatMessageId();
 * workspace.tables.chatMessages.set({
 *   id: userMessageId,
 *   conversationId,
 *   role: 'user',
 *   parts: [{ type: 'text', content }],
 *   createdAt: Date.now(),
 *   // …remaining fields
 * });
 * ```
 */
export const generateChatMessageId = (): ChatMessageId =>
	generateId() as ChatMessageId;

// ─────────────────────────────────────────────────────────────────────────────
// Table Definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Devices — tracks browser installations for multi-device sync.
 *
 * Each device generates a unique ID on first install, stored in storage.local.
 * This enables syncing tabs across multiple computers while preventing ID collisions.
 */
const devicesTable = defineTable(
	type({
		id: DeviceId, // NanoID, generated once on install
		name: 'string', // User-editable: "Chrome on macOS", "Firefox on Windows"
		lastSeen: 'string', // ISO timestamp, updated on each sync
		browser: 'string', // 'chrome' | 'firefox' | 'safari' | 'edge' | 'opera'
		_v: '1',
	}),
);
export type Device = InferTableRow<typeof devicesTable>;

/**
 * Saved tabs — explicitly saved tabs that can be restored later.
 *
 * Unlike live browser state (which is ephemeral and Chrome-owned),
 * saved tabs are shared across all devices. Any device can read, edit, or
 * restore a saved tab.
 *
 * Created when a user explicitly saves a tab (close + persist).
 * Deleted when a user restores the tab (opens URL locally + deletes row).
 */
const savedTabsTable = defineTable(
	type({
		id: SavedTabId, // nanoid, generated on save
		url: 'string', // The tab URL
		title: 'string', // Tab title at time of save
		'favIconUrl?': 'string | undefined', // Favicon URL (nullable)
		pinned: 'boolean', // Whether tab was pinned
		sourceDeviceId: DeviceId, // Device that saved this tab
		savedAt: 'number', // Timestamp (ms since epoch)
		_v: '1',
	}),
);
export type SavedTab = InferTableRow<typeof savedTabsTable>;

/**
 * Bookmarks — permanent, non-consumable URL references.
 *
 * Unlike saved tabs (which are deleted on restore), bookmarks persist
 * indefinitely. Opening a bookmark creates a new browser tab but does NOT
 * delete the record. Synced across devices via Y.Doc CRDT.
 */
const bookmarksTable = defineTable(
	type({
		id: BookmarkId, // nanoid, generated on bookmark
		url: 'string', // The bookmarked URL
		title: 'string', // Title at time of bookmark
		'favIconUrl?': 'string | undefined', // Favicon URL (nullable)
		'description?': 'string | undefined', // Optional user note
		sourceDeviceId: DeviceId, // Device that created the bookmark
		createdAt: 'number', // Timestamp (ms since epoch)
		_v: '1',
	}),
);
export type Bookmark = InferTableRow<typeof bookmarksTable>;

/**
 * AI conversations — metadata for each chat thread.
 *
 * Each conversation has its own message history (linked via
 * chatMessages.conversationId). Subpages use `parentId` to form
 * a tree — e.g. a deep research thread spawned from a specific
 * message in a parent conversation.
 */
const conversationsTable = defineTable(
	type({
		id: ConversationId,
		title: 'string',
		'parentId?': ConversationId.or('undefined'),
		'sourceMessageId?': ChatMessageId.or('undefined'),
		'systemPrompt?': 'string | undefined',
		provider: 'string',
		model: 'string',
		createdAt: 'number',
		updatedAt: 'number',
		_v: '1',
	}),
);
export type Conversation = InferTableRow<typeof conversationsTable>;

/**
 * Chat messages — TanStack AI UIMessage data persisted per conversation.
 *
 * The `parts` field stores MessagePart[] as a native array (no JSON
 * serialization). Runtime validation is skipped for parts because
 * they are always produced by TanStack AI — compile-time drift
 * detection in `ui-message.ts` catches type mismatches on
 * TanStack AI upgrades instead.
 *
 * @see {@link file://./ai/ui-message.ts} — drift detection + toUiMessage boundary
 */
const chatMessagesTable = defineTable(
	type({
		id: ChatMessageId,
		conversationId: ConversationId,
		role: "'user' | 'assistant' | 'system'",
		parts: type({} as type.cast<JsonValue[]>),
		createdAt: 'number',
		_v: '1',
	}),
);
export type ChatMessage = InferTableRow<typeof chatMessagesTable>;

/**
 * Tool trust — per-tool approval preferences for AI chat.
 *
 * Each row represents a user's trust decision for a specific destructive tool.
 * Tools not in this table default to 'ask' (show approval UI). Users can
 * escalate to 'always' (auto-approve) via the inline approval buttons.
 *
 * The `id` is the flat action name used by CLI and RPC surfaces
 * (e.g. `tabs_close`).
 */
const toolTrustTable = defineTable(
	type({
		id: 'string',
		trust: "'ask' | 'always'",
		_v: '1',
	}),
);
export type ToolTrust = InferTableRow<typeof toolTrustTable>;

// ─────────────────────────────────────────────────────────────────────────────
// Schema Exports
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Table definitions for the tab-manager workspace. Composed in
 * `lib/tab-manager/extension.ts` via `encryption.attachTables(tabManagerTables)`.
 * Kept separate so actions and future consumers can derive their input
 * types from one source of truth.
 */
export const tabManagerTables = {
	devices: devicesTable,
	savedTabs: savedTabsTable,
	bookmarks: bookmarksTable,
	conversations: conversationsTable,
	chatMessages: chatMessagesTable,
	toolTrust: toolTrustTable,
};
