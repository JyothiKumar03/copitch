import Link from "next/link";
import { VoiceAssistant } from "@/components/chat/VoiceAssistant";

export default function Home() {
  return (
    <main className="shell">
      <div className="glow" aria-hidden="true" />
      <section className="panel">
        <header className="header">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <span>Equal AI</span>
          </div>
          <Link href="/research" className="badge hover:underline">Prepare a research brief →</Link>
        </header>

        <div className="intro">
          <h1>Talk to your app.</h1>
          <p>
            Press the mic and speak, or type a message. Replies come from the
            TypeScript API and are read aloud in your browser.
          </p>
        </div>

        <VoiceAssistant />

        <footer className="footer">
          <span>Bun · Next.js · Hono · Docker</span>
        </footer>
      </section>
    </main>
  );
}
