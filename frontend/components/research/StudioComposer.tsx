import { useRef, type ClipboardEvent, type RefObject } from "react";
import { ArrowUp, FileText, Globe2, Link2, LoaderCircle, Mic, Paperclip, Square, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { TSourcePolicy, TUploadedSource } from "@/types/research";

type TComposerProps = {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  filePickerRef?: RefObject<HTMLInputElement | null>;
  message: string;
  setMessage: (value: string) => void;
  sources: TUploadedSource[];
  urls: string[];
  materials: string;
  policy: TSourcePolicy;
  attachFiles: (files: File[]) => void;
  attachUrl: (url: string) => void;
  attachText: (text: string) => void;
  removeFile: (id: string) => void;
  removeUrl: (url: string) => void;
  removeText: () => void;
  setPolicy: (policy: TSourcePolicy) => void;
  canSend: boolean;
  sending: boolean;
  uploading: boolean;
  voiceActive: boolean;
  toggleVoice: () => void;
  submit: () => void;
};

const SourceChip = ({ name, kind, remove }: { name: string; kind: "file" | "url" | "text"; remove: () => void }) => {
  const Icon = kind === "url" ? Link2 : kind === "file" ? Paperclip : FileText;
  return <Badge variant="secondary" className="source-chip" title={name}>
    <Icon size={14} aria-hidden="true" /><span>{name}</span>
    <Button type="button" variant="ghost" size="icon" className="source-remove" aria-label={"Remove " + name} onClick={remove}><X size={13} aria-hidden="true" /></Button>
  </Badge>;
};

export const StudioComposer = ({ inputRef, filePickerRef, ...props }: TComposerProps) => {
  const localPicker = useRef<HTMLInputElement>(null);
  const picker = filePickerRef ?? localPicker;
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length) { event.preventDefault(); props.attachFiles(files); return; }
    const text = event.clipboardData.getData("text/plain").trim();
    if (/^https?:\/\/[^\s]+$/i.test(text)) { event.preventDefault(); props.attachUrl(text); }
    else if (text.length > 600 || text.includes("\n")) { event.preventDefault(); props.attachText(text); }
  };
  return <form className="studio-composer" onSubmit={event => { event.preventDefault(); if (props.canSend) props.submit(); }}
    onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
    onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); props.attachFiles(Array.from(event.dataTransfer.files)); } }}>
    {(props.sources.length > 0 || props.urls.length > 0 || props.materials || props.uploading) && <div className="source-tray" aria-label="Selected sources">
      {props.sources.map(source => <SourceChip key={source.source_id} kind="file" name={source.filename} remove={() => props.removeFile(source.source_id)} />)}
      {props.urls.map(url => <SourceChip key={url} kind="url" name={url} remove={() => props.removeUrl(url)} />)}
      {props.materials && <SourceChip kind="text" name={"Pasted text · " + props.materials.slice(0, 48)} remove={props.removeText} />}
      {props.uploading && <span role="status" className="source-chip"><LoaderCircle size={14} className="animate-spin" />Reading attachment…</span>}
    </div>}
    <Textarea ref={inputRef} aria-label="Your message" rows={2} maxLength={6000} className="studio-message"
      placeholder="Message copitch or paste a source link…" value={props.message} onPaste={paste}
      onChange={event => props.setMessage(event.target.value)} onKeyDown={event => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          if (props.canSend) props.submit();
        }
      }} />
    <div className="composer-actions">
      <input ref={picker} aria-label="Attach files" type="file" accept=".pdf,.ppt,.pptx,.csv" multiple hidden
        onChange={event => { props.attachFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      <Button type="button" variant="ghost" size="icon" className="composer-attach" aria-label="Add sources" title="Attach PDF, PowerPoint or CSV"
        disabled={props.uploading} onClick={() => picker.current?.click()}>
        <Paperclip size={18} aria-hidden="true" />
      </Button>
      <Button type="button" variant="ghost" size="sm" className="source-scope" aria-label={props.policy === "files_only" ? "My materials only. Allow public research" : "Public research allowed. Use my materials only"}
        aria-pressed={props.policy === "public_search"} title="Change research sources"
        onClick={() => props.setPolicy(props.policy === "files_only" ? "public_search" : "files_only")}>
        {props.policy === "public_search" ? <Globe2 size={14} /> : <FileText size={14} />}
        {props.policy === "public_search" ? "Web + files" : "Files only"}
      </Button>
      <Button type="button" className="composer-mic" size="sm" variant="outline" aria-label={props.voiceActive ? "End voice" : "Start voice conversation"}
        aria-pressed={props.voiceActive} title={props.voiceActive ? "End voice" : "Start voice conversation"} onClick={props.toggleVoice}>
        {props.voiceActive ? <Square size={15} aria-hidden="true" /> : <Mic size={17} aria-hidden="true" />}
        <span>{props.voiceActive ? "End voice" : "Start voice"}</span>
      </Button>
      <Button type="submit" className="composer-send" size="icon" aria-label="Send" title="Send" disabled={!props.canSend}>
        {props.sending ? <LoaderCircle size={17} className="animate-spin" /> : <ArrowUp size={19} />}
      </Button>
    </div>
  </form>;
};
