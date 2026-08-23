/**
 * Tier-1 smoke test for the OpenAI-compatible inference method (ADR-0049/0050)
 * against a local Ollama, with no auth, no API, and no UI.
 *
 * It drives the exact production seam: it builds the same {@link AgentEngine} the
 * Vocab chat uses (`createOpenAiAgentEngine`) and resolves the transport through
 * the same `resolveConnection` the header picker stores (ADR-0060), with a
 * connection pointed at Ollama. So a green run here means the engine, the
 * system prompts, and the SSE tool-call/text reducer all work end to end against
 * a real OpenAI-compatible server, before any of the auth-gated app is involved.
 *
 * It doubles as a model-comparison harness: pass a model and a prompt.
 *
 *   ollama serve                       # in another terminal
 *   ollama pull qwen3                  # or qwen3:8b, glm4, ...
 *   bun run apps/vocab/scripts/ollama-smoke.ts qwen3 "How do I say 'thank you'?"
 *
 * It also drives any hosted OpenAI-compatible endpoint (z.ai for GLM, Moonshot
 * for Kimi K2, OpenRouter, ...) by pointing OLLAMA_BASE_URL at it and setting
 * OLLAMA_API_KEY. The big coding models are too large to serve locally, so this
 * is the realistic path for them:
 *
 *   OLLAMA_BASE_URL=https://api.z.ai/api/paas/v4 \
 *   OLLAMA_API_KEY=$ZAI_KEY \
 *   bun run apps/vocab/scripts/ollama-smoke.ts glm-4.6 "How do I say 'thank you'?"
 *
 *   OLLAMA_BASE_URL=https://api.moonshot.ai/v1 \
 *   OLLAMA_API_KEY=$MOONSHOT_KEY \
 *   bun run apps/vocab/scripts/ollama-smoke.ts kimi-k2-0905 "..."
 *
 * Env:
 *   OLLAMA_BASE_URL   OpenAI-compatible base URL (default http://localhost:11434/v1)
 *   OLLAMA_API_KEY    Bearer key for a hosted endpoint (omit for local Ollama)
 */

import {
	type AgentEngineRequest,
	createOpenAiAgentEngine,
	resolveConnection,
} from '@epicenter/client';
import { VOCAB_SYSTEM_PROMPT } from '../vocab.js';

const model = process.argv[2] ?? 'qwen3';
const userPrompt =
	process.argv[3] ?? 'Teach me how to order coffee in Mandarin. Keep it short.';
const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1';
const apiKey = process.env.OLLAMA_API_KEY;

/**
 * Fail fast with a readable message if Ollama is not up or the model is not
 * pulled, instead of letting the engine surface a raw connection error mid
 * stream.
 */
async function preflight(): Promise<void> {
	let response: Response;
	try {
		response = await fetch(`${baseUrl}/models`, {
			headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
		});
	} catch (error) {
		throw new Error(
			`Cannot reach an OpenAI-compatible server at ${baseUrl}. Is \`ollama serve\` running? (${String(error)})`,
		);
	}
	if (!response.ok) {
		// Some hosted endpoints don't expose /models or gate it; warn and let the
		// real chat request be the source of truth instead of hard-failing here.
		console.warn(
			`! GET ${baseUrl}/models returned ${response.status}; skipping the model-present check.\n`,
		);
		return;
	}
	const body = (await response.json()) as { data?: Array<{ id: string }> };
	const available = (body.data ?? []).map((entry) => entry.id);
	const present = available.some(
		(id) => id === model || id.startsWith(`${model}:`),
	);
	if (!present) {
		console.warn(
			`! Model "${model}" is not in the server's list (${available.join(', ') || 'none'}).`,
		);
		console.warn(`! If this is Ollama, run: ollama pull ${model}\n`);
	}
}

async function main(): Promise<void> {
	await preflight();

	// The exact device-connection path the header picker stores (ADR-0060): a
	// connection carries no Epicenter bearer (the resolver never sees one), so this
	// turn reaches only the user's URL with the user's key. The model is paired
	// separately below (a connection carries no model).
	const { fetch, baseURL } = resolveConnection({ baseUrl, apiKey });

	const engine = createOpenAiAgentEngine({
		data: () => ({
			fetch,
			baseURL,
			model,
			systemPrompts: [VOCAB_SYSTEM_PROMPT],
		}),
	});

	// Vocab is capability-free: one user turn, an empty tool catalog, one text step.
	const request: AgentEngineRequest = {
		messages: [{ role: 'user', content: userPrompt }],
		tools: [],
	};

	console.log(`> model:   ${model}`);
	console.log(`> backend: ${baseURL}`);
	console.log(`> user:    ${userPrompt}\n`);

	let text = '';
	let toolCalls = 0;
	for await (const chunk of engine(request, new AbortController().signal)) {
		if (chunk.type === 'text-delta') {
			text += chunk.delta;
			process.stdout.write(chunk.delta);
		} else if (chunk.type === 'tool-call') {
			toolCalls += 1;
		} else if (chunk.type === 'run-error') {
			console.error(
				`\n\n✗ run-error${chunk.code ? ` [${chunk.code}]` : ''}: ${chunk.message}`,
			);
			process.exit(1);
		}
	}

	if (text.length === 0) {
		console.error(
			'\n✗ Stream finished with no text. The model returned nothing.',
		);
		process.exit(1);
	}
	console.log(
		`\n\n✓ ok — streamed ${text.length} chars${toolCalls ? `, ${toolCalls} tool call(s)` : ''}.`,
	);
}

main().catch((error: unknown) => {
	console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
