import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma/client";
import { authConfig } from "./config";
import { autorizarSso, PROVIDER_SSO } from "./sso";
import { ipDaRequisicao, limparFalhasLogin, loginBloqueado, registrarFalhaLogin } from "./tentativas";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = String(credentials.email);
        const ip = ipDaRequisicao(request);

        // Força bruta: depois de 10 falhas no e-mail (ou 30 no IP) em 15 min,
        // nem a senha certa entra até a janela passar.
        if (await loginBloqueado(email, ip).catch(() => false)) {
          console.warn(`[Auth] Login bloqueado por excesso de tentativas | email=${email} ip=${ip ?? "?"}`);
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });

        const isValid = Boolean(user?.password) && await bcrypt.compare(
          credentials.password as string,
          user!.password!,
        );

        if (!user || !isValid) {
          await registrarFalhaLogin(email, ip).catch(() => {});
          return null;
        }
        await limparFalhasLogin(email).catch(() => {});

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
    // Login único (Avanteza ID). Segundo provider, separado do de senha acima: recebe o token que a Central
    // devolveu em /api/sso/callback, confere a assinatura e acha ou cria o usuário (lib/auth/sso.ts).
    Credentials({
      id: PROVIDER_SSO,
      name: "Avanteza ID",
      credentials: {
        token: { label: "Token", type: "text" },
      },
      async authorize(credentials) {
        return autorizarSso(credentials?.token);
      },
    }),
  ],
});
