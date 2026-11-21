import { Check, CornerDownLeft, MessageCircleQuestion, Mic } from "lucide-react";
import type { TInterviewMessage, TStudioQuestion } from "@/types/research";

type TQuestionProps = {
  question: TStudioQuestion;
  pendingId?: string;
  busy: boolean;
  history: TInterviewMessage[];
  onChoose: (question: TStudioQuestion, id: string, label: string) => void;
  onCompose: (question: TStudioQuestion, spoken: boolean) => void;
};

export const StudioQuestion = ({ question, pendingId, busy, history, onChoose, onCompose }: TQuestionProps) => {
  const open = question.request_id === pendingId;
  const answer = history.find(turn => turn.role === "host" && turn.answer_to === question.request_id);
  return (
  <section className={"studio-question" + (open ? "" : " resolved")} aria-labelledby={"ask-" + question.request_id}>
    <div className="question-state"><MessageCircleQuestion size={15} /><span>{open ? "Your input" : answer ? "Answered" : "Closed"}</span></div>
    <h3 id={"ask-" + question.request_id}>{question.question}</h3>
    {question.options.length > 0 && <div className="question-options" role="group" aria-label="Suggested answers">
      {question.options.map(option => <button type="button" key={option.id} disabled={!open || busy}
        aria-pressed={answer?.option_id === option.id} onClick={() => onChoose(question, option.id, option.label)}>
        {answer?.option_id === option.id && <Check size={13} />}{option.label}
      </button>)}
    </div>}
    {open && question.allow_free_text && <div className="question-reply">
      <button type="button" disabled={busy} onClick={() => onCompose(question, false)}><CornerDownLeft size={14} />Type an answer</button>
      <button type="button" disabled={busy} onClick={() => onCompose(question, true)}><Mic size={14} />Speak an answer</button>
    </div>}
  </section>
  );
};
