"use client";

import { Pause, Play } from "lucide-react";
import { useRef, useState } from "react";
import { sampleAudio } from "@/lib/sample-pitch";

const timestamp = (seconds: number) => `0:${String(Math.round(seconds)).padStart(2, "0")}`;

export const SamplePlayer = () => {
  const player = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [failed, setFailed] = useState(false);

  const togglePlayback = async () => {
    const audio = player.current;
    if (!audio) return;
    if (!audio.paused) { audio.pause(); return; }
    try {
      setFailed(false);
      await audio.play();
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="bg-studio-dark px-4 py-3.5 text-studio-light sm:px-5">
      <audio ref={player} src="/studio/sample-pitch.mp3" preload="none"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setElapsed(0); }}
        onTimeUpdate={event => setElapsed(event.currentTarget.currentTime)} />
      <div className="flex items-center gap-3 sm:gap-4">
        <button type="button" onClick={togglePlayback} aria-label={playing ? "Pause sample pitch" : "Play sample pitch"}
          className="grid size-11 shrink-0 place-items-center rounded-full border border-studio-light/65 transition-colors hover:bg-white/10 focus-visible:outline-white">
          {playing ? <Pause size={16} fill="currentColor" aria-hidden="true"/> : <Play size={16} fill="currentColor" aria-hidden="true" className="ml-0.5"/>}
        </button>
        <div className="shrink-0"><p className="text-sm font-semibold leading-tight">Sample pitch</p><p className="mt-1 text-xs text-studio-light/75">AI narration</p></div>
        <svg viewBox="0 0 272 32" preserveAspectRatio="none" className="mx-1 h-8 min-w-0 flex-1" aria-hidden="true">
          {sampleAudio.waveform.map((height, i) => (
            <rect key={i} x={i * 4} y={(32 - height) / 2} width="2" height={height} rx="1" fill="currentColor"
              opacity={i / sampleAudio.waveform.length < elapsed / sampleAudio.duration ? 1 : 0.55}/>
          ))}
        </svg>
        <span className="shrink-0 font-mono text-xs tabular-nums" aria-hidden="true">{timestamp(playing || elapsed > 0 ? elapsed : sampleAudio.duration)}</span>
      </div>
      {failed && <p role="status" className="mt-2 text-sm">Audio couldn’t play. <a href="#sample" className="underline">Read the sample pitch</a>.</p>}
    </div>
  );
};
