// Validates a handoff (and optionally its contract) so agent output is machine-checkable.
import { existsSync, readFileSync } from "node:fs";

type TRow = { cells: string[] };

const SECTIONS = ["Frontend done", "Backend done", "Current module coverage", "Next module plan"];
const STATUSES = ["verified", "failed", "unverified"];
const CLASSES = ["fixture", "live", "deployed", "none"];
const REQUIRED_CLASSES = ["fixture", "live", "deployed"];

const read_rows = (text: string): TRow[] =>
  text
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .map((line) => ({ cells: line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()) }))
    .filter((row) => /^AC-\d+$/.test(row.cells[0] ?? ""));

const check_contract = (text: string): string[] => {
  const errors: string[] = [];
  const rows = read_rows(text);
  if (rows.length === 0) errors.push("contract: no AC-n rows");
  const seen = new Set<string>();
  for (const { cells } of rows) {
    if (seen.has(cells[0])) errors.push(`contract: duplicate ${cells[0]}`);
    seen.add(cells[0]);
    if (cells.length < 5 || cells.slice(0, 5).some((c) => c === "")) errors.push(`contract: ${cells[0]} needs 5 non-empty cells`);
    if (!REQUIRED_CLASSES.includes(cells[4] ?? "")) errors.push(`contract: ${cells[0]} required evidence must be fixture|live|deployed`);
  }
  if (!/Out of scope:/i.test(text)) errors.push("contract: missing 'Out of scope:'");
  if (!/Owner decisions pending:/i.test(text)) errors.push("contract: missing 'Owner decisions pending:'");
  return errors;
};

const check_handoff = (text: string, contract?: string): string[] => {
  const errors: string[] = [];
  let last = -1;
  for (const name of SECTIONS) {
    const at = text.search(new RegExp(`^## ${name}`, "m"));
    if (at < 0) errors.push(`handoff: missing section '## ${name}'`);
    else if (at < last) errors.push(`handoff: section '${name}' out of order`);
    else last = at;
  }
  if (!/^## Current module coverage: Module \d+/m.test(text)) errors.push("handoff: coverage heading must read 'Current module coverage: Module <n>'");
  if (!/^Contract:/m.test(text)) errors.push("handoff: missing 'Contract:' line");
  const rows = read_rows(text);
  const ids = new Set<string>();
  for (const { cells } of rows) {
    const [id, status, klass, evidence, gap] = cells;
    if (ids.has(id)) errors.push(`handoff: duplicate ${id}`);
    ids.add(id);
    if (!STATUSES.includes(status ?? "")) errors.push(`handoff: ${id} status must be ${STATUSES.join("|")}`);
    if (!CLASSES.includes(klass ?? "")) errors.push(`handoff: ${id} evidence class must be ${CLASSES.join("|")}`);
    const has_evidence = (evidence ?? "") !== "" && evidence !== "—" && evidence !== "-";
    if (status === "verified" && (!has_evidence || klass === "none")) errors.push(`handoff: ${id} verified without evidence`);
    if (status !== "verified" && (!gap || gap === "—" || gap === "-")) errors.push(`handoff: ${id} ${status} needs a stated gap`);
  }
  if (contract) {
    const wanted = read_rows(contract).map((r) => r.cells[0]);
    for (const id of wanted) if (!ids.has(id)) errors.push(`handoff: contract ${id} not covered`);
    for (const id of ids) if (!wanted.includes(id)) errors.push(`handoff: ${id} not in contract`);
  }
  return errors;
};

const main = () => {
  const args = process.argv.slice(2);
  const flag = args.indexOf("--contract");
  const contract_path = flag >= 0 ? args[flag + 1] : undefined;
  const target = args.find((a, i) => !a.startsWith("--") && i !== flag + 1);
  if (!target && !contract_path) {
    console.error("usage: bun scripts/check-handoff.ts [handoff.md] [--contract contract.md]");
    process.exit(2);
  }
  const errors: string[] = [];
  for (const p of [target, contract_path]) if (p && !existsSync(p)) errors.push(`missing file ${p}`);
  if (errors.length === 0) {
    const contract = contract_path ? readFileSync(contract_path, "utf8") : undefined;
    if (contract) errors.push(...check_contract(contract));
    if (target) errors.push(...check_handoff(readFileSync(target, "utf8"), contract));
  }
  if (errors.length > 0) {
    console.error(errors.map((e) => `FAIL ${e}`).join("\n"));
    process.exit(1);
  }
  console.log("OK");
};

main();
