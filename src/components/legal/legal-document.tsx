import Link from "next/link";

export interface LegalSection {
  title: string;
  body: React.ReactNode;
}

/** Shared layout for the terms and privacy pages. */
export function LegalDocument({ title, effectiveDate, intro, sections }: { title: string; effectiveDate: string; intro: React.ReactNode; sections: LegalSection[] }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:py-16">
      <h1 className="text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">{title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">시행일 {effectiveDate}</p>
      <div className="mt-8 rounded-xl border border-border bg-brand-soft/60 px-5 py-4 text-[15px] leading-7">{intro}</div>
      <nav aria-label="목차" className="mt-8">
        <ol className="grid gap-1.5 text-sm sm:grid-cols-2">
          {sections.map((section, index) => (
            <li key={section.title}>
              <a href={`#section-${index + 1}`} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                {index + 1}. {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="mt-10 space-y-10">
        {sections.map((section, index) => (
          <section key={section.title} id={`section-${index + 1}`} aria-labelledby={`section-${index + 1}-title`} className="scroll-mt-24">
            <h2 id={`section-${index + 1}-title`} className="text-lg font-bold tracking-[-0.02em]">
              {index + 1}. {section.title}
            </h2>
            <div className="mt-3 space-y-3 text-[15px] leading-7 text-muted-foreground [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-foreground">{section.body}</div>
          </section>
        ))}
      </div>
      <p className="mt-12 border-t border-border pt-6 text-sm text-muted-foreground">
        함께 보기: <Link href="/terms" className="font-medium text-primary hover:underline">이용약관</Link> ·{" "}
        <Link href="/privacy" className="font-medium text-primary hover:underline">개인정보처리방침</Link>
      </p>
    </article>
  );
}
