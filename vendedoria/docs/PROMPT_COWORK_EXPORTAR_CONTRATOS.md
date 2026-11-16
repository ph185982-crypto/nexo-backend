# Prompt para o Cowork: exportar o histórico de contratos do navegador

O app Contratos antigo (`nexo-presenter.vercel.app`) guardava o histórico **só no navegador** (`localStorage`,
chave `nexo_history_v1`, até 300 itens). Antes de desligá-lo, exporte esse histórico de cada navegador/computador
onde contratos foram emitidos e importe no Comercial:

```bash
cd vendedoria
node scripts/importar-contratos.mjs --arquivo historico-contratos-<host>.json             # cria os registros
node scripts/importar-contratos.mjs --arquivo historico-contratos-<host>.json --clicksign # + status real e PDF assinado
```

A importação é idempotente (rodar de novo cria 0), não imprime dados de clientes e não dispara a automação do
"assinado" (esses clientes já existem na operação). Itens do ZapSign entram como só leitura.

---

Cole o texto abaixo no Cowork:

> Você é um assistente de navegador. Preciso exportar o histórico de contratos da ferramenta **Contratos** da Avanteza, que fica salvo só neste navegador.
>
> 1. Abra o endereço do app de contratos (o mesmo que você usa para gerar contratos; hoje é `https://nexo-presenter.vercel.app`) **no navegador e no perfil em que os contratos foram gerados**. Se eu usar mais de um navegador/computador, repita em cada um e me avise.
> 2. Não gere, envie, cancele nem apague nenhum contrato. Só leitura.
> 3. Abra as ferramentas do desenvolvedor (F12), aba **Console**, e rode exatamente isto:
>
> ```js
> (() => {
>   const bruto = localStorage.getItem('nexo_history_v1');
>   const itens = bruto ? JSON.parse(bruto) : [];
>   const saida = { exportadoEm: new Date().toISOString(), origem: location.origin, total: itens.length, itens };
>   const blob = new Blob([JSON.stringify(saida, null, 2)], { type: 'application/json' });
>   const a = document.createElement('a');
>   a.href = URL.createObjectURL(blob);
>   a.download = 'historico-contratos-' + location.hostname + '.json';
>   document.body.appendChild(a); a.click(); a.remove();
>   return `Exportados ${itens.length} contratos.`;
> })()
> ```
>
> 4. Confirme a mensagem "Exportados N contratos" e que o arquivo `historico-contratos-<host>.json` foi baixado. Se N for 0, rode também `Object.keys(localStorage)` e me diga as chaves que começam com `nexo_`.
> 5. Me entregue o arquivo (anexe ou diga onde está salvo) e, **sem copiar o conteúdo para o chat**, informe só: o total de contratos, a data do mais antigo e do mais recente (`createdAt`) e quantos têm o campo `zsToken` (enviados para assinatura). Esses arquivos têm nomes, CNPJ, e-mail e telefone de clientes: não cole em nenhum site.
> 6. Não apague o histórico do navegador depois. Só será limpo quando eu confirmar que a importação foi conferida.

---

Depois de importar: abra **Comercial › Contratos** e confira o total; contratos sem PDF (gerados e não enviados)
mostram "Gerar de novo", que refaz o PDF a partir do formulário salvo.
