import { randomUUID } from "node:crypto";
import { ipAddress } from "@vercel/functions";
import { compare } from "bcrypt-ts";
import NextAuth, { type DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { DUMMY_PASSWORD } from "@/lib/constants";
import {
  createGuestUser,
  getUser,
  getUserSessionState,
} from "@/lib/db/queries";
import { enforceIpRateLimit } from "@/lib/ratelimit";
import { sessionBinding } from "@/lib/server/admin/session-binding";
import { authConfig } from "./auth.config";

export type UserType = "guest" | "regular";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      type: UserType;
    } & DefaultSession["user"];
  }

  interface User {
    email?: string | null;
    id?: string;
    sessionVersion?: number;
    type: UserType;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    graceSessionBinding?: string;
    id: string;
    sessionVersion?: number;
    type: UserType;
  }
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.type = user.type;
        token.graceSessionBinding = randomUUID();
      } else if (!token.graceSessionBinding) {
        // Migrate older sessions from their original Auth.js jti. Once saved
        // in the refreshed JWT, this value no longer changes on refresh.
        const binding = sessionBinding(token);
        if (binding) {
          token.graceSessionBinding = binding;
        }
      }

      if (!token.id) {
        return null;
      }
      const state = await getUserSessionState(token.id);
      if (!state?.enabled) {
        return null;
      }
      if (user) {
        token.sessionVersion = user.sessionVersion;
      }
      if (token.sessionVersion !== state.sessionVersion) {
        return null;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.type = token.type;
      }

      return session;
    },
  },
  providers: [
    Credentials({
      async authorize(credentials, request) {
        await enforceIpRateLimit(ipAddress(request), "login");
        const email = String(credentials.email ?? "");
        const password = String(credentials.password ?? "");
        const users = await getUser(email);

        if (users.length === 0) {
          await compare(password, DUMMY_PASSWORD);
          return null;
        }

        const [user] = users;

        if (!user.password || user.isAnonymous) {
          await compare(password, DUMMY_PASSWORD);
          return null;
        }

        const passwordsMatch = await compare(password, user.password);

        if (!passwordsMatch) {
          return null;
        }

        return { ...user, type: "regular" };
      },
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
    }),
    Credentials({
      async authorize(_credentials, request) {
        await enforceIpRateLimit(ipAddress(request), "guest");
        const [guestUser] = await createGuestUser();
        return { ...guestUser, type: "guest" };
      },
      credentials: {},
      id: "guest",
    }),
  ],
});
