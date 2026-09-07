// Type augmentation so `session.user.id` and `token.id` are typed everywhere.
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      /**
       * The account's session version at the moment this token was minted.
       * Compared against the row on every request — see lib/session.ts.
       */
      sessionVersion?: number;
    } & DefaultSession["user"];
  }

  /** What `authorize` returns and the jwt callback reads on sign-in. */
  interface User {
    sessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    /** Short on purpose: it is in every cookie on every request. */
    sv?: number;
  }
}
