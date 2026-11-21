type TSpeechResult = ArrayLike<{ transcript: string }>;

type TSpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<TSpeechResult>;
};

type TSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: TSpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type TSpeechRecognitionConstructor = new () => TSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: TSpeechRecognitionConstructor;
    webkitSpeechRecognition?: TSpeechRecognitionConstructor;
  }
}

export type { TSpeechRecognition };
