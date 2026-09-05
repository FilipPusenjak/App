// A small navy-tinted badge for genuine empty states ("no evaluations yet",
// "no students yet") — the ones that are a real, if temporary, absence of
// data, not a form section or an inline aside. A plain dashed box with grey
// text reads as unfinished; this one glyph, reused everywhere it's needed
// rather than a bespoke icon per page, says "designed" without competing
// with the actual copy underneath it.
export function EmptyIcon({
  className = "mx-auto mb-3 h-10 w-10",
}: {
  className?: string;
}) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-zinc-900/8 text-zinc-700 dark:bg-white/10 dark:text-zinc-300 ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="5" y="4" width="14" height="16" rx="2" />
        <path d="M9 9h6M9 12.5h6M9 16h3" />
      </svg>
    </div>
  );
}
