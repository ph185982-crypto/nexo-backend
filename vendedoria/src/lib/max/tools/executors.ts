import {
  registrarTransacao,
  desfazerUltima,
  buscarTransacoes,
  editarTransacao,
  excluirTransacao,
  gerarExtrato,
  consultarFinancas,
} from "./transacoes";
import { criarLembrete, listarLembretes } from "./lembretes";
import {
  gerenciarDivida,
  gerenciarReceitaPrevista,
  gerenciarContaPagar,
  gerenciarOrcamento,
  gerenciarTarefa,
} from "./gestao";
import { salvarInformacao } from "./memoria";
import { analiseProfunda, projecaoCaixa } from "./analise";
import { buscarNaWeb } from "./web";
import { consultarCrm } from "./crm";

export async function executeMaxTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      case "registrar_transacao":
        return await registrarTransacao(args);
      case "desfazer_ultima":
        return await desfazerUltima(args);
      case "buscar_transacoes":
        return await buscarTransacoes(args);
      case "editar_transacao":
        return await editarTransacao(args);
      case "excluir_transacao":
        return await excluirTransacao(args);
      case "gerar_extrato":
        return await gerarExtrato(args);
      case "consultar_financas":
        return await consultarFinancas(args);
      case "criar_lembrete":
        return await criarLembrete(args);
      case "listar_lembretes":
        return await listarLembretes();
      case "gerenciar_divida":
        return await gerenciarDivida(args);
      case "gerenciar_receita_prevista":
        return await gerenciarReceitaPrevista(args);
      case "gerenciar_conta_pagar":
        return await gerenciarContaPagar(args);
      case "gerenciar_orcamento":
        return await gerenciarOrcamento(args);
      case "gerenciar_tarefa":
        return await gerenciarTarefa(args);
      case "salvar_informacao":
        return await salvarInformacao(args);
      case "analise_profunda":
        return await analiseProfunda(args);
      case "projecao_caixa":
        return await projecaoCaixa(args);
      case "buscar_na_web":
        return await buscarNaWeb(args);
      case "consultar_crm":
        return await consultarCrm(args);
      default:
        return `Tool "${name}" nao reconhecida.`;
    }
  } catch (err) {
    console.error(`[Max] Tool ${name} error:`, err);
    return `Erro ao executar ${name}: ${err instanceof Error ? err.message : String(err)}`;
  }
}
