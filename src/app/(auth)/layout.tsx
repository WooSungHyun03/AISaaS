import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-screen flex-col items-center justify-center bg-muted/30 px-4 py-8">
      <Link href="/" className="mb-8 text-xl font-semibold tracking-tight">
        AutoBiz
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
