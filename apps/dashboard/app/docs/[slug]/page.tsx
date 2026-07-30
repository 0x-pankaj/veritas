import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DOCS, getDoc, renderDoc } from "../../../src/docs";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams(): { slug: string }[] {
  return DOCS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const doc = getDoc((await params).slug);
  return doc
    ? { title: `Veritas docs — ${doc.title}`, description: doc.blurb }
    : {};
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const doc = getDoc((await params).slug);
  if (!doc) notFound();
  const html = renderDoc(doc);
  return (
    <main className="doc-layout">
      <aside className="doc-sidebar">
        {DOCS.map((d) => (
          <Link
            key={d.slug}
            href={`/docs/${d.slug}`}
            className={d.slug === doc.slug ? "doc-link active" : "doc-link"}
          >
            {d.title}
          </Link>
        ))}
      </aside>
      {/* Our own repo markdown, rendered at build time — not user content. */}
      <article className="md" dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
