import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { marked } from "marked";

/**
 * On-site documentation, rendered from the repo's canonical markdown at BUILD
 * time (the docs pages are force-static), so the website and the repo can
 * never drift apart. Repo-relative links are rewritten to /docs routes.
 */

export interface DocDef {
  slug: string;
  /** Sidebar / index title. */
  title: string;
  /** One-line description for the docs index. */
  blurb: string;
  /** Path relative to the repo root. */
  file: string;
}

export const DOCS: DocDef[] = [
  {
    slug: "overview",
    title: "Overview",
    blurb:
      "What Veritas is, the live deployment, and a real purchase you can verify yourself.",
    file: "README.md",
  },
  {
    slug: "sellers",
    title: "For sellers",
    blurb:
      "Register, serve five lines of middleware, get paid full price in USDC when you're right.",
    file: "docs/SELLERS.md",
  },
  {
    slug: "agents",
    title: "For agents",
    blurb:
      "The one-call buyer SDK, the cost model, purchase auditing, and the MCP server for AI agents.",
    file: "docs/AGENTS.md",
  },
  {
    slug: "api",
    title: "HTTP API",
    blurb:
      "Every coordinator endpoint, plus how to re-verify signatures and settlements without trusting us.",
    file: "docs/API.md",
  },
  {
    slug: "demo",
    title: "Demo script",
    blurb: "The 2-minute liar-caught-by-consensus demo, claim by claim.",
    file: "docs/DEMO.md",
  },
  {
    slug: "deploy",
    title: "Deploy",
    blurb: "Run the whole stack yourself: Railway + Neon + Vercel runbook.",
    file: "docs/DEPLOY.md",
  },
];

export function getDoc(slug: string): DocDef | undefined {
  return DOCS.find((d) => d.slug === slug);
}

/** Rewrite repo-relative markdown links to their on-site /docs routes. */
function rewriteLinks(md: string): string {
  const map: Record<string, string> = {
    "README.md": "/docs/overview",
    "docs/SELLERS.md": "/docs/sellers",
    "SELLERS.md": "/docs/sellers",
    "docs/AGENTS.md": "/docs/agents",
    "AGENTS.md": "/docs/agents",
    "docs/API.md": "/docs/api",
    "API.md": "/docs/api",
    "docs/DEMO.md": "/docs/demo",
    "DEMO.md": "/docs/demo",
    "docs/DEPLOY.md": "/docs/deploy",
    "DEPLOY.md": "/docs/deploy",
  };
  return md.replace(/\]\(([^)]+)\)/g, (whole, href: string) => {
    const [path, anchor] = href.split("#");
    const target = map[path ?? ""];
    if (target) return `](${target}${anchor ? `#${anchor}` : ""})`;
    // In-page anchors (](#roadmap)) and absolute URLs pass through.
    return whole;
  });
}

/** Load + render a doc to HTML. Build-time only (pages are force-static). */
export function renderDoc(doc: DocDef): string {
  // process.cwd() is apps/dashboard both in `next dev` and on Vercel (with
  // "include source files outside of the root directory" enabled).
  const raw = readFileSync(resolve(process.cwd(), "../..", doc.file), "utf8");
  return marked.parse(rewriteLinks(raw), { async: false });
}
