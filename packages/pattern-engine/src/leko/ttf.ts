/**
 * Минимальный разбор TrueType-шрифта и урезание его до нужных букв — чтобы вшить в PDF русский текст
 * (в файл попадают только использованные буквы, поэтому PDF почти не растёт).
 */
export interface TtfFont {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  bbox: [number, number, number, number];
  /** Номер глифа для символа (0 — нет в шрифте). */
  glyphOf(cp: number): number;
  /** Ширина глифа в единицах шрифта. */
  advance(gid: number): number;
  /** Шрифт, в котором остались контуры только указанных глифов. */
  subset(gids: Iterable<number>): Uint8Array;
}

export function parseTtf(buf: Uint8Array): TtfFont {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const numTables = dv.getUint16(4);
  const tables: Record<string, { off: number; len: number }> = {};
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
    tables[tag] = { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) };
  }
  for (const t of ["head", "hhea", "maxp", "hmtx", "loca", "glyf", "cmap"]) if (!tables[t]) throw new Error(`TTF: нет таблицы ${t}`);
  const head = tables.head.off;
  const unitsPerEm = dv.getUint16(head + 18);
  const locaFmt = dv.getInt16(head + 50);
  const bbox: [number, number, number, number] = [dv.getInt16(head + 36), dv.getInt16(head + 38), dv.getInt16(head + 40), dv.getInt16(head + 42)];
  const hhea = tables.hhea.off;
  const ascent = dv.getInt16(hhea + 4), descent = dv.getInt16(hhea + 6);
  const nHM = dv.getUint16(hhea + 34);
  const numGlyphs = dv.getUint16(tables.maxp.off + 4);

  // cmap: подтаблица формата 4 (Unicode BMP)
  let cm = -1;
  const cmapOff = tables.cmap.off;
  const nSub = dv.getUint16(cmapOff + 2);
  for (let i = 0; i < nSub; i++) {
    const plat = dv.getUint16(cmapOff + 4 + i * 8), enc = dv.getUint16(cmapOff + 6 + i * 8), off = cmapOff + dv.getUint32(cmapOff + 8 + i * 8);
    if (dv.getUint16(off) === 4 && ((plat === 3 && enc === 1) || plat === 0)) { cm = off; if (plat === 3) break; }
  }
  if (cm < 0) throw new Error("TTF: нет Unicode-таблицы символов");
  const segX2 = dv.getUint16(cm + 6), segs = segX2 / 2;
  const endO = cm + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
  const glyphOf = (cp: number): number => {
    if (cp > 0xffff) return 0;
    for (let s = 0; s < segs; s++) {
      if (cp > dv.getUint16(endO + s * 2)) continue;
      const start = dv.getUint16(startO + s * 2);
      if (cp < start) return 0;
      const delta = dv.getInt16(deltaO + s * 2), ro = dv.getUint16(rangeO + s * 2);
      if (ro === 0) return (cp + delta) & 0xffff;
      const g = dv.getUint16(rangeO + s * 2 + ro + (cp - start) * 2);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };
  const advance = (gid: number) => dv.getUint16(tables.hmtx.off + Math.min(gid, nHM - 1) * 4);

  const locaAt = (g: number) => (locaFmt === 0 ? dv.getUint16(tables.loca.off + g * 2) * 2 : dv.getUint32(tables.loca.off + g * 4));
  const glyphRange = (g: number): [number, number] => [tables.glyf.off + locaAt(g), tables.glyf.off + locaAt(g + 1)];

  const subset = (gidsIn: Iterable<number>): Uint8Array => {
    const need = new Set<number>([0]);
    const queue = [...gidsIn];
    while (queue.length) {
      const g = queue.pop()!;
      if (need.has(g) && g !== 0) continue;
      need.add(g);
      const [a, b] = glyphRange(g);
      if (b - a < 10 || dv.getInt16(a) >= 0) continue;
      let p = a + 10; // составной глиф: подтягиваем его части
      for (;;) {
        const flags = dv.getUint16(p), comp = dv.getUint16(p + 2);
        if (!need.has(comp)) queue.push(comp);
        p += 4 + (flags & 1 ? 4 : 2);
        if (flags & 0x8) p += 2; else if (flags & 0x40) p += 4; else if (flags & 0x80) p += 8;
        if (!(flags & 0x20)) break;
      }
    }
    const chunks: Uint8Array[] = [];
    const loca = new DataView(new ArrayBuffer((numGlyphs + 1) * 4));
    let pos = 0;
    for (let g = 0; g < numGlyphs; g++) {
      loca.setUint32(g * 4, pos);
      if (!need.has(g)) continue;
      const [a, b] = glyphRange(g);
      if (b <= a) continue;
      const len = Math.ceil((b - a) / 4) * 4;
      const c = new Uint8Array(len);
      c.set(buf.subarray(a, b));
      chunks.push(c);
      pos += len;
    }
    loca.setUint32(numGlyphs * 4, pos);
    const glyf = new Uint8Array(pos);
    let q = 0;
    for (const c of chunks) { glyf.set(c, q); q += c.length; }
    const copy = (tag: string) => (tables[tag] ? buf.slice(tables[tag].off, tables[tag].off + tables[tag].len) : null);
    const headCopy = copy("head")!;
    const hdv = new DataView(headCopy.buffer);
    hdv.setUint32(8, 0); hdv.setInt16(50, 1);
    const out: [string, Uint8Array][] = [["head", headCopy], ["hhea", copy("hhea")!], ["maxp", copy("maxp")!], ["hmtx", copy("hmtx")!], ["loca", new Uint8Array(loca.buffer)], ["glyf", glyf]];
    for (const t of ["cvt ", "fpgm", "prep"]) { const c = copy(t); if (c) out.push([t, c]); }
    out.sort((x, y) => (x[0] < y[0] ? -1 : 1));
    let total = 12 + out.length * 16;
    for (const [, d] of out) total += Math.ceil(d.length / 4) * 4;
    const res = new Uint8Array(total);
    const rd = new DataView(res.buffer);
    rd.setUint32(0, 0x00010000); rd.setUint16(4, out.length);
    const pw = 2 ** Math.floor(Math.log2(out.length));
    rd.setUint16(6, pw * 16); rd.setUint16(8, Math.log2(pw)); rd.setUint16(10, out.length * 16 - pw * 16);
    let off = 12 + out.length * 16;
    out.forEach(([tag, d], i) => {
      const r = 12 + i * 16;
      for (let k = 0; k < 4; k++) res[r + k] = tag.charCodeAt(k);
      let sum = 0;
      const padded = new Uint8Array(Math.ceil(d.length / 4) * 4);
      padded.set(d);
      const pdv = new DataView(padded.buffer);
      for (let k = 0; k < padded.length; k += 4) sum = (sum + pdv.getUint32(k)) >>> 0;
      rd.setUint32(r + 4, sum); rd.setUint32(r + 8, off); rd.setUint32(r + 12, d.length);
      res.set(padded, off);
      off += padded.length;
    });
    return res;
  };
  return { unitsPerEm, ascent, descent, bbox, glyphOf, advance, subset };
}
