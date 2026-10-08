# Silero V5 speech detector

This is the same `silero_vad_v5.onnx` shipped by `@ricky0123/vad-web` for
Whispering's browser recorder. The native transcription path embeds it so the
exact `Thank you` check works offline without resolving a frontend asset path.

The model is MIT licensed. See [LICENSE](LICENSE) and the
[Silero V5 reference wrapper](https://github.com/snakers4/silero-vad/blob/v5.1.2/src/silero_vad/utils_vad.py).
It expects 512 new samples and 64 preceding samples at 16 kHz. Reset its
recurrent state between recordings.

SHA-256: `2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f`.

ONNX Runtime links statically through `ort`'s CPU build. No execution provider
for GPU inference is enabled. The session loads on the first exact candidate
and stays resident without spinning worker threads.
