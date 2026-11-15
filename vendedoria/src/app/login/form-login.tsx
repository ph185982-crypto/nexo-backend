"use client";

import React, { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/ui/logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Entrada principal: login único da Avanteza (link para a Central). O formulário de e-mail e senha continua
 * como alternativa — é a reserva até o login único estar provado.
 */
export function FormLogin({ entrarComAvanteza, erroInicial }: { entrarComAvanteza: string; erroInicial: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(erroInicial);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.ok) {
      const cb = new URLSearchParams(window.location.search).get("callbackUrl");
      router.push(cb && cb.startsWith("/") && !cb.startsWith("//") ? cb : "/crm");
    } else {
      const msg =
        result?.error === "CredentialsSignin"
          ? "Email ou senha inválidos"
          : result?.error
          ? `Erro: ${result.error}`
          : "Não foi possível conectar. Tente novamente.";
      setError(msg);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-marinho flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="text-center space-y-2">
          <Logo className="text-4xl text-creme" />
          <p className="text-areia text-sm font-semibold">Vendedor IA · Avanteza</p>
        </div>

        <Card className="border-marinho-2">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl text-center">Entrar</CardTitle>
            <CardDescription className="text-center">
              Use o login único da Avanteza ou seu e-mail e senha
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div role="alert" className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                {error}
              </div>
            )}

            <Button asChild variant="destaque" className="w-full">
              <a href={entrarComAvanteza}>Entrar com Avanteza</a>
            </Button>
            <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              ou com e-mail e senha
              <span className="h-px flex-1 bg-border" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                variant="outline"
                className="w-full"
                disabled={loading}
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Entrar com senha
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-creme/60 text-xs">
          © 2026 Avanteza. Todos os direitos reservados.
        </p>
      </div>
    </div>
  );
}
