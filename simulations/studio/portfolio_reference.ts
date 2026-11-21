export type TPortfolioFact = {
  id: string;
  required?: boolean;
  terms: RegExp[];
  paths: string[];
};

export const portfolio_url = "https://www.jk-ai.in/";
export const portfolio_threshold = 0.9;

// Reviewed against the public home, résumé, project index and llms.txt on 2026-11-21.
const profile_paths = ["/", "/llms.txt"];
const featured_projects = new Set(["just-jev-it", "agent-bridge", "agent-receipts", "live-slides", "aarogya-medical-support", "merchant-underwriting-agent"]);
const projects_absent_from_llms = new Set(["shoe-store-clone", "ml-projects", "samurai-stimulator"]);
const role = (id: string, name: RegExp, title: RegExp, date: RegExp): TPortfolioFact => ({
  id: `role:${id}`, required: true, terms: [name, title, date], paths: profile_paths,
});
const project = (slug: string, name: RegExp, purpose: RegExp): TPortfolioFact => ({
  id: `project:${slug}`, required: true, terms: [name, purpose],
  paths: ["/projects", `/projects/${slug}`, ...(featured_projects.has(slug) ? ["/"] : []),
    ...(projects_absent_from_llms.has(slug) ? [] : ["/llms.txt"])],
});

export const portfolio_facts: TPortfolioFact[] = [
  { id: "identity", required: true, terms: [/\bjyothi kumar\b/u, /\b(?:ai engineer|software engineer|ai solutions)\b/u], paths: profile_paths },
  { id: "education:kmit", required: true, terms: [/\b(?:kmit|keshav memorial institute of technology)\b/u, /\b(?:bachelor|bachelors|btech|b\.tech|b\.e\.|computer engineering|computer science)\b/u, /\bdec(?:ember)?\s+2020\b.*\bjun(?:e)?\s+2024\b/u], paths: profile_paths },
  { id: "education:gpa", required: true, terms: [/\b(?:gpa|cgpa)\b/u, /\b8\.98\b/u], paths: profile_paths },
  role("inspirelabs", /\binspire\s*labs\b/u, /\bai solutions\b/u, /\b(?:present|currently|current)\b/u),
  role("prodgain", /\bprod\s*gain\b/u, /\bsoftware engineer\b/u, /\bjun(?:e)?\s+2024\b.*\bfeb(?:ruary)?\s+2026\b/u),
  role("adp", /\badp\b/u, /\bsoftware develop(?:er|ment) intern\b/u, /\bjul(?:y)?(?:\s+2023)?\s*(?:-|to|through)\s*oct(?:ober)?\s+2023\b/u),
  role("brainlox", /\bbrainlox\b/u, /\bfull[ -]stack (?:software )?engineer\b/u, /\bfeb(?:ruary)?(?:\s+2023)?\s*(?:-|to|through)\s*mar(?:ch)?\s+2023\b/u),
  role("teleparadigm", /\bteleparadigm networks\b/u, /\b(?:r\s*&\s*d|research and development) intern\b/u, /\bsep(?:t(?:ember)?)?(?:\s+2022)?\s*(?:-|to|through)\s*dec(?:ember)?\s+2022\b/u),
  { id: "impact:30k", required: true, terms: [/\b(?:30\s*k|30[,]?000)\s*(?:\+|or more)|\b(?:over|more than|at least)\s+(?:30\s*k|30[,]?000)\b/u, /\bcalls\b/u, /\bemails\b/u, /\bmeetings\b/u], paths: profile_paths },
  { id: "impact:500", required: true, terms: [/\b500\s*(?:\+|or more)|\b(?:over|more than|at least)\s+500\b/u, /\btool calls\b/u], paths: profile_paths },
  { id: "impact:90-percent", terms: [/\b90\s*(?:%|percent)/u, /\b(?:accurate deliverables|accuracy)\b/u], paths: profile_paths },
  { id: "impact:70-percent", terms: [/\b70\s*(?:%|percent)/u, /\b(?:improv\w+|better)\b/u, /\bllm\b/u], paths: profile_paths },
  { id: "writing:production-reliability", terms: [/\breliability[ -]first llm systems\b/u], paths: ["/", "/blog", "/blog/reliability-first-llm-systems", "/llms.txt"] },
  { id: "skills:context-and-retrieval", terms: [/\bcontext engineering\b/u, /\brag\b/u], paths: profile_paths },
  project("just-jev-it", /\bjust[ -]jev[ -]it\b/u, /\b(?:decision|decisions|deciding|decide)\b/u),
  project("agent-bridge", /\bagent[ -](?:spawnkit|bridge)\b/u, /\b(?:workers?|delegat\w+)\b/u),
  project("agent-receipts", /\b(?:trace[ -]ur[ -]token|agent[ -]receipts)\b/u, /\b(?:tokens?|spend)\b/u),
  project("live-slides", /\blive\s*slides\b/u, /\b(?:decks?|slides?|presentations?)\b/u),
  project("aarogya-medical-support", /\baarogya\b/u, /\b(?:insurance|support|tickets?)\b/u),
  project("merchant-underwriting-agent", /\bmerchant underwriting agent\b/u, /\b(?:scores?|credit|offers?)\b/u),
  project("research-paper-judge", /\bresearch paper judge\b/u, /\b(?:arxiv|peer review|six agents|6 agents)\b/u),
  project("speech-ai-agent", /\b(?:voice tutor|speech ai agent)\b/u, /\bspanish\b/u),
  project("critic-agent", /\bcritic agent\b/u, /\b(?:feedback|rubric|criticism)\b/u),
  project("dev-debugger", /\bdev debugger\b/u, /\b(?:rag|codebases?|debugging)\b/u),
  project("unified-llm-wrapper", /\bunified llm wrapper\b/u, /\b(?:providers?|fallbacks?|retries)\b/u),
  project("prescription-ai-webapp", /\bprescription ai web\s*app\b/u, /\b(?:handwriting|handwritten|vision)\b/u),
  project("aws-dns-dashboard", /\baws dns dashboard\b/u, /\b(?:records?|monitor\w+)\b/u),
  project("shoe-store-clone", /\bshoe store clone\b/u, /\b(?:storefront|responsive|landing page)\b/u),
  project("ml-projects", /\bml projects\b/u, /\b(?:sentiment|stock|prediction)\b/u),
  project("samurai-stimulator", /\bsamurai st?imulator\b/u, /\b(?:fighting|two.player)\b/u),
];
