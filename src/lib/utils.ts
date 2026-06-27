export function cn(...inputs: (string | undefined | null | false)[]) {
  return inputs.filter(Boolean).join(" ");
}

export interface HeadingItem {
  id: string;
  text: string;
  level: number;
}

export function slugify(text: string): string {
  return text
    .trim()
    .replace(/[\s]+/g, "-")
    .replace(/[–—·'"‘’"“”!@#$%^&*()\[\]{},.;:?\/\\|`~（）、。，．；：？！【】《》「」『』〝〞〟，、]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "heading";
}

export function extractHeadings(md: string): HeadingItem[] {
  const headings: HeadingItem[] = [];
  const lines = md.split("\n");
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const m = line.match(/^(#{1,4})\s+(.+)$/);
    if (m) {
      const level = m[1].length;
      const text = m[2].trim();
      headings.push({ id: slugify(text), text, level });
    }
  }

  return headings;
}

export function getCategoryColor(color: string): string {
  const map: Record<string, string> = {
    "#3B82F6": "blue",
    "#10B981": "emerald",
    "#F59E0B": "amber",
    "#8B5CF6": "purple",
    "#EF4444": "red",
  };
  return map[color] || "zinc";
}

export function parseMarkdownTable(md: string): { headers: string[]; rows: string[][] } | null {
  const lines = md.trim().split("\n");
  if (lines.length < 2) return null;

  const headerLine = lines[0];
  const separatorLine = lines[1];
  if (!separatorLine.includes("---")) return null;

  const headers = headerLine.split("|").filter(Boolean).map((h) => h.trim());
  const rows = lines.slice(2).filter((l) => l.trim().startsWith("|")).map((l) =>
    l.split("|").filter(Boolean).map((c) => c.trim())
  );

  return { headers, rows };
}

export function markdownToHtml(md: string): string {
  let html = md.replace(/\r\n/g, "\n"); // normalize Windows line endings

  // Code blocks first (with language)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const langAttr = lang ? ` data-language="${lang}"` : "";
    const cls = lang ? "code-block" : "code-block ascii-diagram";
    return `<pre class="${cls}"${langAttr}><code>${escapeHtml(code.trim())}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Tables
  html = html.replace(/\|(.+)\|\n\|[-| ]+\|\n([\s\S]*?)(?=\n\n|\n##|$)/g, (match) => {
    const lines = match.trim().split("\n");
    const headers = lines[0].split("|").filter(Boolean).map((h) => h.trim());
    const rows = lines.slice(2).filter((l) => l.trim().startsWith("|")).map((l) =>
      l.split("|").filter(Boolean).map((c) => c.trim())
    );

    let table = '<div class="table-scroll"><table><thead><tr>';
    for (const h of headers) {
      table += `<th>${h}</th>`;
    }
    table += "</tr></thead><tbody>";
    for (const row of rows) {
      table += "<tr>";
      for (const cell of row) {
        table += `<td>${cell}</td>`;
      }
      table += "</tr>";
    }
    table += "</tbody></table></div>";
    return table;
  });

  // Headings
  html = html.replace(/^#### (.+)$/gm, (_, t) => `<h4 id="${slugify(t.trim())}">${t.trim()}</h4>`);
  html = html.replace(/^### (.+)$/gm, (_, t) => `<h3 id="${slugify(t.trim())}">${t.trim()}</h3>`);
  html = html.replace(/^## (.+)$/gm, (_, t) => `<h2 id="${slugify(t.trim())}">${t.trim()}</h2>`);
  html = html.replace(/^# (.+)$/gm, (_, t) => `<h1 id="${slugify(t.trim())}">${t.trim()}</h1>`);

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>");

  // --- Protect block elements from paragraph wrapping ---
  const blocks: string[] = [];
  let idx = 0;
  html = html.replace(
    /(<pre[^>]*>[\s\S]*?<\/pre>|<div class="table-scroll">[\s\S]*?<\/div>|<table[\s\S]*?<\/table>|<ul>[\s\S]*?<\/ul>|<ol>[\s\S]*?<\/ol>|<blockquote>[\s\S]*?<\/blockquote>)/g,
    (match) => {
      const key = `\x00BLOCK_${idx++}\x00`;
      blocks.push(match);
      return key;
    },
  );

  // Paragraphs — only wrap unprotected lines
  html = html.replace(/^(?!<[hupdlt]|<li|<pre|<code|<table|<ul|<ol|<div|<blockquote|<\/|\s*$)(.+)$/gm, "<p>$1</p>");

  // Restore protected blocks
  for (let i = 0; i < blocks.length; i++) {
    html = html.replace(`\x00BLOCK_${i}\x00`, blocks[i]);
  }

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, "<blockquote><p>$1</p></blockquote>");

  // Horizontal rules
  html = html.replace(/^---$/gm, "<hr />");

  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
