# Conteúdo do projeto `nexo-crm` depois do corte (NÃO aplicado)

Pronto para o passo 7 de `vendedoria/docs/CORTE_CRM.md`: substituir o conteúdo de `crm/` por estes arquivos
(Root Directory do projeto continua `crm`; nada muda na configuração da Vercel). Mantém o domínio antigo vivo:

- `/p/{token}` → 308 `https://app.avanteza.com.br/comercial/p/{token}` (proposta pública);
- `/api/*` → 410 com `{ "erro": … }` (o Vendedor IA já não chama; a Central já trocou `CRM_URL`);
- qualquer outra página (`/`, `/login`, `/oportunidades`…) → 308 `https://app.avanteza.com.br/comercial`.

Site estático: `framework: null`, sem instalação nem build, saída `public/`. **Mantenha o `.vercelignore`** (cópia do
`crm/.vercelignore`): sem ele o projeto cai no da raiz, que lista `crm/`, e publica vazio. Não pause o projeto (pausado,
o domínio antigo deixa de redirecionar). Teste: `vendedoria/tests/corte-crm.test.ts`.
