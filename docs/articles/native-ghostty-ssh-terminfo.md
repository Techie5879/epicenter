# Native Ghostty SSH Needs Terminfo on the Remote Host

Ghostty identifies itself as `xterm-ghostty`. That is the honest terminal name. The problem starts when you SSH into a machine that does not know what `xterm-ghostty` means.

The failure mode looks stranger than the cause. Text jumps. Prompt redraws leave artifacts. Full-screen tools like `vim`, `less`, `top`, and `tmux` feel corrupted. A quick workaround like this often makes the session usable:

```sh
TERM=xterm-256color zsh
```

That works because `xterm-256color` is widely known. It is also a lie. The remote shell stops asking for Ghostty-specific behavior and pretends the terminal is a generic xterm-style terminal.

The cleaner fix is to teach the remote host about Ghostty.

```text
MacBook running Ghostty
  TERM=xterm-ghostty
  ssh braden@100.116.139.74

Mac Studio
  needs xterm-ghostty in its terminfo database
```

`TERM` is just a name. `terminfo` is the database that explains what the name can do: colors, cursor motion, alternate screen behavior, key sequences, mouse support, and other terminal capabilities.

## What We Changed

We installed Ghostty's `xterm-ghostty` terminfo entry on the Mac Studio, because the Studio is the machine being SSHed into.

On the Mac Studio, the entry now lives here:

```text
~/.terminfo/78/xterm-ghostty
```

The manual install command was:

```sh
TERMINFO=/Applications/Ghostty.app/Contents/Resources/terminfo \
  infocmp -x xterm-ghostty | tic -x -
```

After that, the server can answer this correctly:

```sh
infocmp xterm-ghostty >/dev/null && echo ok
```

If that prints `ok`, the host understands Ghostty sessions.

## What Belongs on Each Machine

The Ghostty config belongs on the machine where Ghostty is running. If Ghostty is open on the MacBook and you type `ssh braden@100.116.139.74`, then the Ghostty config belongs on the MacBook.

```ini
shell-integration-features = ssh-env,ssh-terminfo
```

Put that in:

```text
~/.config/ghostty/config.ghostty
```

Then fully restart Ghostty.

The terminfo entry belongs on the machine you SSH into. For this setup, that is the Mac Studio.

```text
MacBook
  Ghostty config

Mac Studio
  ~/.terminfo/78/xterm-ghostty
```

Ghostty's SSH integration uses that split. It tries to install `xterm-ghostty` terminfo on the remote host. If that works, the remote session keeps `TERM=xterm-ghostty`. If it cannot install terminfo, it falls back to `xterm-256color` and forwards Ghostty identity variables.

That gives the best default:

```text
use native Ghostty when possible
fall back only when the remote host cannot support it
```

## What Not To Do

Do not put this in `.zshrc`, `.zprofile`, or a global shell file:

```sh
export TERM=xterm-256color
```

That makes every terminal lie about itself. It may hide this one SSH problem, but it can also disable features or create new mismatches in local sessions.

An SSH-specific fallback is acceptable for old hosts you cannot fix:

```sshconfig
Host old-box
  HostName example.com
  User braden
  SetEnv TERM=xterm-256color
```

Use that as a per-host compatibility setting, not as the main setup.

## About New Tabs

`Command+T` is local. It belongs to Ghostty on the MacBook. If the current tab is SSHed into the Mac Studio, a new tab still starts as a new local Ghostty tab unless you configure Ghostty's command to SSH by default.

That distinction matters:

```text
Ghostty window and tabs
  local MacBook UI

Shell inside a tab
  local or remote, depending on whether you ran ssh
```

You can make every new Ghostty surface run SSH by setting Ghostty's `command` option:

```ini
command = ssh studio
```

But that is usually too blunt. Every new tab, split, and window becomes a remote session. Local terminal work gets awkward.

A better everyday setup is an SSH alias:

```sshconfig
Host studio
  HostName 100.116.139.74
  User braden
```

Then new tabs stay normal and connecting is short:

```sh
ssh studio
```

If the goal is to feel like the Mac Studio has tabs and panes, use `tmux` on the Studio after SSHing in:

```sh
ssh studio
tmux new -A -s main
```

Then `tmux` owns the remote windows and panes, while Ghostty owns the local tabs. That boundary is easier to reason about than trying to make every local tab secretly become a remote machine.

## The Rule

Use native Ghostty SSH support first:

```ini
shell-integration-features = ssh-env,ssh-terminfo
```

Install `xterm-ghostty` terminfo on machines you control:

```sh
infocmp -x xterm-ghostty | ssh studio -- tic -x -
```

Use `TERM=xterm-256color` only as a fallback for hosts you cannot teach about Ghostty.
