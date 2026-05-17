import yargs from 'yargs';
import { authCommand } from './commands/auth';
import { daemonCommand } from './commands/daemon';
import { listCommand } from './commands/list';
import { peersCommand } from './commands/peers';
import { runCommand } from './commands/run';

const REMOVED_DAEMON_COMMANDS = new Set(['up', 'down', 'ps', 'logs']);

/**
 * Create the Epicenter CLI instance.
 *
 * Introspect and invoke `defineQuery` / `defineMutation` actions exposed by
 * folder-routed daemon extensions, either locally or on a peer that's online
 * right now.
 *
 *   - `auth`:  manage the local machine auth session (pre-workspace)
 *   - `daemon`: operate daemon lifecycle commands
 *   - `list`:  tree view of runnable actions (local schema is authoritative)
 *   - `run`:   invoke one by route-qualified action key; `--peer` dispatches over RPC
 *   - `peers`: enumerate other clients currently online via the workspace presence row
 *
 * Specs: `specs/20260421T155436-cli-scripting-first-redesign.md` (base
 * surface), `specs/20260423T174126-cli-remote-peer-rpc.md` (`peers` + `--peer`).
 */
export function createCLI() {
	return {
		run: async (argv: string[]) => {
			const [command] = argv;
			if (command && REMOVED_DAEMON_COMMANDS.has(command)) {
				throw new Error(`Unknown command: ${command}`);
			}

			const cli = yargs()
				.scriptName('epicenter')
				.command(authCommand)
				.command(daemonCommand)
				.command(listCommand)
				.command(peersCommand)
				.command(runCommand)
				.demandCommand(1)
				.strict()
				.exitProcess(false)
				.help();

			await cli.parse(argv);
		},
	};
}
