import PDFParser from "pdf2json";

export function parsePdfText(buffer: Buffer): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const parser = new PDFParser();
    parser.on("pdfParser_dataError", (err: { parserError: Error } | Error) => {
      reject("parserError" in err ? err.parserError : err);
    });
    parser.on("pdfParser_dataReady", () => {
      resolve(parser.getRawTextContent());
    });
    parser.parseBuffer(buffer);
  });
}
