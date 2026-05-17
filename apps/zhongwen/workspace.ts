/**
 * Zhongwen workspace: schema definition with branded IDs and table/kv defs.
 *
 * Distribution: this file is the `@epicenter/zhongwen` package root export.
 * The table and KV shapes here are the wire contract for sync: forking a
 * column shape breaks sync compatibility with peers running the canonical
 * schema. Browser and daemon entrypoints compose runtime-specific attachments
 * around the shared opener below.
 */

import {
	defineKv,
	defineTable,
	generateId,
	type Id,
	type InferTableRow,
	type LocalOwner,
} from '@epicenter/workspace';
import { type } from 'arktype';
import type { Brand } from 'wellcrafted/brand';
import type { JsonValue } from 'wellcrafted/json';
import * as Y from 'yjs';

export const ZHONGWEN_WORKSPACE_ID = 'epicenter.zhongwen';

// ─────────────────────────────────────────────────────────────────────────────
// Branded ID Types
// ─────────────────────────────────────────────────────────────────────────────

export type ConversationId = Id & Brand<'ConversationId'>;
export const ConversationId = type('string').as<ConversationId>();
export const generateConversationId = (): ConversationId =>
	generateId() as ConversationId;

export type ChatMessageId = Id & Brand<'ChatMessageId'>;
export const ChatMessageId = type('string').as<ChatMessageId>();
export const generateChatMessageId = (): ChatMessageId =>
	generateId() as ChatMessageId;

// ─────────────────────────────────────────────────────────────────────────────
// Table Definitions
// ─────────────────────────────────────────────────────────────────────────────

const conversationsTable = defineTable(
	type({
		id: ConversationId,
		title: 'string',
		provider: 'string',
		model: 'string',
		createdAt: 'number',
		updatedAt: 'number',
		_v: '1',
	}),
);
export type Conversation = InferTableRow<typeof conversationsTable>;

const chatMessagesTable = defineTable(
	type({
		id: ChatMessageId,
		conversationId: ConversationId,
		role: "'user' | 'assistant'",
		parts: type({} as type.cast<JsonValue[]>),
		createdAt: 'number',
		_v: '1',
	}),
);
export type ChatMessage = InferTableRow<typeof chatMessagesTable>;

// ─────────────────────────────────────────────────────────────────────────────
// Schema Records
// ─────────────────────────────────────────────────────────────────────────────

export const zhongwenTables = {
	conversations: conversationsTable,
	chatMessages: chatMessagesTable,
};

export const zhongwenKv = {
	showPinyin: defineKv(type('boolean'), true),
};
type AttachZhongwenEncryption = LocalOwner['attachEncryption'];

export function openZhongwenWorkspace(
	attachEncryption: AttachZhongwenEncryption,
	options: { clientId?: number } = {},
) {
	const ydoc = new Y.Doc({ guid: ZHONGWEN_WORKSPACE_ID, gc: false });
	if (options.clientId !== undefined) {
		ydoc.clientID = options.clientId;
	}
	const encryption = attachEncryption(ydoc);
	const tables = encryption.attachTables(zhongwenTables);
	const kv = encryption.attachKv(zhongwenKv);

	return {
		ydoc,
		encryption,
		tables,
		kv,
		batch: (fn: () => void) => ydoc.transact(fn),
	};
}

export type ZhongwenWorkspace = ReturnType<typeof openZhongwenWorkspace>;
