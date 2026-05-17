# macOS Media Pause During Recording

Whispering can optionally pause the current macOS media target while it records.
The feature is local to the device because it depends on macOS Now Playing
routing.

The implementation uses macOS MediaRemote instead of AppleScript app control or
a simulated play/pause key:

```txt
manual recording is requested
  -> Whispering checks whether the current Now Playing target is playing
  -> Whispering sends a one-way pause command when media is playing or unknown
  -> Whispering stores a local session token only when state was reliably playing
  -> recording starts

manual recording fails to start
  -> Whispering sends a one-way play command only if that token exists
  -> Whispering clears the token

manual recording stops or cancels
  -> Whispering sends a one-way play command only if that token exists
  -> Whispering clears the token before transcription work continues

VAD speech starts
  -> Whispering checks whether the current Now Playing target is playing
  -> Whispering sends a one-way pause command when media is playing or unknown
  -> Whispering stores a local session token only when state was reliably playing

VAD speech ends or VAD stops
  -> Whispering sends a one-way play command only if that token exists
  -> Whispering clears the token
```

The native command lives in
`apps/whispering/src-tauri/src/media_control.rs`. It dynamically loads
`/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote` and uses
one-way MediaRemote commands:

```txt
pause: MRMediaRemoteSendCommand(1, null)
play:  MRMediaRemoteSendCommand(0, null)
```

The playback-state check first tries `MRMediaRemoteGetNowPlayingInfo` and reads
the legacy playback-rate key. If that callback is empty, it tries
`MRNowPlayingController` and reads `playbackRate`. If both state paths are
unavailable, Whispering falls back to
`MRMediaRemoteGetNowPlayingApplicationIsPlaying`.

When macOS reports the state as unknown, Whispering still sends one-way Pause
before recording because Pause does not start already-paused media. It does not
store a resume token for unknown state. This is intentional: one-way Play would
start media that was already paused. Browser media and PWAs can report unknown
state through MediaRemote even when the system Now Playing UI has enough
information to accept a Pause command.

The frontend state machine lives in
`apps/whispering/src/lib/query/media-control.ts`. It owns the session token and
keeps the recording actions simple:

```txt
pauseForRecording()
  disabled, not macOS, or not desktop
    -> Ok(null)

  native pause succeeds and says media should resume later
    -> Ok({ id, resumePending: true })

  native pause succeeds but media should not be resumed
    -> Ok(null)

  native pause fails
    -> Err(error)

resumeAfterRecording(session)
  no session or already resumed
    -> Ok()

  session pending
    -> mark not pending
    -> send one-way play command
```

Recording actions call this controller as best effort. A media-control failure is
logged and never blocks recording, cancellation, transcription, or delivery.

There is an important limitation: macOS does not expose a stable public API that
means "pause the current Now Playing owner only if it is playing, then resume
that exact owner later." MediaRemote is private API. It is more precise than a
simulated play/pause key because it has one-way pause and play commands, but it
can change across macOS releases. That is why the setting is off by default.

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
