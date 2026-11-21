import type { TInstrumentState } from "@/types/research";

const labels: Record<TInstrumentState, string> = {
  ready: "Ready when you are", connecting: "Connecting", listening: "Listening for your voice",
  recording: "Listening to you", transcribing: "Transcribing your turn", thinking: "Preparing a reply",
  speaking: "Speaking", researching: "Research in progress", complete: "Pitch ready",
};

const rings = Array.from({ length: 26 }, (_, index) => {
  const fraction = index / 25;
  return {
    transform: `rotate(${-60 + index * 4.8}deg) scale(${0.35 + fraction * .65}, ${1 - fraction * .26})`,
    opacity: .4 + .6 * Math.sin(fraction * Math.PI),
  };
});

export const VoiceInstrument = ({ state }: { state: TInstrumentState }) => (
  <section className="voice-instrument" data-state={state} aria-label="Voice agent">
    <div className="instrument-orb" aria-hidden="true">
      <div className="instrument-weave">{rings.map((style, index) => <i key={index} style={style} />)}</div>
    </div>
    <div className="instrument-caption">
      <span className="font-display text-3xl leading-none">copitch</span>
      <span className="instrument-state" role="status">{labels[state]}</span>
    </div>
  </section>
);
