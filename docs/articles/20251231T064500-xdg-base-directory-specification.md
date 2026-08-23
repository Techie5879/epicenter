# The XDG Base Directory Specification: Why Your App Belongs in ~/.config

> **Note (2026-05-22)**: This article is historical. Epicenter no longer writes machine-wide state to top-level `~/.epicenter/`. Machine auth uses the platform data directory from `env-paths('epicenter')`, daemon runtime files use the OS runtime directory, daemon logs use the platform log directory, and generated project data stays under `<projectDir>/.epicenter/`.

If you run `ls -a ~` on a machine that has been in use for more than a month, you will likely see a graveyard of dotfiles. From `~/.ssh` and `~/.bashrc` to more modern offenders like `~/.docker`, `~/.npm`, and `~/.claude`, the root of the user's home directory has become a dumping ground for application metadata.

This clutter is not just an aesthetic annoyance; it is a structural failure. When application configuration, persistent data, and volatile caches are all thrown into the same top-level directory, managing backups, syncing settings across machines, and maintaining system hygiene becomes unnecessarily difficult.

The solution to this problem is the XDG Base Directory Specification.

## The Problem: The Legacy of Dotfile Proliferation

In the early days of Unix, applications stored configuration in hidden "dotfiles" within the home directory to stay out of sight during a standard `ls`. As the number of applications grew, so did the number of hidden files.

Without a standard, every developer chose their own path. Some created single files (`~/.vimrc`), others created directories (`~/.config_app`). Some stored logs in these directories; others stored multi-gigabyte database files. This makes it nearly impossible for a user to know which files are safe to delete, which need to be backed up, and which are merely temporary caches.

## The Solution: The XDG Specification

Developed by the Freedesktop.org project, the XDG Base Directory Specification defines a standard set of environment variables and default locations for application files. It categorizes files into three primary buckets:

1. **Configuration (`XDG_CONFIG_HOME`)**: User-specific configuration files. These are the settings a user might want to edit or track in a "dotfiles" git repository.
   - **Default**: `~/.config/`
2. **Data (`XDG_DATA_HOME`)**: Persistent data files that the application needs to function but that the user rarely edits manually (e.g., local databases, icons, or plugins).
   - **Default**: `~/.local/share/`
3. **Cache (`XDG_CACHE_HOME`)**: Non-essential, volatile data files. These should be safe to delete at any time without data loss.
   - **Default**: `~/.cache/`

By following this spec, an app named "nebula" would store its settings in `~/.config/nebula/`, its database in `~/.local/share/nebula/`, and its temporary logs in `~/.cache/nebula/`.

## Adoption and Resistance

Most modern Linux utilities and a growing number of macOS and cross-platform tools respect these boundaries. OpenCode, for instance, follows these conventions to ensure a clean user environment.

However, several high-profile tools remain "bad citizens" of the home directory:

- **Docker**: Persists in using `~/.docker/` for both config and credentials.
- **Claude Code**: Anthropic's CLI defaults to `~/.claude/` for its configuration and state.
- **Node/NPM**: Continues to clutter the home directory with `~/.npm/` and `~/.node_repl_history`.

While some developers argue that a dedicated home directory folder makes their app "easier to find," it actually makes the system harder to manage. Users who want to back up their configurations must now hunt for dozens of different hidden folders rather than simply backing up `~/.config`.

## Why You Should Adopt XDG

Adopting the XDG spec in your application provides several immediate benefits:

1. **Predictability**: Users and system administrators know exactly where to look for your files.
2. **Easy Backups**: Users can back up `~/.config` and `~/.local/share` while ignoring `~/.cache`, saving space and time.
3. **Environmental Overrides**: By respecting the environment variables, you allow power users to move your app's data to a different drive or partition without using symlinks.
4. **Cleaner UX**: Your application stops participating in the "dotfile soup" that plagues the modern home directory.

## Implementation: Proper Path Resolution

Implementing XDG support is straightforward. You should always check for the environment variable first, then fall back to the standard default.

Here is a robust pattern for resolving the configuration path in TypeScript:

```typescript
import { homedir } from 'os';
import { join } from 'path';

function getConfigDir(appName: string): string {
	// 1. Check for XDG_CONFIG_HOME environment variable
	const xdgConfigHome = process.env.XDG_CONFIG_HOME;

	if (xdgConfigHome) {
		return join(xdgConfigHome, appName);
	}

	// 2. Platform-specific defaults
	if (process.platform === 'win32') {
		return join(
			process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'),
			appName,
		);
	}

	// 3. Fallback to default ~/.config for macOS and Linux
	return join(homedir(), '.config', appName);
}

function getDataDir(appName: string): string {
	const xdgDataHome = process.env.XDG_DATA_HOME;

	if (xdgDataHome) {
		return join(xdgDataHome, appName);
	}

	if (process.platform === 'win32') {
		return join(
			process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
			appName,
		);
	}

	return join(homedir(), '.local', 'share', appName);
}

// Usage
const configDir = getConfigDir('my_tool'); // ~/.config/my_tool
const dataDir = getDataDir('my_tool'); // ~/.local/share/my_tool
```

## Conclusion

The `~/.config/` folder is more than just a common directory; it is a sign of a mature, well-behaved application. As developers, we should respect the user's home directory as their personal space, not our application's scratchpad. By adopting the XDG Base Directory Specification, we move toward a world where the home directory is clean, predictable, and easy to manage.
