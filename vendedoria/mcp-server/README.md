# nexo-vendedoria MCP server

Dá a qualquer agente de IA compatível com [MCP](https://modelcontextprotocol.io)
(Claude Desktop, Claude Code, outro agente) acesso de **leitura e edição** ao
nexo-vendedoria inteiro — sem precisar entrar no código nem abrir sessão de
navegador.

Duas ferramentas cobrem o sistema todo:

- **`nexo_graphql`** — qualquer query/mutation do schema GraphQL que o próprio
  CRM usa: leads, conversas do WhatsApp, mensagens, campanhas, calendário,
  profissionais/unidades, agente de IA, organização e contas.
- **`nexo_rest`** — qualquer rota REST protegida por chave de API, principalmente
  `/api/prospeccao/*` (buscas, empresas, pipeline de qualificação, disparo).

## 1. Gerar uma chave de API

No CRM, vá em **Configurações → API** e clique em "Criar chave". Copie o valor
mostrado — ele não aparece de novo (só o prefixo fica visível depois, pra você
reconhecer qual chave é qual).

## 2. Instalar e buildar

```bash
cd mcp-server
npm install
npm run build
```

## 3. Configurar no seu cliente MCP

Exemplo para o Claude Desktop / Claude Code (`claude_desktop_config.json` ou
equivalente):

```json
{
  "mcpServers": {
    "nexo-vendedoria": {
      "command": "node",
      "args": ["/caminho/absoluto/para/nexo-backend/vendedoria/mcp-server/dist/index.js"],
      "env": {
        "NEXO_API_BASE_URL": "https://nexo-vendedoria.vercel.app",
        "NEXO_API_KEY": "nexo_live_..."
      }
    }
  }
}
```

`NEXO_API_BASE_URL` pode ser omitida — o padrão já é a produção
(`https://nexo-vendedoria.vercel.app`). Aponte para um preview ou `localhost`
quando quiser testar contra outro ambiente.

## 4. Testar sem um cliente MCP

```bash
npm run dev
```

O servidor fala MCP por stdio — para um teste rápido de ponta a ponta, use o
[MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Segurança

Uma chave de API dá o mesmo acesso de um usuário ADMIN logado no CRM. Trate-a
como uma senha: nunca a coloque em um repositório público, e revogue em
Configurações → API assim que uma integração parar de ser usada.
