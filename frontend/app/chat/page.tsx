import type { Metadata } from "next";
import { VoiceAssistant } from "@/components/chat/VoiceAssistant";
import { SiteHeader } from "@/components/site/SiteHeader";

export const metadata: Metadata = { title: "Pitch practice" };

const ChatPage = () => (
  <>
    <SiteHeader />
    <main className="mx-auto w-full max-w-6xl px-5 pb-16 pt-10 sm:px-8 sm:pt-16 lg:px-12">
      <div className="mb-8 grid gap-x-12 gap-y-4 border-b border-border pb-8 sm:grid-cols-[1.3fr_1fr] sm:items-end sm:pb-10">
        <h1 className="font-display text-5xl leading-[0.97] tracking-tight text-foreground sm:text-7xl">Pitch practice</h1>
        <p className="max-w-sm text-base leading-relaxed text-muted-foreground">
          Talk through a question, sharpen an opening or rehearse what you’ll say next.
        </p>
      </div>
      <VoiceAssistant />
    </main>
  </>
);

export default ChatPage;
