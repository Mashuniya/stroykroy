/**
 * Минимальная работа с .xlsx без сторонних библиотек: запись (простые листы, текст и числа) и чтение (в том числе файлов, сохранённых Excel).
 * Чтение сжатых частей — через встроенный в браузер DecompressionStream.
 */
export type Cell = string | number | null | undefined;
export interface Sheet { name: string; rows: Cell[][]; widths?: number[] }

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8");

let CRC_T: Uint32Array | null = null;
function crc32(b: Uint8Array): number {
  if (!CRC_T) { CRC_T = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const chunks: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  const u16 = (v: number) => [v & 255, (v >>> 8) & 255];
  const u32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name); const crc = crc32(f.data);
    const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0)]);
    chunks.push(local, name, f.data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += local.length + name.length + f.data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...chunks, ...central, end]; const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0)); let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
function colName(i: number): string { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }

export function writeXlsx(sheets: Sheet[]): Blob {
  const files: { name: string; data: Uint8Array }[] = [];
  const add = (name: string, text: string) => files.push({ name, data: enc.encode(text) });
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  add("[Content_Types].xml", X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") + "</Types>");
  add("_rels/.rels", X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  add("xl/workbook.xml", X + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    + sheets.map((s, i) => `<sheet name="${esc(s.name).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") + "</sheets></workbook>");
  add("xl/_rels/workbook.xml.rels", X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
    + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  add("xl/styles.xml", X + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3EFE8"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  sheets.forEach((s, i) => {
    const cols = s.widths?.length ? "<cols>" + s.widths.map((w, k) => `<col min="${k + 1}" max="${k + 1}" width="${w}" customWidth="1"/>`).join("") + "</cols>" : "";
    const rows = s.rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((c, ci) => {
      if (c === null || c === undefined || c === "") return "";
      const ref = colName(ci) + (ri + 1), st = ri === 0 ? ' s="1"' : "";
      return typeof c === "number" && Number.isFinite(c) ? `<c r="${ref}"${st}><v>${c}</v></c>` : `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(String(c))}</t></is></c>`;
    }).join("") + "</row>").join("");
    add(`xl/worksheets/sheet${i + 1}.xml`, X + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`);
  });
  const zipped = zipStore(files);
  return new Blob([zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const w = ds.writable.getWriter(); void w.write(data as unknown as BufferSource); void w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const b = new Uint8Array(buf); const dv = new DataView(buf); const out = new Map<string, Uint8Array>();
  let e = b.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("Это не файл .xlsx (не найден каталог архива)");
  const count = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nl));
    const ln = dv.getUint16(lo + 26, true), le = dv.getUint16(lo + 28, true), start = lo + 30 + ln + le;
    const raw = b.subarray(start, start + csize);
    out.set(name, method === 0 ? raw : await inflateRaw(raw));
    p += 46 + nl + el + cl;
  }
  return out;
}

const colIndex = (ref: string): number => { let n = 0; for (const ch of ref.replace(/[^A-Z]/gi, "").toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

export async function readXlsx(buf: ArrayBuffer): Promise<Sheet[]> {
  const z = await unzip(buf);
  const xml = (name: string): Document | null => { const d = z.get(name); return d ? new DOMParser().parseFromString(dec.decode(d), "application/xml") : null; };
  const wb = xml("xl/workbook.xml"); if (!wb) throw new Error("В файле нет листов (xl/workbook.xml)");
  const rels = xml("xl/_rels/workbook.xml.rels");
  const target: Record<string, string> = {};
  rels?.querySelectorAll("Relationship").forEach((r) => { target[r.getAttribute("Id") ?? ""] = (r.getAttribute("Target") ?? "").replace(/^\//, "").replace(/^(?!xl\/)/, "xl/"); });
  const shared: string[] = [];
  xml("xl/sharedStrings.xml")?.querySelectorAll("si").forEach((si) => { shared.push(Array.from(si.querySelectorAll("t")).map((t) => t.textContent ?? "").join("")); });
  const sheets: Sheet[] = [];
  for (const s of Array.from(wb.querySelectorAll("sheet"))) {
    const rid = s.getAttribute("r:id") ?? s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? "";
    const doc = xml(target[rid] ?? ""); if (!doc) continue;
    const rows: Cell[][] = [];
    doc.querySelectorAll("row").forEach((row) => {
      const ri = Number(row.getAttribute("r") ?? rows.length + 1) - 1; const r: Cell[] = [];
      row.querySelectorAll("c").forEach((c) => {
        const t = c.getAttribute("t"), v = c.querySelector("v")?.textContent ?? null; let val: Cell = null;
        if (t === "s") val = v === null ? null : shared[Number(v)] ?? "";
        else if (t === "inlineStr") val = Array.from(c.querySelectorAll("is t")).map((x) => x.textContent ?? "").join("");
        else if (t === "str" || t === "e") val = v;
        else if (t === "b") val = v === "1" ? 1 : 0;
        else if (v !== null && v !== "" && Number.isFinite(Number(v))) val = Number(v);
        else val = v;
        r[colIndex(c.getAttribute("r") ?? "A1")] = val;
      });
      rows[ri] = r;
    });
    for (let i = 0; i < rows.length; i++) rows[i] = rows[i] ?? [];
    sheets.push({ name: s.getAttribute("name") ?? "", rows });
  }
  return sheets;
}
