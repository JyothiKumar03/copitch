export type TPdfTextItem = { str: string; transform: number[]; width: number; height: number; hasEOL: boolean };

type TCell = { text: string; left: number; right: number; y: number; height: number };
type TLine = { y: number; cells: TCell[] };
const center = (cell: TCell) => (cell.left + cell.right) / 2;
const numeric = /^\(?[+−-]?(?:\d[\d,.]*|\.\d+)(?:\s*%)?\)?$/u;

const located_lines = (items: TPdfTextItem[]): TLine[] => {
  const cells = items.flatMap(({ str, transform, width, height }) => {
    const text = str.trim();
    const [scale, skew_y, , , left, y] = transform;
    if (!text || !Number.isFinite(left) || !Number.isFinite(y) || scale <= 0 || Math.abs(skew_y) > 0.5) return [];
    return [{ text, left, right: left + Math.max(width, 0), y, height: Math.max(height || scale, 1) }];
  }).sort((a, b) => b.y - a.y || a.left - b.left);
  const lines: TLine[] = [];
  for (const cell of cells) {
    const last = lines.at(-1);
    if (last && Math.abs(last.y - cell.y) <= Math.min(2, cell.height * 0.22)) last.cells.push(cell);
    else lines.push({ y: cell.y, cells: [cell] });
  }
  return lines.map(({ y, cells }) => {
    const merged: TCell[] = [];
    for (const cell of cells.sort((a, b) => a.left - b.left)) {
      const previous = merged.at(-1);
      if (previous && cell.text === previous.text && Math.abs(cell.left - previous.left) < 0.5) continue;
      if (previous && cell.left - previous.right < cell.height * 0.9) {
        previous.text += " " + cell.text;
        previous.right = Math.max(previous.right, cell.right);
      } else merged.push({ ...cell });
    }
    return { y, cells: merged };
  });
};

const series_start = ({ cells }: TLine) => {
  let index = cells.length;
  while (index > 0 && numeric.test(cells[index-1].text)) index--;
  return index > 0 && cells.length - index >= 3 ? index : undefined;
};

const related = (a: TLine, a_start: number, b: TLine, b_start: number) => {
  const left = a.cells.slice(a_start);
  const right = b.cells.slice(b_start);
  return left.length === right.length && left.every((cell, index) => Math.abs(cell.right - right[index].right) <= cell.height);
};

const column_groups = (labels: TCell[], centers: number[]) => {
  if (labels.length !== 2) return;
  let best = Number.POSITIVE_INFINITY;
  let split = 0;
  for (let i = 1; i < centers.length; i++) {
    const middle_left = (centers[0] + centers[i-1]) / 2;
    const middle_right = (centers[i] + centers.at(-1)!) / 2;
    const error = Math.abs(center(labels[0]) - middle_left) + Math.abs(center(labels[1]) - middle_right);
    if (error < best) { best = error; split = i; }
  }
  if (best > (centers.at(-1)! - centers[0]) / 5) return;
  return centers.map((_, i) => labels[i < split ? 0 : 1].text);
};

const names_above = (lines: TLine[], index: number, columns: TCell[]) => {
  const names = columns.map((): string[] => []);
  const y = lines[index].y;
  const height = columns[0].height;
  const header = lines.slice(Math.max(index-6, 0), index).filter(line => y + height * 4 >= line.y);
  const centers = columns.map(center);
  const spacing = Math.min(...centers.slice(1).map((x, i) => x - centers[i]));
  const caption: string[] = [];
  let groups: string[] | undefined;
  for (const line of header) {
    const cells = line.cells.filter(cell => center(cell) >= centers[0] - spacing * 0.62);
    // A wide heading above several columns may be centered over a group of columns.
    if (cells.length < columns.length && line.y - y > height * 2 && cells.some(cell => cell.right - cell.left > spacing * 0.85)) {
      const matched = column_groups(cells, centers);
      if (matched) groups = matched;
      else caption.push(cells.map(cell => cell.text).join(" | "));
      continue;
    }
    for (const cell of cells) {
      const x = center(cell);
      const position = centers.reduce((nearest, c, i) => Math.abs(c-x) < Math.abs(centers[nearest]-x) ? i : nearest, 0);
      if (Math.abs(centers[position] - x) <= spacing * 0.55) names[position].push(cell.text);
    }
  }
  if (names.some(name => !name.length)) return;
  return { caption, names: names.map((name, i) => [...(groups ? [groups[i]] : []), ...name].join(" ")) };
};

export const pdf_page_text = (items: TPdfTextItem[]) => {
  const native_text = () => items.map(item => item.str + (item.hasEOL ? "\n" : " ")).join("");
  const lines = located_lines(items);
  if (!lines.length || items.some(item => item.str.trim() && (item.transform[0] <= 0 || Math.abs(item.transform[1]) > 0.5))) {
    return native_text();
  }
  const rendered: string[] = [];
  let table_found = false;
  let table: { line: TLine; start: number } | undefined;
  for (const [index, line] of lines.entries()) {
    const start = series_start(line);
    if (start !== undefined) {
      const next = lines[index+1];
      const next_start = next && series_start(next);
      if (!table || !related(table.line, table.start, line, start)) {
        table = undefined;
        if (next_start !== undefined && related(line, start, next, next_start)) {
          const columns = names_above(lines, index, line.cells.slice(start));
          if (columns) {
            table_found = true;
            table = { line, start };
            const head = [...columns.caption, columns.names.join(" | ")].join(" · ");
            rendered.push("Columns: " + head);
          }
        }
      }
    }
    rendered.push(line.cells.map(cell => cell.text).join(table && start !== undefined ? " | " : " "));
  }
  return table_found ? rendered.join("\n") : native_text();
};
