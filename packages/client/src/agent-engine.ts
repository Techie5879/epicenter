/**
 * The client side of the inference-engine seam (ADR-0049/0050). The contract
 * (`AgentEngine`, `AgentEngineRequest`, `EngineChunk`, the prompt message shapes)
 * lives in `@epicenter/agent-protocol`, the leaf both this package and the
 * workspace loop import, so the wire shape cannot drift between them; this module
 * re-exports it and adds the one client-only transport type, {@link EngineFetch}.
 *
 * The OpenAI-compatible engine (`openai-provider.ts`) builds an
 * {@link AgentEngine} that emits {@link EngineChunk}s; the loop only ever sees
 * this vocabulary, so swapping the inference backend is the engine's concern,
 * never the loop's.
 */
export type {
	AgentEngine,
	AgentEngineRequest,
	AgentEngineToolDefinition,
	EngineChunk,
	ModelMessage,
	ModelToolCall,
} from '@epicenter/agent-protocol';

/**
 * The fetch an engine calls: a function from a URL plus init to a response.
 * Structurally `@epicenter/auth`'s `AuthFetch` and a plain `globalThis.fetch`,
 * but typed as the function shape rather than `typeof globalThis.fetch` because
 * the engine never needs `fetch.preconnect`, and an authed fetch wrapper (which
 * is what the gateway path passes) does not carry it. This is purely how the
 * engine reaches the wire, so it stays here rather than in the shared contract.
 */
export type EngineFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;
