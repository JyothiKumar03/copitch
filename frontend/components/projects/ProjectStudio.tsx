"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, AudioLines, ChevronRight, FileText, FolderClosed, Globe2, LoaderCircle, LockKeyhole, LogOut, Plus, Presentation, Search } from "lucide-react";
import { NewProjectDialog, type TProjectStart } from "./NewProjectDialog";
import { ProjectCard } from "./ProjectCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ResearchWorkspace } from "@/components/research/ResearchWorkspace";
import { WebsiteWalkthrough } from "@/components/walkthrough/WebsiteWalkthrough";
import { savedSession } from "@/lib/research";
import { importPreviousProject, addProject, authenticateAccount, clearPrivateDrafts, loadProjects, signOut } from "@/lib/projects";

const projectUrl = (id: string) => "/research?project=" + encodeURIComponent(id);
const accountEvent = "copitch.account-changed";
const projectDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const studioWorkflow = [
  { icon: AudioLines, title: "Brief by voice or chat" },
  { icon: FileText, title: "Review the research" },
  { icon: Presentation, title: "Prepare and present slides" },
];

export const ProjectStudio = ({ projectId, walkthrough = false }: { projectId?: string; walkthrough?: boolean }) => {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["studio-projects"], queryFn: loadProjects, retry: false, staleTime: 0 });
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");
  useEffect(() => {
    const onAccountChange = (event: StorageEvent) => {
      if (event.key !== accountEvent) return;
      clearPrivateDrafts();
      window.location.replace("/research");
    };
    const onRestore = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("storage", onAccountChange);
    window.addEventListener("pageshow", onRestore);
    return () => {
      window.removeEventListener("storage", onAccountChange);
      window.removeEventListener("pageshow", onRestore);
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed."); }
    finally { setBusy(false); }
  };
  const notifyTabs = () => {
    try { localStorage.setItem(accountEvent, crypto.randomUUID()); }
    catch { /* Other tabs will revalidate their login on focus. */ }
  };
  const authenticate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void run(async () => {
      await authenticateAccount(mode, String(fields.get("email")), String(fields.get("password")));
      notifyTabs();
      window.location.reload();
    });
  };
  if (query.isPending) return (
    <div role="status" className="flex min-h-[45vh] items-center justify-center gap-3 text-sm text-muted-foreground">
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-primary motion-reduce:animate-none" />
      Opening your workspace…
    </div>
  );
  if (query.isError) return (
    <Card className="mx-auto my-12 max-w-md">
      <CardContent className="flex flex-wrap items-center gap-4 p-6">
        <p role="alert" className="flex-1 text-sm text-destructive">{query.error.message}</p>
        <Button onClick={() => void query.refetch()}>Retry</Button>
      </CardContent>
    </Card>
  );
  const alert = error && <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>;
  if (!query.data) return (
    <section className="mx-auto grid min-h-[calc(100svh-7rem)] max-w-5xl items-center gap-7 py-8 md:grid-cols-[minmax(0,1fr)_minmax(0,.92fr)] md:gap-12 lg:gap-20">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-semibold text-primary"><LockKeyhole size={15} aria-hidden="true" /> Private workspace</p>
        <p className="mt-4 max-w-[12ch] text-[clamp(2.8rem,6vw,5.35rem)] font-semibold leading-[.94] tracking-[-.075em]">
          From first idea to live presentation
        </p>
        <ul className="mt-8 hidden max-w-sm divide-y divide-border border-y border-border md:block">
          {studioWorkflow.map(({ icon: Icon, title }) => (
            <li key={title} className="flex items-center gap-3 py-3 text-sm text-muted-foreground">
              <Icon aria-hidden="true" className="size-4 text-primary" />{title}
            </li>
          ))}
        </ul>
      </div>
      <Card className="rounded-xl p-5 sm:p-8">
        <CardHeader className="gap-2 p-0">
          <h1 className="text-3xl font-semibold leading-none tracking-[-.045em]">{mode === "login" ? "Sign in to your studio" : "Create your account"}</h1>
          <CardDescription className="leading-relaxed">{mode === "login" ? "Open your projects and pick up where you left off." : "Create a private space for your projects."}</CardDescription>
        </CardHeader>
        <CardContent className="p-0 pt-6">
          <form className="grid gap-4" onSubmit={authenticate}>
            <label className="grid gap-1.5 text-sm font-semibold" htmlFor="studio-email">Email
              <Input id="studio-email" name="email" type="email" autoComplete="email" required maxLength={254} /></label>
            <label className="grid gap-1.5 text-sm font-semibold" htmlFor="studio-password">Password
              <Input id="studio-password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? 1 : 12} maxLength={256}
                aria-describedby={mode === "register" ? "studio-password-requirements" : undefined} /></label>
            {mode === "register" && <p id="studio-password-requirements" className="-mt-2 text-sm text-muted-foreground">Use at least 12 characters.</p>}
            {alert}
            <Button type="submit" className="mt-1 w-full" disabled={busy}>{mode === "login" ? "Sign in" : "Create account"} <ArrowRight aria-hidden="true" className="size-4" /></Button>
          </form>
          <Separator className="mt-6" />
          <Button className="mt-1 justify-start px-0" variant="link" type="button" disabled={busy} onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
            {mode === "login" ? "Create an account" : "Use an existing account"}
          </Button>
        </CardContent>
      </Card>
    </section>
  );
  const legacy = !projectId ? savedSession() : null;
  const project = query.data.projects.find(item => item.session_id === projectId);
  const logout = () => void run(async () => {
    await signOut();
    clearPrivateDrafts();
    notifyTabs();
    client.clear();
    window.location.replace("/research");
  });
  const create = (name: string, start: TProjectStart) => void run(async () => {
    const created = await addProject(name);
    window.location.assign(projectUrl(created.session_id) + (start === "website" ? "&view=walkthrough" : ""));
  });
  const importLegacy = legacy?.token ? () => void run(async () => {
    const existing = await importPreviousProject({ session_id: legacy.session_id, token: legacy.token! });
    window.location.assign(projectUrl(existing.session_id));
  }) : undefined;
  const newProject = (label = "New project", size: "default" | "lg" = "default") => <NewProjectDialog busy={busy} error={alert}
    onCreate={create} onImport={importLegacy}
    trigger={<Button size={size}><Plus aria-hidden="true" size={16} />{label}</Button>} />;
  const account = <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-3">
    <span className="hidden min-w-0 truncate text-sm text-muted-foreground sm:inline" title={query.data.email}>{query.data.email}</span>
    <Button variant="ghost" size="sm" disabled={busy} onClick={logout}><LogOut aria-hidden="true" size={15} />Sign out</Button>
  </div>;
  if (projectId) return <>
    <header className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-1.5 sm:gap-3">
      <nav aria-label="Project breadcrumb" className="flex min-w-0 items-center gap-1 sm:gap-2">
        <Button asChild variant="ghost" size="sm" className="px-1.5 sm:px-2.5"><a href="/research"><FolderClosed aria-hidden="true" size={15} />Projects</a></Button>
        <ChevronRight size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <h1 className="min-w-0 truncate text-sm font-semibold sm:text-base" title={project?.name}>{project?.name ?? "Unavailable project"}</h1>
      </nav>
      <div className="flex min-w-0 items-center gap-1 sm:gap-3">
        {project && (walkthrough
          ? <Button asChild variant="ghost" size="sm"><a href={projectUrl(projectId)}>Back to conversation</a></Button>
          : <Button asChild variant="ghost" size="sm"><a href={projectUrl(projectId) + "&view=walkthrough"}>
            <Globe2 size={16} aria-hidden="true" /> Website walkthrough
          </a></Button>)}
        {account}
      </div>
    </header>
    {alert}
    {project ? (walkthrough ? <WebsiteWalkthrough key={projectId} projectId={projectId} /> : <ResearchWorkspace key={projectId} />)
      : <Card><CardContent><p role="alert">This project is unavailable to your account.</p></CardContent></Card>}
  </>;
  const visibleProjects = query.data.projects.filter(item => item.name.toLocaleLowerCase().includes(projectFilter.trim().toLocaleLowerCase()));
  const hasProjects = !!query.data.projects.length;
  return <div className="mx-auto max-w-6xl pb-16">
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pb-6 pt-6 sm:pt-10">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[.14em] text-primary">Your studio</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-[-.06em] sm:text-5xl">Projects</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {hasProjects ? `${query.data.projects.length} saved ${query.data.projects.length === 1 ? "project" : "projects"} · research, decks and rehearsals` : "Research, decks and rehearsals, kept private to you"}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {account}
        {hasProjects && newProject()}
      </div>
    </header>
    {alert}
    {hasProjects ? <section aria-labelledby="saved-projects" className="mt-2 min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        <h2 id="saved-projects" className="text-sm font-semibold text-muted-foreground">All projects</h2>
        <label className="relative min-w-0 flex-1 sm:max-w-64">
          <span className="sr-only">Find a project</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" placeholder="Find a project" className="pl-9" value={projectFilter}
            onChange={event => setProjectFilter(event.target.value)} />
        </label>
      </div>
      {visibleProjects.length ? <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{visibleProjects.map(item => <li key={item.session_id} className="min-w-0">
        <ProjectCard name={item.name} href={projectUrl(item.session_id)} created={projectDate.format(item.created_at)} />
      </li>)}</ul> : <p className="flex min-h-28 items-center gap-3 rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
        <Search aria-hidden="true" className="size-5 shrink-0 text-primary" />No projects match “{projectFilter.trim()}”.
      </p>}
    </section> : <section className="relative mt-4 grid place-items-center overflow-hidden rounded-xl border border-border bg-card px-6 py-16 text-center sm:py-24">
      <div aria-hidden="true" className="pointer-events-none absolute -top-32 left-1/2 size-96 -translate-x-1/2 rounded-full opacity-60 blur-3xl" style={{ background: "var(--hero-glow)" }} />
      <span className="relative grid size-14 place-items-center rounded-xl bg-secondary text-primary"><Presentation size={26} aria-hidden="true" /></span>
      <h2 className="relative mt-5 text-2xl font-semibold tracking-[-.04em] sm:text-3xl">Start your first presentation</h2>
      <p className="relative mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">Tell copitch what you’re presenting, or point it at a website. It researches, drafts the slides and rehearses with you.</p>
      <div className="relative mt-7">{newProject("Create a project", "lg")}</div>
    </section>}
  </div>;
};
