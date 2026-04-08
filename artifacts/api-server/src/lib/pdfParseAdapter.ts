import PDFParser from "pdf2json";

interface PdfTextRun {
  T: string;
}

interface PdfTextItem {
  x: number;
  y: number;
  R: PdfTextRun[];
}

interface PdfPage {
  Texts?: PdfTextItem[];
}

interface PdfData {
  Pages?: PdfPage[];
}

interface TextItem {
  x: number;
  y: number;
  text: string;
}

function extractItems(data: PdfData): TextItem[] {
  const items: TextItem[] = [];
  // Only use the first page — it contains the quote header with all customer fields.
  // Processing all pages together garbles the text by mixing y-coordinates across pages.
  const page = data.Pages?.[0];
  if (!page?.Texts) return items;
  for (const t of page.Texts) {
    const text = t.R.map(r => {
      try { return decodeURIComponent(r.T); } catch { return r.T; }
    }).join("");
    if (text.trim()) items.push({ x: t.x, y: t.y, text });
  }
  return items;
}

function itemsToRows(items: TextItem[]): string {
  if (items.length === 0) return "";
  const rowMap = new Map<number, TextItem[]>();
  for (const item of items) {
    const yKey = Math.round(item.y * 2.5) / 2.5;
    let bucket = rowMap.get(yKey);
    if (!bucket) { bucket = []; rowMap.set(yKey, bucket); }
    bucket.push(item);
  }
  const lines: string[] = [];
  for (const [, row] of [...rowMap.entries()].sort((a, b) => a[0] - b[0])) {
    const line = row
      .sort((a, b) => a.x - b.x)
      .map(i => i.text.trim())
      .filter(t => t.length > 0)
      .join(" ")
      .trim();
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

export function parsePdfText(buffer: Buffer): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const parser = new PDFParser();
    parser.on("pdfParser_dataError", (err: { parserError: Error } | Error) => {
      reject("parserError" in err ? err.parserError : err);
    });
    parser.on("pdfParser_dataReady", (data: unknown) => {
      const items = extractItems(data as PdfData);
      if (items.length > 0) {
        resolve(itemsToRows(items));
      } else {
        resolve(parser.getRawTextContent());
      }
    });
    parser.parseBuffer(buffer);
  });
}
