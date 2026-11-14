import { Fragment, type ReactNode } from "react";

/** Kleiner Markdown-Renderer für Hi-Antworten (Überschriften, Listen, Tabellen, fett, Code). Kein HTML. */
function inline(text: string, key: string): ReactNode[] {
  const teile = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return teile.map((t, i) => {
    if (t.startsWith("**") && t.endsWith("**") && t.length > 4) return <strong key={`${key}-${i}`}>{t.slice(2, -2)}</strong>;
    if (t.startsWith("`") && t.endsWith("`") && t.length > 2) return <code key={`${key}-${i}`}>{t.slice(1, -1)}</code>;
    return <Fragment key={`${key}-${i}`}>{t}</Fragment>;
  });
}

const zellen = (zeile: string) => zeile.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export default function HiMarkdown({ text }: { text: string }) {
  const zeilen = text.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < zeilen.length) {
    const z = zeilen[i];
    const k = `b${i}`;
    if (!z.trim()) { i++; continue; }
    const ue = z.match(/^(#{1,4})\s+(.*)$/);
    if (ue) {
      const Tag = ue[1].length <= 2 ? "h3" : "h4";
      out.push(<Tag key={k}>{inline(ue[2], k)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(z) && i + 1 < zeilen.length && /^\s*\|?\s*:?-{2,}/.test(zeilen[i + 1])) {
      const kopf = zellen(z);
      const reihen: string[][] = [];
      i += 2;
      while (i < zeilen.length && /^\s*\|.*\|\s*$/.test(zeilen[i])) reihen.push(zellen(zeilen[i++]));
      out.push(
        <div key={k} className="hi-tabelle-rahmen">
          <table className="hi-tabelle">
            <thead><tr>{kopf.map((c, j) => <th key={j}>{inline(c, `${k}h${j}`)}</th>)}</tr></thead>
            <tbody>{reihen.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${k}r${ri}c${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(z)) {
      const nummeriert = /^\s*\d+[.)]/.test(z);
      const punkte: string[] = [];
      while (i < zeilen.length && /^\s*([-*•]|\d+[.)])\s+/.test(zeilen[i])) punkte.push(zeilen[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      const Liste = nummeriert ? "ol" : "ul";
      out.push(<Liste key={k}>{punkte.map((p, j) => <li key={j}>{inline(p, `${k}l${j}`)}</li>)}</Liste>);
      continue;
    }
    const absatz: string[] = [];
    while (i < zeilen.length && zeilen[i].trim() && !/^(#{1,4})\s|^\s*([-*•]|\d+[.)])\s+|^\s*\|/.test(zeilen[i])) absatz.push(zeilen[i++]);
    if (!absatz.length) { out.push(<p key={k}>{inline(z, k)}</p>); i++; continue; }
    out.push(<p key={k}>{absatz.map((a, j) => <Fragment key={j}>{j > 0 && <br />}{inline(a, `${k}p${j}`)}</Fragment>)}</p>);
  }
  return <div className="hi-md">{out}</div>;
}
