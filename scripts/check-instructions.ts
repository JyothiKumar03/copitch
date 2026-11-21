// Verifies that paths and `bun run <script>` commands cited in AGENTS.md files exist.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const read_scripts = (dir: string): Set<string> => {
  const file = join(dir, "package.json");
  if (!existsSync(file)) return new Set();
  return new Set(Object.keys(JSON.parse(readFileSync(file, "utf8")).scripts ?? {}));
};

const check_file = (file: string): string[] => {
  const errors: string[] = [];
  const base = dirname(file);
  const root_scripts = read_scripts(".");
  const local_scripts = read_scripts(base);
  const text = readFileSync(file, "utf8");
  for (const [, span] of text.matchAll(/`([^`\n]+)`/g)) {
    const run = span.match(/^bun run (?:--cwd (\S+) )?([\w:-]+)/);
    if (run) {
      const scripts = run[1] ? read_scripts(run[1]) : base === "." ? root_scripts : new Set([...local_scripts, ...root_scripts]);
      if (!scripts.has(run[2])) errors.push(`${file}: no script '${run[2]}' for \`${span}\``);
      continue;
    }
    const script_file = span.match(/^bun (\S+\.ts)/);
    if (script_file && !existsSync(script_file[1])) errors.push(`${file}: missing ${script_file[1]}`);
    const path = span.match(/^(?:docs|scripts|backend|frontend|voice|deploy|handoffs|\.agents|\.codex)\/[\w./-]+$/);
    if (path && !path[0].includes("<") && !existsSync(path[0])) errors.push(`${file}: missing path ${path[0]}`);
  }
  return errors;
};

const main = () => {
  const files = process.argv.slice(2);
  const targets = files.length > 0 ? files : ["AGENTS.md", "backend/AGENTS.md", "frontend/AGENTS.md"].filter(existsSync);
  const errors = targets.flatMap(check_file);
  if (errors.length > 0) {
    console.error(errors.map((e) => `FAIL ${e}`).join("\n"));
    process.exit(1);
  }
  console.log(`OK ${targets.length} file(s)`);
};

main();
