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

        const { email, password } = parsed.data;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const passwordMatches = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatches) return null;

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
