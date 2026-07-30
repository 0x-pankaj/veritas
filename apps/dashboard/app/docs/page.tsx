import type { Metadata } from "next";
import Link from "next/link";
import { DOCS } from "../../src/docs";

export const metadata: Metadata = {
  title: "Veritas — documentation",
  description:
    "How to sell verified data, how agents buy it, and the public API for auditing every purchase.",
};

export const dynamic = "force-static";

export default function DocsIndex() {
  return (
    <main>
      <h1>Documentation</h1>
      <p className="sub">
        Rendered from the repo&apos;s canonical markdown at build time — the
        site and the code cannot drift apart.
      </p>
      <div className="doc-grid">
        {DOCS.map((d) => (
          <Link key={d.slug} href={`/docs/${d.slug}`} className="doc-card">
            <div className="doc-card-title">{d.title}</div>
            <div className="doc-card-blurb">{d.blurb}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
