"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * One nav link, aware of whether it's the current section — shared by the
 * desktop bar and the phone disclosure, so "where am I" answers the same way
 * on both. Each caller keeps its own `<nav>` wrapper (the phone one needs an
 * onClick to close the disclosure; nesting a second `<nav>` inside it here
 * would be invalid HTML on top of swallowing that handler), so this renders
 * just the `<Link>`.
 *
 * A client component because the current path isn't known to the (app)
 * layout's server render. That's the one reason this isn't just another
 * `<Link>` where the two nav lists used to render their own.
 *
 * Active means "on this section", not "on this exact URL" — /evaluations/abc123
 * still lights up Evaluations, via startsWith rather than equality. The one
 * exception is /dashboard: every other section's href is also a prefix of
 * itself, but "/" is a prefix of everything, so the root nav item needs the
 * equality check or it would light up permanently.
 */
export function NavLink({
  href,
  className = "",
  activeClassName = "font-semibold text-zinc-900 dark:text-white",
  children,
}: {
  href: string;
  className?: string;
  activeClassName?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active =
    href === "/dashboard"
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={active ? `${className} ${activeClassName}` : className}
    >
      {children}
    </Link>
  );
}
