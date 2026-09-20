import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';

/**
 * GitHub login. The user's own token decides which repositories they may see, so
 * Logsy never keeps its own access list: see lib/access.ts.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
  ],
  callbacks: {
    jwt({ token, account }) {
      // Kept so the server can ask GitHub what this user can reach.
      if (account?.access_token) token.accessToken = account.access_token;
      return token;
    },
    session({ session, token }) {
      session.accessToken = typeof token.accessToken === 'string' ? token.accessToken : undefined;
      return session;
    },
  },
  pages: { signIn: '/signin' },
});

declare module 'next-auth' {
  interface Session {
    accessToken?: string | undefined;
  }
}
