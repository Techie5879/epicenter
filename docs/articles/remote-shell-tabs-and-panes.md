# I Want To SSH Once, Then Open Remote Tabs and Panes

"I just want to log into or SSH into my desktop once, then open a shell with panes and tabs. I don't want to have to re-SSH whenever I type `Ctrl+T` or something. What's the best option?"

Use a terminal multiplexer on the remote machine.

That means:

```text
Ghostty
  local window on the laptop

SSH
  one connection into the desktop

tmux or Zellij
  remote tabs, panes, and persistent shells inside that one connection
```

The important shift is that Ghostty tabs are local, but multiplexer tabs are remote.

## The Problem

When you SSH into a desktop from Ghostty, the Ghostty window still belongs to the laptop. `Command+T` opens a new local Ghostty tab. It does not ask the remote desktop to create a new shell.

That is why this feels wrong:

```text
ssh studio
Command+T
  new local tab
  not inside studio
```

You can configure Ghostty to run `ssh studio` when every new tab opens. That works, but it creates a separate SSH connection for every tab. It also makes local tabs awkward.

The better model is:

```text
one local terminal tab
  one SSH connection
    many remote shells inside tmux or Zellij
```

## The Best Default: tmux

Use `tmux` if you want the most durable SSH workflow. It is old, boring, widely documented, and exactly built for this job.

There is an honest caveat here. Mitchell Hashimoto, Ghostty's creator, has said he thinks terminal multiplexers make the terminal experience worse, even while acknowledging that there is not a better option right now. His point is technical, not just taste: a multiplexer is another terminal sitting inside your terminal, so features supported by Ghostty can disappear if tmux or another multiplexer does not support them.

That critique is real. It also does not change the recommendation for this specific workflow:

```text
SSH once into a desktop
keep shells alive if the connection drops
open remote panes and tabs without re-SSHing
```

Ghostty owns local tabs and panes. SSH transports bytes. Neither one gives you a persistent remote workspace by itself. Until Ghostty or another terminal gives us native remote session persistence with remote tab and pane management, tmux is the practical answer.

Start or attach to the main remote session:

```sh
ssh studio
tmux new -A -s main
```

Now the remote desktop owns the workspace:

```text
tmux session: main
  window 0: editor
    pane 0: nvim
    pane 1: tests

  window 1: server
    pane 0: bun run dev
    pane 1: logs

  window 2: git
    pane 0: shell
```

If the SSH connection drops, the remote session keeps running. Reconnect with the same command:

```sh
ssh studio
tmux new -A -s main
```

The `-A` flag is the trick. It means "attach if the session exists, otherwise create it."

Common tmux keys:

```text
Ctrl+b c       new remote window
Ctrl+b %       split pane left/right
Ctrl+b "       split pane top/bottom
Ctrl+b arrow   move between panes
Ctrl+b n       next window
Ctrl+b p       previous window
Ctrl+b d       detach from session
```

The prefix is `Ctrl+b` by default. So "new tab" in the remote workspace is not `Command+T`; it is `Ctrl+b c`.

## The Nicer UI: Zellij

Use Zellij if you want the same idea with a more discoverable interface. Zellij has tabs, panes, session attach, layouts, and a visible status bar that teaches you the keybindings while you use it.

Start or attach:

```sh
ssh studio
zellij attach main --create
```

The mental model is the same:

```text
Ghostty tab
  SSH connection
    Zellij session
      tabs
      panes
      commands
```

Zellij is often easier to learn. tmux is often easier to assume exists on servers and easier to script from muscle memory.

For a personal Mac Studio, both are reasonable. If the machine is yours and Zellij is installed, try it. If you want the least surprising SSH tool over the next decade, use tmux.

## Do Not Auto-SSH Every Ghostty Tab First

Ghostty can make new tabs run a command:

```ini
command = ssh studio
```

That feels tempting, but it solves the wrong layer. It makes more SSH connections. It does not create one remote workspace.

This:

```text
Command+T
  new Ghostty tab
  new SSH connection
```

is not the same as this:

```text
Ctrl+b c
  same SSH connection
  new tmux window on the Studio
```

If the goal is "I logged into my desktop and now I live there," the multiplexer belongs on the desktop.

## A Good Everyday Setup

Add an SSH alias locally:

```sshconfig
Host studio
  HostName 100.116.139.74
  User braden
```

Then use this:

```sh
ssh studio -t 'tmux new -A -s main'
```

That gives you one command from the laptop into the persistent Studio workspace.

If you like it, make a local alias:

```sh
alias studio="ssh studio -t 'tmux new -A -s main'"
```

Now:

```sh
studio
```

means:

```text
connect to Mac Studio
attach to the main remote workspace
create it if missing
```

## The Rule

Use Ghostty for local windows, fonts, scrollback, copy/paste, and rendering.

Use SSH for transport.

Use tmux or Zellij for remote tabs, panes, and session persistence.

```text
Ghostty owns the local UI.
tmux or Zellij owns the remote workspace.
```

That is the clean boundary. One SSH login gets you into the desktop. The multiplexer gives you everything after that.

## References

- tmux Getting Started: https://github.com/tmux/tmux/wiki/Getting-Started
- Zellij sessions and layouts: https://zellij.dev/documentation/
- Mitchell Hashimoto on Ghostty and multiplexers: https://changelog.com/podcast/622
