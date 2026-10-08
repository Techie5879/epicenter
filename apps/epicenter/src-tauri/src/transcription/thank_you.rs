//! Validate Whisper's exact "Thank you" output against the recorded audio.

use anyhow::{bail, Context};
use log::{info, warn};
use ort::{session::Session, value::Tensor};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

const MODEL: &[u8] = include_bytes!("../../models/silero-v5/silero_vad_v5.onnx");
const FRAME: usize = 512;
const CONTEXT: usize = 64;
const SPEECH_THRESHOLD: f32 = 0.3;
static DETECTOR: OnceLock<Mutex<Result<Session, String>>> = OnceLock::new();

/// Ordinary dictation does no detector work. A failed check preserves text;
/// an exact candidate becomes empty only when every frame is below threshold.
pub(super) fn filter(text: &mut String, samples: &[f32]) {
    if !text
        .trim()
        .trim_end_matches(['.', '!'])
        .eq_ignore_ascii_case("thank you")
    {
        return;
    }

    let started = Instant::now();
    let result = (|| {
        let detector = DETECTOR
            .get_or_init(|| Mutex::new(create_session().map_err(|error| error.to_string())));
        let mut guard = detector
            .lock()
            .map_err(|_| anyhow::anyhow!("Speech detector lock poisoned"))?;
        let session = guard
            .as_mut()
            .map_err(|error| anyhow::anyhow!(error.clone()))?;
        has_speech(session, samples)
    })();

    match result {
        Ok(false) => {
            text.clear();
            info!(
                "[Transcription] suppressed silent Thank you: speech_check_ms={}",
                started.elapsed().as_millis()
            );
        }
        Ok(true) => info!(
            "[Transcription] kept Thank you with speech evidence: speech_check_ms={}",
            started.elapsed().as_millis()
        ),
        Err(error) => warn!("[Transcription] speech check failed; keeping text: {error:#}"),
    }
}

fn create_session() -> anyhow::Result<Session> {
    ort::init().with_telemetry(false).commit()?;
    Ok(Session::builder()?
        .with_intra_threads(1)?
        .with_inter_threads(1)?
        .with_parallel_execution(false)?
        .with_intra_op_spinning(false)?
        .with_inter_op_spinning(false)?
        .commit_from_memory(MODEL)?)
}

/// Silero V5 consumes mono 16 kHz PCM. Context and recurrent state belong to
/// one recording, even though the CPU session stays warm between requests.
fn has_speech(session: &mut Session, samples: &[f32]) -> anyhow::Result<bool> {
    if samples.is_empty() {
        return Ok(false);
    }
    let energy = samples
        .iter()
        .map(|&sample| f64::from(sample).powi(2))
        .sum::<f64>();
    let rms = (energy / samples.len() as f64).sqrt();
    if !rms.is_finite() {
        bail!("Audio contains nonfinite samples");
    }
    // Boost quiet speech for the detector alone. Whisper receives unchanged PCM.
    let gain = (0.05 / rms.max(1e-10)).min(100.0) as f32;
    let sr = Tensor::from_array((Vec::<usize>::new(), vec![16_000_i64]))?;
    let mut state = vec![0.0_f32; 256];
    let mut input = [0.0_f32; CONTEXT + FRAME];

    for frame in samples.chunks(FRAME) {
        input[CONTEXT..].fill(0.0);
        for (out, &sample) in input[CONTEXT..].iter_mut().zip(frame) {
            *out = (sample * gain).clamp(-1.0, 1.0);
        }
        let output = session.run(ort::inputs![
            "input" => Tensor::from_array(([1, CONTEXT + FRAME], input.to_vec()))?,
            "state" => Tensor::from_array(([2, 1, 128], state))?,
            "sr" => &sr,
        ])?;
        let (_, probabilities) = output["output"].try_extract_tensor::<f32>()?;
        let probability = *probabilities
            .first()
            .context("Missing speech probability")?;
        if !probability.is_finite() {
            bail!("Nonfinite speech probability");
        }
        // A single speech-like frame is enough to keep real or uncertain speech.
        // Requiring sustained speech could erase a quiet, short spoken phrase.
        if probability >= SPEECH_THRESHOLD {
            return Ok(true);
        }
        let (_, next_state) = output["stateN"].try_extract_tensor::<f32>()?;
        state = next_state.to_vec();
        input.copy_within(FRAME.., 0);
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_text_and_longer_thanks_bypass_the_detector() {
        for original in [
            "Yeah.",
            "Boss",
            "Thank you for helping.",
            "No, thank you.",
            "Thank you?",
            "Thank you. Goodbye.",
        ] {
            let mut text = original.to_string();
            filter(&mut text, &[f32::NAN]);
            assert_eq!(text, original);
        }
    }

    #[test]
    fn exact_thanks_on_silence_becomes_empty() {
        for original in ["Thank you", "Thank you.", "  THANK YOU!  "] {
            let mut text = original.to_string();
            filter(&mut text, &vec![0.0; 16_000]);
            assert!(text.is_empty());
        }
    }

    #[test]
    fn invalid_audio_keeps_the_original_candidate() {
        let mut text = "Thank you.".to_string();
        filter(&mut text, &[f32::NAN]);
        assert_eq!(text, "Thank you.");
    }

    #[test]
    #[ignore = "Set WHISPERING_SPEECH_CHECK_FIXTURES to a JSON fixture manifest"]
    fn recorded_speech_and_noise_match_reviewed_expectations() {
        #[derive(serde::Deserialize)]
        struct Fixture {
            audio_path: std::path::PathBuf,
            speech: Option<bool>,
        }
        let path = std::env::var("WHISPERING_SPEECH_CHECK_FIXTURES").unwrap();
        let fixtures: Vec<Fixture> = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert!(!fixtures.is_empty());
        let mut session = create_session().unwrap();
        let mut results = Vec::new();
        for fixture in fixtures {
            let bytes = std::fs::read(&fixture.audio_path).unwrap();
            let samples = crate::audio::decode_to_pcm16k_mono(&bytes).unwrap();
            let speech = has_speech(&mut session, &samples).unwrap();
            results.push(serde_json::json!({
                "audio_path": fixture.audio_path,
                "expected_speech": fixture.speech,
                "speech": speech,
            }));
        }
        if let Ok(path) = std::env::var("WHISPERING_SPEECH_CHECK_RESULTS") {
            std::fs::write(path, serde_json::to_vec_pretty(&results).unwrap()).unwrap();
        }
        let disagreements: Vec<_> = results
            .iter()
            .filter(|row| {
                !row["expected_speech"].is_null() && row["expected_speech"] != row["speech"]
            })
            .collect();
        assert!(
            disagreements.is_empty(),
            "Detector disagreed with {} fixtures: {disagreements:?}",
            disagreements.len()
        );
    }
}
