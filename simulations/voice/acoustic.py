"""Synthetic mic mixes. macOS say supplies the audio, WebRTC VAD labels 20 ms frames."""
import math
import random
import subprocess
import tempfile
import wave
from array import array
from pathlib import Path

import webrtcvad


RATE = 16000
FRAME = 320
HOST_START = RATE
WINDOW = 5 * RATE


def utterance(directory, name, phrase, voice):
    path = directory / (name + ".wav")
    subprocess.run(["say", "-v", voice, "-o", str(path), "--file-format=WAVE",
                    "--data-format=LEI16@16000", phrase], check=True)
    with wave.open(str(path)) as audio:
        assert (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) == (RATE, 1, 2)
        samples = array("h", audio.readframes(audio.getnframes()))
    # Trim synth lead-in so the host injection time has a reproducible acoustic reference.
    start = next(i for i, sample in enumerate(samples) if abs(sample) >= 250)
    return samples[start:]


def mix(tracks):
    noise = random.Random(42)
    signal = [noise.uniform(-25, 25) for _ in range(WINDOW)]
    for samples, start, target_dbfs in tracks:
        rms = math.sqrt(sum(x*x for x in samples) / len(samples))
        gain = 32768 * 10**(target_dbfs / 20) / rms
        for i, x in enumerate(samples[:WINDOW-start], start):
            signal[i] += x * gain
    return array("h", (max(-32768, min(32767, round(x))) for x in signal))


def first_onset(samples, mode):
    detector = webrtcvad.Vad(mode)
    # Warm up on an independent second of the same ambient noise before scoring.
    ambient = random.Random(7)
    for _ in range(50):
        frame = array("h", (round(ambient.uniform(-25, 25)) for _ in range(FRAME)))
        detector.is_speech(frame.tobytes(), RATE)
    consecutive = 0
    for offset in range(0, len(samples) - FRAME + 1, FRAME):
        active = detector.is_speech(samples[offset:offset+FRAME].tobytes(), RATE)
        consecutive = consecutive + 1 if active else 0
        if consecutive == 2:
            return (offset + FRAME) * 1000 // RATE
    return None


def main():
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        presenter = utterance(folder, "narration", "Enterprise conversion rose to twenty percent this month.", "Samantha")
        host = utterance(folder, "command", "Wait, show enterprise only.", "Alex")
        for name, tracks in [
            ("noise only", []),
            ("host only", [(host, HOST_START, -21)]),
            ("echo only, -36 dBFS", [(presenter, 0, -36)]),
            ("echo only, -24 dBFS", [(presenter, 0, -24)]),
            ("echo -36 plus host", [(presenter, 0, -36), (host, HOST_START, -21)]),
            ("echo -24 plus host", [(presenter, 0, -24), (host, HOST_START, -21)]),
        ]:
            audio = mix(tracks)
            print(name, [first_onset(audio, mode) for mode in range(4)])


if __name__ == "__main__":
    main()
