import Link from "next/link";
import { loadKBArticles } from "@/lib/data";

export const dynamic = "force-dynamic";

export default function KBPage() {
  const articles = loadKBArticles();

  // Group by top-level category
  const categories: Record<string, typeof articles> = {};
  for (const article of articles) {
    const cat = article.categoryPath[0] ?? "Uncategorized";
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(article);
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
          <Link href="/dashboard" className="hover:underline">
            Dashboard
          </Link>
          <span>/</span>
          <span className="font-bold text-zinc-950">Knowledge Base</span>
        </nav>
        <h1 className="text-3xl font-bold">
          Knowledge Base ({articles.length} article
          {articles.length !== 1 ? "s" : ""})
        </h1>
        <p className="mt-2 text-sm font-medium text-zinc-600">
          Articles exported from your helpdesk. Use{" "}
          <code className="bg-zinc-100 px-2 py-1 font-mono text-xs">
            cliaas kb suggest --ticket &lt;id&gt;
          </code>{" "}
          to surface relevant articles for a ticket.
        </p>
      </header>

      {articles.length === 0 ? (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">No KB articles found</p>
          <p className="mt-2 text-sm text-zinc-600">
            Generate demo data:{" "}
            <code className="bg-zinc-100 px-2 py-1 font-mono text-xs">
              cliaas demo --tickets 50
            </code>
          </p>
        </section>
      ) : (
        Object.entries(categories).map(([category, catArticles]) => (
          <section
            key={category}
            className="mt-8 border-2 border-zinc-950 bg-white"
          >
            <div className="border-b-2 border-zinc-950 bg-zinc-50 p-6">
              <h2 className="text-xl font-bold">{category}</h2>
              <p className="font-mono text-xs text-zinc-500">
                {catArticles.length} article
                {catArticles.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="divide-y divide-zinc-200">
              {catArticles.map((article) => (
                <div key={article.id} className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-bold">{article.title}</h3>
                      <p className="mt-1 font-mono text-xs text-zinc-500">
                        {article.categoryPath.join(" / ")}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-xs text-zinc-400">
                      {article.id}
                    </span>
                  </div>
                  <div className="mt-4 max-h-40 overflow-hidden text-sm leading-relaxed text-zinc-600">
                    {article.body.slice(0, 500)}
                    {article.body.length > 500 && "..."}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
