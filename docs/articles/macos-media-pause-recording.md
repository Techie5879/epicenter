# macOS Media Pause During Recording

Whispering can optionally pause the current macOS media target while it records.
The feature is local to the device because it depends on macOS media key routing
and Accessibility permissions.

The implementation uses the system play/pause media key path instead of
AppleScript app control:

```txt
manual recording is requested
  -> Whispering sends one system play/pause media key event
  -> Whispering stores a local session token
  -> recording starts

manual recording fails to start
  -> Whispering sends one system play/pause media key event only if that token exists
  -> Whispering clears the token

manual recording stops or cancels
  -> Whispering sends one system play/pause media key event only if that token exists
  -> Whispering clears the token before transcription work continues

VAD speech starts
  -> Whispering sends one system play/pause media key event
  -> Whispering stores a local session token

VAD speech ends or VAD stops
  -> Whispering sends one system play/pause media key event only if that token exists
  -> Whispering clears the token
```

The native command lives in
`apps/whispering/src-tauri/src/media_control.rs`. It uses `enigo` to emit
`Key::MediaPlayPause`, which follows the same macOS routing as the keyboard
play/pause key.

The frontend state machine lives in
`apps/whispering/src/lib/query/media-control.ts`. It owns the session token and
keeps the recording actions simple:

```txt
pauseForRecording()
  disabled, not macOS, or not desktop
    -> Ok(null)

  media key event succeeds
    -> Ok({ id, resumePending: true })

  media key event fails
    -> Err(error)

resumeAfterRecording(session)
  no session or already resumed
    -> Ok()

  session pending
    -> mark not pending
    -> send media key event
```

Recording actions call this controller as best effort. A media-control failure is
logged and never blocks recording, cancellation, transcription, or delivery.

There is an important limitation: macOS does not expose a stable public API that
means "pause the current Now Playing owner only if it is playing, then resume
that exact owner later." The system media key is generic and works with more
players, including browser media, but it is a toggle. That is why the setting is
off by default.

Bluetooth headset audio quality is a separate macOS behavior. If the same
Bluetooth headset is selected for both output and microphone input, macOS may
switch the headset into hands-free mode while recording. In that mode, playback
can drop to one channel at 16 kHz until the microphone route is released. To keep
music playback in stereo quality, use a built-in or external microphone for
recording and keep the Bluetooth headset as the output device.

The setting is stored in local device config:

```txt
recording.macos.pauseMediaDuringRecording
```

It does not sync through the workspace because media control is platform and
permission dependent.
