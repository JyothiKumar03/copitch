import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import ts from "typescript";

const root = join(import.meta.dir, "..");
const ignored = new Set([".git", ".next", ".venv", "__pycache__", "build", "coverage", "dist", "node_modules", "out"]);
const violations: string[] = [];

const checkFile = async (path: string) => {
  const code = await readFile(path, "utf8");
  const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.body) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      violations.push(`${relative(root, path)}:${line + 1} Use a const arrow for standalone functions.`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
};

const scan = async (dir: string): Promise<void> => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) await checkFile(path);
  }
};

await scan(root);
if (violations.length) {
  console.error(violations.sort().join("\n"));
  process.exitCode = 1;
}
