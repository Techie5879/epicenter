/**
 * Reddit CSV Schemas
 *
 * UNIFIED schemas that do EVERYTHING in one pass:
 * 1. Validate CSV structure
 * 2. Parse values (dates → ISO, numbers, empty → null)
 * 3. Compute IDs where needed
 * 4. Output table-ready rows
 *
 * Types are inferred from schemas. No separate type definitions needed.
 *
 * Usage:
 * ```typescript
 * const result = csvSchemas.posts(rawRow);
 * if (result instanceof type.errors) return; // handle error
 * // result is already typed and ready for table insertion
 * ```
 */

import { type } from 'arktype';
import { emptyToNull as _emptyToNull, parseDateToIso } from './transforms.js';

// ═══════════════════════════════════════════════════════════════════════════════
// MORPHS (arktype wrappers around shared plain functions)
// ═══════════════════════════════════════════════════════════════════════════════

/** Empty string → null */
const emptyToNull = type('string').pipe(_emptyToNull);

/** Optional string → null */
const optionalToNull = type('string | undefined').pipe(_emptyToNull);

/** Date string → ISO string | null */
const dateToIso = type('string').pipe(parseDateToIso);

/** Optional date → ISO string | null */
const optionalDateToIso = type('string | undefined').pipe(parseDateToIso);

/** Vote direction */
const voteDirection = type("'up' | 'down' | 'none' | 'removed'");

// ═══════════════════════════════════════════════════════════════════════════════
// TABLE SCHEMAS (CSV → Table Row in ONE pass)
// ═══════════════════════════════════════════════════════════════════════════════

/** posts.csv → posts table (has natural ID) */
export const posts = type({
	id: 'string',
	permalink: emptyToNull,
	date: dateToIso,
	subreddit: 'string',
	gildings: type('string.numeric.parse'),
	'title?': 'string',
	'url?': 'string',
	'body?': 'string',
});

/** comments.csv → comments table (has natural ID) */
export const comments = type({
	id: 'string',
	permalink: emptyToNull,
	date: dateToIso,
	subreddit: 'string',
	gildings: type('string.numeric.parse'),
	link: 'string',
	'parent?': 'string',
	'body?': 'string',
	'media?': 'string',
});

/** drafts.csv → drafts table (has natural ID) */
export const drafts = type({
	id: 'string',
	'title?': 'string',
	'body?': 'string',
	'kind?': 'string',
	created: optionalDateToIso,
	'spoiler?': 'string',
	'nsfw?': 'string',
	'original_content?': 'string',
	'content_category?': 'string',
	'flair_id?': 'string',
	'flair_text?': 'string',
	'send_replies?': 'string',
	'subreddit?': 'string',
	'is_public_link?': 'string',
});

/** post_votes.csv → post_votes table (has natural ID) */
export const postVotes = type({
	id: 'string',
	permalink: 'string',
	direction: voteDirection,
});

/** comment_votes.csv → comment_votes table (has natural ID) */
export const commentVotes = type({
	id: 'string',
	permalink: 'string',
	direction: voteDirection,
});

/** poll_votes.csv → poll_votes table (computed ID) */
export const pollVotes = type({
	post_id: 'string',
	'user_selection?': 'string',
	'text?': 'string',
	'image_url?': 'string',
	'is_prediction?': 'string',
	'stake_amount?': 'string',
}).pipe((row) => ({
	id: [
		row.post_id,
		row.user_selection ?? '',
		row.text ?? '',
		row.image_url ?? '',
		row.is_prediction ?? '',
		row.stake_amount ?? '',
	].join('|'),
	...row,
}));

/** saved_posts.csv → saved_posts table (has natural ID) */
export const savedPosts = type({
	id: 'string',
	permalink: 'string',
});

/** saved_comments.csv → saved_comments table (has natural ID) */
export const savedComments = type({
	id: 'string',
	permalink: 'string',
});

/** hidden_posts.csv → hidden_posts table (has natural ID) */
export const hiddenPosts = type({
	id: 'string',
	permalink: 'string',
});

/** messages.csv → messages table (has natural ID) */
export const messages = type({
	id: 'string',
	permalink: 'string',
	thread_id: optionalToNull,
	date: optionalDateToIso,
	'from?': 'string',
	'to?': 'string',
	'subject?': 'string',
	'body?': 'string',
});

/** messages_archive.csv → messages_archive table (has natural ID) */
export const messagesArchive = messages;

/** chat_history.csv → chat_history table (rename message_id → id) */
export const chatHistory = type({
	message_id: 'string',
	created_at: optionalDateToIso,
	updated_at: optionalDateToIso,
	username: optionalToNull,
	message: optionalToNull,
	thread_parent_message_id: optionalToNull,
	channel_url: optionalToNull,
	subreddit: optionalToNull,
	channel_name: optionalToNull,
	conversation_type: optionalToNull,
}).pipe(({ message_id, ...rest }) => ({
	id: message_id,
	...rest,
}));

/** subreddit CSVs → subreddit table (subreddit becomes ID) */
export const subreddit = type({
	subreddit: 'string',
}).pipe((row) => ({
	id: row.subreddit,
	subreddit: row.subreddit,
}));

// Aliases for the three subreddit tables
export const subscribedSubreddits = subreddit;
export const moderatedSubreddits = subreddit;
export const approvedSubmitterSubreddits = subreddit;

/** multireddits.csv → multireddits table (has natural ID) */
export const multireddits = type({
	id: 'string',
	'display_name?': 'string',
	date: optionalDateToIso,
	'description?': 'string',
	'privacy?': 'string',
	'subreddits?': 'string',
	'image_url?': 'string',
	'is_owner?': 'string',
	'favorited?': 'string',
	'followers?': 'string',
});

/** gilded_content.csv → gilded_content table (computed ID) */
export const gildedContent = type({
	content_link: 'string',
	'award?': 'string',
	'amount?': 'string',
	date: optionalDateToIso,
}).pipe((row) => ({
	id: [
		row.content_link,
		row.date ?? '',
		row.award ?? '',
		row.amount ?? '',
	].join('|'),
	...row,
}));

/** gold_received.csv → gold_received table (computed ID) */
export const goldReceived = type({
	content_link: 'string',
	'gold_received?': 'string',
	'gilder_username?': 'string',
	date: optionalDateToIso,
}).pipe((row) => ({
	id: [
		row.content_link,
		row.date ?? '',
		row.gold_received ?? '',
		row.gilder_username ?? '',
	].join('|'),
	...row,
}));

/** purchases.csv → purchases table (transaction_id becomes ID) */
export const purchases = type({
	'processor?': 'string',
	transaction_id: 'string',
	'product?': 'string',
	date: optionalDateToIso,
	'cost?': 'string',
	'currency?': 'string',
	'status?': 'string',
}).pipe((row) => ({
	id: row.transaction_id,
	...row,
}));

/** subscriptions.csv → subscriptions table (subscription_id becomes ID) */
export const subscriptions = type({
	'processor?': 'string',
	subscription_id: 'string',
	'product?': 'string',
	'product_id?': 'string',
	'product_name?': 'string',
	'status?': 'string',
	start_date: optionalDateToIso,
	end_date: optionalDateToIso,
}).pipe((row) => ({
	id: row.subscription_id,
	...row,
}));

/** payouts.csv → payouts table (computed ID with fallback) */
export const payouts = type({
	'payout_amount_usd?': 'string',
	date: 'string',
	'payout_id?': 'string',
}).pipe((row) => {
	const dateIso = parseDateToIso(row.date);
	return {
		id: row.payout_id ?? dateIso ?? row.date,
		date: dateIso,
		payout_id: row.payout_id,
		payout_amount_usd: row.payout_amount_usd,
	};
});

/** friends.csv → friends table (username becomes ID) */
export const friends = type({
	username: 'string',
	'note?': 'string',
}).pipe((row) => ({
	id: row.username,
	...row,
}));

/** announcements.csv → announcements table (announcement_id becomes ID) */
export const announcements = type({
	announcement_id: 'string',
	sent_at: optionalDateToIso,
	read_at: optionalDateToIso,
	from_id: optionalToNull,
	from_username: optionalToNull,
	subject: optionalToNull,
	body: optionalToNull,
	url: optionalToNull,
}).pipe((row) => ({
	id: row.announcement_id,
	...row,
}));

/** scheduled_posts.csv → scheduled_posts table (scheduled_post_id becomes ID) */
export const scheduledPosts = type({
	scheduled_post_id: 'string',
	'subreddit?': 'string',
	'title?': 'string',
	'body?': 'string',
	'url?': 'string',
	submission_time: optionalDateToIso,
	'recurrence?': 'string',
}).pipe((row) => ({
	id: row.scheduled_post_id,
	...row,
}));

// ═══════════════════════════════════════════════════════════════════════════════
// KV SCHEMAS (singleton CSVs)
// ═══════════════════════════════════════════════════════════════════════════════

export const statistics = type({ statistic: 'string', 'value?': 'string' });
export const user_preferences = type({
	preference: 'string',
	'value?': 'string',
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEMA REGISTRY (for data-driven processing)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * All table schemas in a registry for data-driven processing.
 * Each schema takes raw CSV row → outputs table-ready row.
 */
export const csvSchemas = {
	posts,
	comments,
	drafts,
	postVotes,
	commentVotes,
	pollVotes,
	savedPosts,
	savedComments,
	hiddenPosts,
	messages,
	messagesArchive,
	chatHistory,
	subscribedSubreddits,
	moderatedSubreddits,
	approvedSubmitterSubreddits,
	multireddits,
	gildedContent,
	goldReceived,
	purchases,
	subscriptions,
	payouts,
	friends,
	announcements,
	scheduledPosts,
} as const;

/** Union of all table schema names */
export type TableName = keyof typeof csvSchemas;
