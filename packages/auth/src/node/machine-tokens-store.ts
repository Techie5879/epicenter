import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import { createLogger, type Logger } from 'wellcrafted/logger';
import { Err, Ok, type Result, tryAsync } from 'wellcrafted/result';
import {
	PersistedAuth,
	type PersistedAuth as PersistedAuthType,
} from '../auth-types.js';

export const MachineAuthStorageError = defineErrors({
	StorageFailed: ({ cause }: { cause: unknown }) => ({
		message: `Could not access machine auth storage: ${extractErrorMessage(cause)}`,
		cause,
	}),
	PermissionsTooOpen: ({
		filePath,
		mode,
	}: {
		filePath: string;
		mode: number;
	}) => ({
		message: `Refusing to load ${filePath}: permissions ${mode.toString(8)} are too permissive. Run: chmod 600 ${filePath}`,
		filePath,
		mode,
	}),
});

export type MachineAuthStorageError = InferErrors<
	typeof MachineAuthStorageError
>;

function defaultAuthFilePath(): string {
	return path.join(process.env.HOME ?? os.homedir(), '.epicenter', 'auth.json');
}

/**
 * Read the persisted auth cell from `~/.epicenter/auth.json` (or override).
 *
 * - Missing file -> `Ok(null)` (signed-out).
 * - Corrupt JSON or shape mismatch -> log warning, `Ok(null)`.
 * - Permissions wider than 0o600 on a regular file -> refuse with a clear
 *   chmod hint. The user fixes once and is back in business.
 */
export async function loadMachineTokens({
	filePath = defaultAuthFilePath(),
	log = createLogger('machine-tokens-store'),
}: {
	filePath?: string;
	log?: Logger;
} = {}): Promise<Result<PersistedAuthType | null, MachineAuthStorageError>> {
	const stat = await tryAsync({
		try: () => fs.stat(filePath),
		catch: (cause) => MachineAuthStorageError.StorageFailed({ cause }),
	});
	if (stat.error) {
		const cause = stat.error.cause as NodeJS.ErrnoException | undefined;
		if (cause?.code === 'ENOENT') return Ok(null);
		return Err(stat.error);
	}
	if (process.platform !== 'win32') {
		const mode = stat.data.mode & 0o777;
		if ((mode & 0o077) !== 0) {
			return Err(
				MachineAuthStorageError.PermissionsTooOpen({ filePath, mode }).error,
			);
		}
	}

	const read = await tryAsync({
		try: () => fs.readFile(filePath, 'utf-8'),
		catch: (cause) => MachineAuthStorageError.StorageFailed({ cause }),
	});
	if (read.error) return Err(read.error);

	try {
		return Ok(PersistedAuth.assert(JSON.parse(read.data)));
	} catch (cause) {
		log.warn(
			MachineAuthStorageError.StorageFailed({
				cause: new Error(
					`Discarding corrupted ${filePath}: ${extractErrorMessage(cause)}`,
					{ cause },
				),
			}),
		);
		return Ok(null);
	}
}

/**
 * Write or remove the persisted auth cell. Atomic via `.tmp` + rename so a
 * crash mid-write never leaves a half-written file.
 */
export async function saveMachineTokens(
	value: PersistedAuthType | null,
	{
		filePath = defaultAuthFilePath(),
	}: {
		filePath?: string;
	} = {},
): Promise<Result<undefined, MachineAuthStorageError>> {
	return tryAsync({
		try: async (): Promise<undefined> => {
			if (value === null) {
				try {
					await fs.unlink(filePath);
				} catch (cause) {
					const code = (cause as NodeJS.ErrnoException | undefined)?.code;
					if (code !== 'ENOENT') throw cause;
				}
				return undefined;
			}
			await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
			const tmp = `${filePath}.tmp`;
			await fs.writeFile(tmp, JSON.stringify(PersistedAuth.assert(value)), {
				mode: 0o600,
			});
			await fs.rename(tmp, filePath);
			return undefined;
		},
		catch: (cause) => MachineAuthStorageError.StorageFailed({ cause }),
	});
}
