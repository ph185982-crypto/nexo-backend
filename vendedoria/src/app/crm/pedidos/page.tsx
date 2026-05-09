"use client";

import { useEffect, useState, useCallback } from "react";
import { Package, Printer, Truck, RefreshCw } from "lucide-react";

interface PedidoNacional {
  id: string;
  nomeCliente: string;
  produto: string;
  cepDestino: string;
  enderecoCompleto: string;
  valorProduto: number;
  valorFrete: number;
  valorTotal: number;
  transportadora: string;
  prazoFrete: number;
  formaPagamento: string;
  etapaEnvio: string;
  urlEtiqueta: string | null;
  codigoRastreamento: string | null;
  pagamentoStatus: string;
  criadoEm: string;
}

const COLUNAS: { key: string; label: string; cor: string }[] = [
  { key: "AGUARDANDO_PAGAMENTO", label: "Aguardando Pagamento", cor: "border-yellow-400" },
  { key: "PAGO",                 label: "Pago",                 cor: "border-green-400" },
  { key: "ETIQUETA_GERADA",      label: "Etiqueta Gerada",      cor: "border-blue-400" },
  { key: "DESPACHADO",           label: "Despachado",           cor: "border-purple-400" },
  { key: "ENTREGUE",             label: "Entregue",             cor: "border-emerald-400" },
];

export default function PedidosNacionaisPage() {
  const [pedidos, setPedidos] = useState<PedidoNacional[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [despachando, setDespachando] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const fetchPedidos = useCallback(async () => {
    try {
      const res = await fetch("/api/pedidos/nacionais");
      const data = await res.json();
      setPedidos(data.pedidos ?? []);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPedidos();
    const interval = setInterval(fetchPedidos, 15_000);
    return () => clearInterval(interval);
  }, [fetchPedidos]);

  const handleDespachar = async (id: string) => {
    setDespachando(id);
    try {
      const res = await fetch(`/api/pedidos/nacional/${id}/despachar`, { method: "PUT" });
      if (res.ok) {
        showToast("Rastreamento enviado para o cliente ✅");
        await fetchPedidos();
      } else {
        showToast("Erro ao marcar como despachado ❌");
      }
    } catch {
      showToast("Erro de conexão ❌");
    } finally {
      setDespachando(null);
    }
  };

  const pedidosPorEtapa = (etapa: string) =>
    pedidos.filter((p) => p.etapaEnvio === etapa);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <Package className="w-5 h-5 text-emerald-500" />
          <h1 className="text-lg font-semibold text-foreground">Pedidos Nacionais</h1>
          <span className="text-sm text-muted-foreground">({pedidos.length} pedidos)</span>
        </div>
        <button
          onClick={fetchPedidos}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Atualizar
        </button>
      </div>

      {/* Kanban board */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Carregando pedidos…
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto p-4">
          <div className="flex gap-4 h-full min-w-max">
            {COLUNAS.map((col) => {
              const itens = pedidosPorEtapa(col.key);
              return (
                <div
                  key={col.key}
                  className={`flex flex-col w-72 flex-shrink-0 bg-muted/40 rounded-xl border-t-2 ${col.cor}`}
                >
                  {/* Column header */}
                  <div className="px-3 py-2.5 border-b border-border flex-shrink-0">
                    <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
                      {col.label}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">({itens.length})</span>
                  </div>

                  {/* Cards */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {itens.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-6">Nenhum pedido</p>
                    )}
                    {itens.map((pedido) => (
                      <PedidoCard
                        key={pedido.id}
                        pedido={pedido}
                        onDespachar={handleDespachar}
                        despachando={despachando === pedido.id}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

function PedidoCard({
  pedido,
  onDespachar,
  despachando,
}: {
  pedido: PedidoNacional;
  onDespachar: (id: string) => void;
  despachando: boolean;
}) {
  const estadoCep = pedido.enderecoCompleto.split(",").slice(-1)[0]?.trim() ?? pedido.cepDestino;

  return (
    <div className="bg-background rounded-lg border border-border p-3 space-y-2 shadow-sm text-sm">
      {/* Nome e estado */}
      <div>
        <p className="font-semibold text-foreground truncate">{pedido.nomeCliente}</p>
        <p className="text-xs text-muted-foreground truncate">{estadoCep}</p>
      </div>

      {/* Produto */}
      <p className="text-xs text-foreground/80 truncate">{pedido.produto}</p>

      {/* Valores */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Produto: R$ {pedido.valorProduto.toFixed(2)}</span>
        <span className="text-muted-foreground">Frete: R$ {pedido.valorFrete.toFixed(2)}</span>
      </div>
      <div className="text-xs font-semibold text-foreground">
        Total: R$ {pedido.valorTotal.toFixed(2)}
      </div>

      {/* Pagamento */}
      <div className="flex items-center gap-1.5">
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
          pedido.formaPagamento === 'pix'
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
        }`}>
          {pedido.formaPagamento === 'pix' ? 'Pix' : 'Parcelado'}
        </span>
      </div>

      {/* Transportadora */}
      <div className="text-xs text-muted-foreground">
        🚚 {pedido.transportadora} — {pedido.prazoFrete} dia(s) útil(is)
      </div>

      {/* Rastreamento */}
      {pedido.codigoRastreamento && (
        <div className="text-xs bg-muted rounded px-2 py-1 font-mono">
          📦 {pedido.codigoRastreamento}
        </div>
      )}

      {/* Ações */}
      {pedido.etapaEnvio === 'ETIQUETA_GERADA' && (
        <div className="flex flex-col gap-1.5 pt-1">
          {pedido.urlEtiqueta && (
            <a
              href={pedido.urlEtiqueta}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-lg bg-muted hover:bg-muted/80 text-foreground border border-border transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              Imprimir etiqueta
            </a>
          )}
          <button
            onClick={() => onDespachar(pedido.id)}
            disabled={despachando}
            className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            <Truck className="w-3.5 h-3.5" />
            {despachando ? "Marcando…" : "Marcar como despachado"}
          </button>
        </div>
      )}

      {/* Data */}
      <p className="text-[10px] text-muted-foreground">
        {new Date(pedido.criadoEm).toLocaleString("pt-BR", {
          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        })}
      </p>
    </div>
  );
}
