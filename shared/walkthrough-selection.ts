export type TWalkthroughSelectionKind = "title" | "caption" | "fact" | "url" | "screenshot";
export type TWalkthroughSelectionItem = {
  item_id: string;
  kind: TWalkthroughSelectionKind;
  page_number: number;
  text: string;
};

export type TWalkthroughSelectionInput = {
  approved: true;
  request_id: string;
  source_revision: string;
  item_ids: string[];
  host_additions: string[];
};

export type TWalkthroughSelectionExport = {
  export_id: string;
  revision: number;
  source_revision: string;
  item_ids: string[];
  items: TWalkthroughSelectionItem[];
  host_additions: string[];
  created_at: number;
  slides?: TWalkthroughSelectionSlide[];
};

export type TWalkthroughSelectionCatalog = {
  source_revision: string;
  items: TWalkthroughSelectionItem[];
  has_archived_export: boolean;
  exports: TWalkthroughSelectionExport[];
};

export type TWalkthroughSelectionSlide =
  | { kind: "source"; page_number: number; items: TWalkthroughSelectionItem[] }
  | { kind: "host"; host_text: string; items: [] };

const columnWidth = (character: string) => {
  if (/\p{M}/u.test(character)) return 0;
  if (character === "\t") return 4;
  if (/[WM@%&#]/u.test(character)) return 1.8;
  if (/\p{Lu}/u.test(character)) return 1.3;
  return /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Extended_Pictographic}]/u.test(character) ? 2 : 1;
};

// Track the original substrings so concatenating pages reproduces the approved wording, whitespace included.
const visualLines = (text: string, columns: number) => {
  const lines: string[] = [];
  let line = "";
  let used = 0;
  const finish = () => { lines.push(line); line = ""; used = 0; };
  for (const token of text.match(/\r\n|\r|\n|[^\S\r\n]+|[^\s]+/gu) ?? []) {
    if (/^[\r\n]/u.test(token)) { line += token; finish(); continue; }
    const characters = [...token];
    const width = characters.reduce((sum, char) => sum + columnWidth(char), 0);
    if (used && !/^\s/u.test(token) && used + width > columns) finish();
    for (const character of characters) {
      const width = columnWidth(character);
      if (used && used + width > columns) finish();
      line += character;
      used += width;
    }
  }
  if (line || !lines.length) lines.push(line);
  return lines;
};

export const planWalkthroughSelection = (items: TWalkthroughSelectionItem[], hostAdditions: string[]): TWalkthroughSelectionSlide[] => {
  const slides: TWalkthroughSelectionSlide[] = [];
  const groups: TWalkthroughSelectionItem[][] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last[0].page_number === item.page_number) last.push(item);
    else groups.push([item]);
  }
  const lineBudget = 13;
  for (const group of groups) {
    let pending: TWalkthroughSelectionItem[] = [];
    let remaining = lineBudget;
    let hasText = false;
    const finish = () => {
      if (pending.length) slides.push({ kind: "source", page_number: group[0].page_number, items: pending });
      pending = []; remaining = lineBudget; hasText = false;
    };
    // Reserve the screenshot column through the group so its position respects the host's item order.
    const columns = group.some(item => item.kind === "screenshot") ? 31 : 70;
    for (const item of group) {
      if (item.kind === "screenshot") { pending.push(item); continue; }
      const lines = visualLines(item.text, columns);
      if (hasText && (remaining <= 1 || (lines.length <= lineBudget && lines.length + 1 > remaining))) finish();
      if (hasText) remaining--;
      for (let index = 0; index < lines.length;) {
        if (!remaining) finish();
        const slice = lines.slice(index, index + remaining);
        pending.push({ ...item, text: slice.join("") });
        index += slice.length; remaining -= slice.length; hasText = true;
      }
    }
    finish();
  }
  for (const text of hostAdditions) {
    const lines = visualLines(text, 70);
    for (let index = 0; index < lines.length; index += lineBudget) {
      slides.push({ kind: "host", host_text: lines.slice(index, index + lineBudget).join(""), items: [] });
    }
  }
  return slides;
};
