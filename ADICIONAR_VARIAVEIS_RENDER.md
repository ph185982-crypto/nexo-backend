# 🔧 Como Adicionar Variáveis de Ambiente no Render

**Objetivo**: Configurar o token do Facebook Ads e o Ad Account ID

---

## 📋 Variáveis a Adicionar

| Variável | Valor | Descrição |
|---|---|---|
| `META_ADS_TOKEN` | `EAAcNazmVPQ8BQxVZBR146xeWWtnxXgV22KJPcZAHTQG9jWFi23pUWiGvlL2iWB2oIWmpzN9zmMooBmlbxwZCCIAqRZCbdsLjn8HsoWIrPprPZAlyg6ASBIkPZAKaxJBJkMd7YwzOfcFZBSIEqJogtitvbfZBfqKBVLVAZBUiy0ZBkuwg4ZAzI9ZCC3wINtH06S263cQ4xz7XcZBjZBHdjIvU1PjMZCW5nAhZA6DEE9aQiqvVVODY6oWATDlev5m8ItptgJVAC3GzcPDK3mERB38s3NqwOSVPkeSW5I38LLoZAsAZDZD` | Token de acesso do Facebook Ads |
| `META_AD_ACCOUNT_ID` | `605261696580859` | ID da conta de anúncios |

---

## 🚀 Passo a Passo

### Passo 1: Acessar o Dashboard do Render

1. Acesse: https://dashboard.render.com
2. Selecione o serviço: **"nexo-backend-tjoj"**

### Passo 2: Ir para Environment

1. Clique em **"Environment"** (no menu superior)
2. Você verá uma lista de variáveis existentes

### Passo 3: Adicionar META_ADS_TOKEN

1. Clique em **"Add Environment Variable"** (ou botão similar)
2. **Name**: `META_ADS_TOKEN`
3. **Value**: `EAAcNazmVPQ8BQxVZBR146xeWWtnxXgV22KJPcZAHTQG9jWFi23pUWiGvlL2iWB2oIWmpzN9zmMooBmlbxwZCCIAqRZCbdsLjn8HsoWIrPprPZAlyg6ASBIkPZAKaxJBJkMd7YwzOfcFZBSIEqJogtitvbfZBfqKBVLVAZBUiy0ZBkuwg4ZAzI9ZCC3wINtH06S263cQ4xz7XcZBjZBHdjIvU1PjMZCW5nAhZA6DEE9aQiqvVVODY6oWATDlev5m8ItptgJVAC3GzcPDK3mERB38s3NqwOSVPkeSW5I38LLoZAsAZDZD`
4. Clique em **"Save"**

### Passo 4: Adicionar META_AD_ACCOUNT_ID

1. Clique em **"Add Environment Variable"** novamente
2. **Name**: `META_AD_ACCOUNT_ID`
3. **Value**: `605261696580859`
4. Clique em **"Save"**

### Passo 5: Fazer Deploy

1. Volte para a página principal do serviço
2. Clique em **"Manual Deploy"** ou aguarde deploy automático
3. Aguarde 2-3 minutos

---

## ✅ Verificar se Funcionou

Depois que o deploy terminar:

```bash
# Testar endpoint de Ads
curl -H "Authorization: Bearer TOKEN_AQUI" \
  https://nexo-backend-tjoj.onrender.com/api/meta/ads
```

**Deve retornar dados reais do seu Facebook Ads!**

---

## 🆘 Se Algo Não Funcionar

### Erro: "Token inválido"
- Verifique se o token está correto
- Regenere um novo token no Facebook

### Erro: "Permissão negada"
- O token precisa ter as permissões:
  - `ads_read`
  - `read_insights`
  - `ads_management`
  - `business_management`

### Erro: "Ad Account ID inválido"
- Verifique se o ID está correto
- Formato: apenas números (sem `act_`)

---

## 📝 Próximos Passos

Depois que as variáveis estiverem configuradas:

1. [ ] Deploy no Render
2. [ ] Testar endpoint `/api/meta/ads`
3. [ ] Verificar se dados reais aparecem
4. [ ] Testar endpoint `/api/analytics/ads-analysis`

---

**Status**: Aguardando você adicionar as variáveis no Render
