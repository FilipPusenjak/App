import Link from "next/link";

// Layout for the signed-out auth screens (login / signup): a simple centered card.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 block text-center text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← Application Profile Evaluator
        </Link>
        <div className="rounded-xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/15 dark:bg-white/5">
          {children}
        </div>
      </div>
    </div>
  );
}
