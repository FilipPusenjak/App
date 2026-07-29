// Auth.js (NextAuth v5) configuration.
//
// Strategy: email + password via the Credentials provider, with JWT sessions.
// Credentials REQUIRES the JWT strategy (it can't use database sessions), which
// is also why we don't need the Auth.js Prisma adapter or its extra tables.
//
// This module runs only in Node contexts (the /api/auth route handler and
// server components that call `auth()`), so it is safe to use Prisma + bcrypt
// here. It is intentionally NOT imported into proxy.ts.
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { loginSchema } from "@/lib/validation/auth";
import {
  isLockedOut,
  recordFailedLogin,
  clearFailedLogins,
} from "@/lib/login-throttle";

/**
 * A real bcrypt hash of a value nobody uses. Compared against when no account
 * matches, so "no such user" and "wrong password" take similar time.
 */
const DUMMY_PASSWORD_HASH =
  "$2b$12$vc2SAoud9K8NdUHNP8PbmeQB6wb1kLcno7bLRkzkBtFjsTAt1NIuS";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  // Trust the host header for self-hosting / localhost (not on Vercel).
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (raw) => {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;

        // loginSchema lowercases the address. Signup stores emails lowercased,
        // so without this a user who types any capital letter is told their
        // password is wrong — forever.
        const { email, password } = parsed.data;
        const user = await prisma.user.findUnique({ where: { email } });

        if (!user) {
          // Compare against a throwaway hash so a missing account takes about
          // as long as a wrong password. Returning early here would let an
          // attacker distinguish registered addresses by response time.
          await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
          return null;
        }

        // Refuse while locked, without revealing that state to the caller.
        if (isLockedOut(user)) return null;

        const passwordMatches = await bcrypt.compare(
          password,
          user.passwordHash,
        );
        if (!passwordMatches) {
          await recordFailedLogin(user);
          return null;
        }

        await clearFailedLogins(user);
        // Never return the password hash to the session.
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    // Persist the user id on the token...
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    // ...and expose it on the session so server code can scope queries by it.
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      return session;
    },
  },
});
