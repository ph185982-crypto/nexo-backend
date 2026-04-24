# SPRINT 3: Dynamic Prompt Compiler

## Visão Geral

O Dynamic Prompt Compiler é o sistema que monta o **prompt final da IA em tempo real**, baseado em configurações do banco de dados. Isso permite que o comportamento da IA seja 100% configurável via dashboard, sem necessidade de hardcoding.

**Antes (Sprint 2):**
```
Mensagem do cliente → DecisionService → Decide ação (RESPOND, FOLLOW_UP, ESCALATE)
```

**Agora (Sprint 3):**
```
Mensagem do cliente → DecisionService → Decide ação
                                           ↓ (se RESPOND)
                                    PromptCompilerService
                                    ↓ (monta 5 layers)
                                    LLM com prompt compilado
                                    ↓
                                    Resposta final
```

## Arquitetura de 5 Camadas

### Layer 1: Persona 🎭
**O QUE:** Tom de voz + Arquétipo  
**ONDE:** `PersonalityProfile` table  
**EXEMPLOS:**
- **Formal**: Consultor, tom corporativo, dados e ROI
- **Agressivo**: Vendedor, tom direto, urgência, close rápido
- **Amigável**: Amigo, tom casual, emojis, relacionamento

```sql
INSERT INTO "PersonalityProfile" (name, emoji, archetype, tone)
VALUES (
  'Agressivo',
  '⚡',
  'Vendedor Experiente',
  'Você é um vendedor agressivo e motivado. Seu tom é direto, rápido e focado em FECHAR a venda AGORA.'
);
```

### Layer 2: Strategy 🎯
**O QUE:** Objetivo de venda + Urgência  
**ONDE:** `StrategyProfile` table  
**EXEMPLOS:**
- **Venda Rápida**: Close imediato, high urgency
- **Relacionamento**: Lead qualificado, medium urgency
- **Educacional**: Informação, low urgency

```sql
INSERT INTO "StrategyProfile" (name, salesGoal, urgency, description)
VALUES (
  'Venda Rápida',
  'Close imediato',
  'high',
  'Crie urgência e feche agora. Mostre limitação de estoque/oferta.'
);
```

### Layer 3: Constraints ⛔
**O QUE:** Limites de comportamento (o que NÃO pode fazer)  
**ONDE:** `ConstraintRule` table  
**EXEMPLOS:**
- "NÃO prometa prazos de entrega que não pode cumprir"
- "NÃO faça promessas sobre descontos sem autorização"
- "NÃO compare com concorrentes sem autorização"

```sql
INSERT INTO "ConstraintRule" (title, rule, reason)
VALUES (
  'Sem Promessas de Prazo',
  'NÃO prometa entrega em menos de 24h sem confirmar com logística',
  'Evita problemas legais e insatisfação do cliente'
);
```

### Layer 4: Objection Rules ℹ️
**O QUE:** Estratégias para lidar com objeções específicas  
**ONDE:** `ObjectionRule` table  
**ACIONADA POR:** Keywords detectadas na mensagem do cliente

**EXEMPLOS:**
```sql
INSERT INTO "ObjectionRule" (keyword, objectionType, responseStrategy, counterArgument)
VALUES 
  ('caro', 'PRICE', 'Acknowledge the concern, show ROI', 'Nossa solução sai 40% mais barato que concorrentes'),
  ('concorrente', 'COMPETITOR', 'Differentiate with unique features', 'A gente oferece suporte 24/7, eles não'),
  ('sem interesse', 'DISINTEREST', 'Clarify objection and provide alternative', 'Entendo, mas posso deixar um email com mais info?');
```

### Layer 5: Conversation History 📋
**O QUE:** Últimas N mensagens para contexto  
**ONDE:** Carregadas do histórico da conversa  
**FUNÇÃO:** Dar contexto ao LLM sobre o que já foi discutido

## Integração com Orquestrador

```typescript
// No Orchestrator
const decision = await makeDecision(...);  // DecisionService

if (decision.action === "RESPOND") {
  const compiled = await compilePrompt(...);  // PromptCompilerService
  // Agora use compiled.systemPrompt com o LLM
}
```

**Resultado:**
```typescript
interface AIDecisionResult {
  action: "RESPOND";
  compiledPrompt: {
    systemPrompt: string;  // Prompt final montado
    layers: {
      layer1_persona: string;
      layer2_strategy: string;
      layer3_constraints: string;
      layer4_objectionRules: string;
      layer5_history: string;
    };
    metadata: {
      personalityName: "Agressivo";
      strategyName: "Venda Rápida";
    };
  };
}
```

## Impacto: Mesmo Cliente, 3 Personalidades

**Cliente diz:** "Qual é o preço? Achei que seria mais barato."

**Se Personalidade = Formal (👔):**
> "Entendo sua preocupação. Nosso preço reflete a qualidade premium e suporte incluído. Posso detalhar o ROI esperado em 6 meses?"

**Se Personalidade = Agressivo (⚡):**
> "Olha, o preço é justo mesmo, cara! Mas deixa eu te mostrar o que você ganha por isso. Essa oportunidade é HOJE. Pode ser? 🚀"

**Se Personalidade = Amigável (😊):**
> "Fico feliz que perguntou! 😊 A gente tem opções que cabem em vários orçamentos. Qual é sua faixa de preço?"

## Setup do Dashboard (Futura Sprint 4)

O admin poderá:

1. **Escolher Personalidade**: Dropdown com Formal/Agressivo/Amigável/Custom
2. **Escolher Strategy**: Dropdown com Venda Rápida/Relacionamento/Educacional
3. **Editar Constraints**: List de regras que a IA não pode quebrar
4. **Editar ObjectionRules**: Keywords → estratégias de resposta
5. **Teste em tempo real**: "Preview" do prompt compilado

## Código-chave

### Compilar Prompt (Sprint 3)
```typescript
const compiled = await compilePrompt(conversationId, messages);
// Retorna CompiledPrompt com 5 layers + systemPrompt final
```

### Debug: Ver Estrutura do Prompt
```typescript
import { debugPrintCompiledPrompt } from "@/lib/ai/prompt-compiler";
debugPrintCompiledPrompt(compiled);
// Imprime todas as 5 camadas no console
```

## Validação

**Script de teste:** `tests/test-compiler.ts`

```bash
npx tsx tests/test-compiler.ts
```

**Resultado:**
- ✅ Prompts são distintos entre personalidades
- ✅ Formal tem tom corporativo
- ✅ Agressivo tem urgência
- ✅ Amigável tem tom casual

## Próximas Etapas

### Sprint 4: Orchestrator Integration
- Integrar chamadas ao PromptCompilerService no webhook
- Usar `compiled.systemPrompt` para chamar LLM
- Salvar qual prompt foi usado para auditoria

### Sprint 5: Manager Dashboard
- UI para editar PersonalityProfile, StrategyProfile, Constraints, ObjectionRules
- Preview em tempo real do prompt compilado
- Teste A/B: comparar resultados entre personalidades

## Resumo

| Aspecto | Antes (Sprint 2) | Depois (Sprint 3) |
|--------|-----------------|------------------|
| Prompt | Hardcoded em agent.ts | Montado em tempo real |
| Personalidade | Fixa no código | Configurável via DB |
| Objeções | Regras fixas em código | Configurável por keyword |
| Mudança de tom | Requer deploy | Requer apenas DB update |

**Resultado:** ✅ 100% configurável, zero hardcoding, 100% auditável.
