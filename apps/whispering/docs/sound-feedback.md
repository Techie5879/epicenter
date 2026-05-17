# Sound Feedback

Whispering plays short feedback sounds when recording starts, stops, is canceled, or finishes transcription and transformation work.

Desktop playback uses the Web Audio API. Do not switch desktop feedback sounds back to `HTMLAudioElement.play()`: on macOS, normal media elements can register with the system media controls, which makes the keyboard play/pause key target Whispering instead of the user's music app.

The desktop sound service should stay narrow:

- play the same sound files used by the web service
- return `Result` errors through `SoundError`
- avoid controlling Spotify, Apple Music, browser tabs, or other media apps
- leave recording methods and transcription flow untouched

Media pause/resume is a separate feature. If it is added, keep it outside the sound service and make the user-facing behavior explicit.
