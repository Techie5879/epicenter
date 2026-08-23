import type { StandardSchemaV1 } from '@standard-schema/spec';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { Err, tryAsync } from 'wellcrafted/result';
import type { HttpService } from './types';
import { HttpError } from './types';

export type {
	ConnectionError,
	HttpService,
	ParseError,
	ResponseError,
} from './types';
export { HttpError } from './types';

/**
 * Tauri's HTTP plugin fetch. Used by SDK clients (OpenAI, Anthropic) to
 * bypass CORS restrictions in the desktop app.
 */
export const customFetch = tauriFetch;

export const HttpServiceLive = {
	async post({ body, url, schema, headers }) {
		const { data: response, error: responseError } = await tryAsync({
			try: () =>
				tauriFetch(url, {
					method: 'POST',
					body,
					headers,
				}),
			catch: (error) =>
				HttpError.Connection({
					cause: error,
				}),
		});
		if (responseError) return Err(responseError);

		if (!response.ok) {
			return HttpError.Response({
				response,
				body: await response.json(),
			});
		}

		const parseResult = await tryAsync({
			try: async () => {
				const json = await response.json();
				const result = await schema['~standard'].validate(json);
				if (result.issues) {
					throw new Error(
						result.issues.map((issue) => issue.message).join(', '),
					);
				}
				return result.value as StandardSchemaV1.InferOutput<typeof schema>;
			},
			catch: (error) =>
				HttpError.Parse({
					cause: error,
				}),
		});
		return parseResult;
	},
} satisfies HttpService;
