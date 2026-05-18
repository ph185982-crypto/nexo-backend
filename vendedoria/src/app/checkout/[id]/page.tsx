'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

type Etapa = 'dados' | 'pagamento' | 'pix' | 'boleto' | 'sucesso' | 'erro';

interface FormData {
  nome: string;
  cpf: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  cidade: string;
  estado: string;
}

export default function CheckoutPage() {
  const params = useParams();
  const id = params.id as string;

  const [etapa, setEtapa] = useState<Etapa>('dados');
  const [loading, setLoading] = useState(false);
  const [erroMensagem, setErroMensagem] = useState('');
  const [pixData, setPixData] = useState<{ pixCopiaECola: string; pixQrCodeBase64: string } | null>(null);
  const [boletoData, setBoletoData] = useState<{ boletoUrl: string; boletoCodigoBarra: string; dataVencimento: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [checkoutValido, setCheckoutValido] = useState<boolean | null>(null);
  const [buscandoCEP, setBuscandoCEP] = useState(false);

  const [form, setForm] = useState<FormData>({
    nome: '', cpf: '', cep: '', endereco: '',
    numero: '', complemento: '', cidade: '', estado: '',
  });

  useEffect(() => {
    fetch(`/api/checkout/${id}`)
      .then(r => r.json())
      .then((data: { expirado?: boolean; pago?: boolean; erro?: string; ok?: boolean }) => {
        if (data.expirado || data.erro) { setCheckoutValido(false); return; }
        if (data.pago) { setEtapa('sucesso'); setCheckoutValido(true); return; }
        setCheckoutValido(true);
      })
      .catch(() => setCheckoutValido(false));
  }, [id]);

  async function buscarCEP(cep: string) {
    const cepLimpo = cep.replace(/\D/g, '');
    if (cepLimpo.length !== 8) return;
    setBuscandoCEP(true);
    try {
      const res = await fetch(`/api/cep/${cepLimpo}`);
      const data = await res.json() as { logradouro?: string; cidade?: string; estado?: string };
      if (data.logradouro) {
        setForm(f => ({ ...f, endereco: data.logradouro!, cidade: data.cidade ?? f.cidade, estado: data.estado ?? f.estado }));
      }
    } catch { /* ignore */ }
    setBuscandoCEP(false);
  }

  function atualizarForm(campo: keyof FormData, valor: string) {
    setForm(f => ({ ...f, [campo]: valor }));
    if (campo === 'cep') void buscarCEP(valor);
  }

  function validarDados() {
    if (!form.nome.trim()) return 'Informe seu nome completo';
    if (form.cep.replace(/\D/g, '').length < 8) return 'CEP inválido';
    if (!form.endereco.trim()) return 'Informe seu endereço';
    if (!form.numero.trim()) return 'Informe o número';
    if (!form.cidade.trim()) return 'Informe a cidade';
    return null;
  }

  function avancarParaPagamento() {
    const erro = validarDados();
    if (erro) { setErroMensagem(erro); return; }
    setErroMensagem('');
    setEtapa('pagamento');
  }

  async function pagarPix() {
    setLoading(true);
    setErroMensagem('');
    try {
      const res = await fetch(`/api/checkout/${id}/pix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: form.nome, cep: form.cep, endereco: form.endereco, numero: form.numero, complemento: form.complemento, cidade: form.cidade, estado: form.estado }),
      });
      const data = await res.json() as { pixCopiaECola?: string; pixQrCodeBase64?: string; erro?: string };
      if (data.erro) throw new Error(data.erro);
      setPixData({ pixCopiaECola: data.pixCopiaECola!, pixQrCodeBase64: data.pixQrCodeBase64! });
      setEtapa('pix');
    } catch (err: unknown) {
      setErroMensagem((err as Error).message || 'Erro ao gerar Pix. Tente novamente.');
    }
    setLoading(false);
  }

  async function pagarParcelado() {
    setLoading(true);
    setErroMensagem('');
    try {
      const res = await fetch(`/api/checkout/${id}/parcelado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: form.nome, cep: form.cep, endereco: form.endereco, numero: form.numero, complemento: form.complemento, cidade: form.cidade, estado: form.estado }),
      });
      const data = await res.json() as { linkPagamento?: string; erro?: string };
      if (data.erro) throw new Error(data.erro);
      window.location.href = data.linkPagamento!;
    } catch (err: unknown) {
      setErroMensagem((err as Error).message || 'Erro ao gerar link. Tente novamente.');
      setLoading(false);
    }
  }

  async function gerarBoleto() {
    if (form.cpf.replace(/\D/g, '').length < 11) {
      setErroMensagem('Informe seu CPF para gerar o boleto');
      return;
    }
    setLoading(true);
    setErroMensagem('');
    try {
      const res = await fetch(`/api/checkout/${id}/boleto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: form.nome, cpf: form.cpf, cep: form.cep, endereco: form.endereco, numero: form.numero, complemento: form.complemento, cidade: form.cidade, estado: form.estado }),
      });
      const data = await res.json() as { boletoUrl?: string; boletoCodigoBarra?: string; dataVencimento?: string; erro?: string };
      if (data.erro) throw new Error(data.erro);
      setBoletoData({ boletoUrl: data.boletoUrl!, boletoCodigoBarra: data.boletoCodigoBarra!, dataVencimento: data.dataVencimento! });
    } catch (err: unknown) {
      setErroMensagem((err as Error).message || 'Erro ao gerar boleto. Tente novamente.');
    }
    setLoading(false);
  }

  function copiarPix() {
    if (!pixData) return;
    void navigator.clipboard.writeText(pixData.pixCopiaECola);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 3000);
  }

  // Loading inicial
  if (checkoutValido === null) return (
    <div style={s.bg}>
      <div style={{ ...s.card, textAlign: 'center', padding: '60px 20px' }}>
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
        <p style={{ color: '#6B7280' }}>Carregando...</p>
      </div>
    </div>
  );

  // Expirado/inválido
  if (!checkoutValido) return (
    <div style={s.bg}>
      <div style={s.card}>
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ fontSize: '48px' }}>⚠️</div>
          <h2 style={{ color: '#EF4444', margin: '16px 0 8px' }}>Link inválido ou expirado</h2>
          <p style={{ color: '#6B7280', fontSize: '14px' }}>
            Entre em contato pelo WhatsApp para receber um novo link.
          </p>
        </div>
      </div>
    </div>
  );

  // Sucesso
  if (etapa === 'sucesso') return (
    <div style={s.bg}>
      <div style={s.card}>
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ fontSize: '56px' }}>🎉</div>
          <h2 style={{ color: '#10B981', margin: '16px 0 8px', fontSize: '22px' }}>
            Pedido confirmado!
          </h2>
          <p style={{ color: '#374151', fontSize: '15px', lineHeight: 1.6 }}>
            Seu Rastreador GPS 2 em 1 está sendo preparado para envio.
            Você receberá o código de rastreamento pelo WhatsApp em breve.
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <div style={s.bg}>
      <div style={s.card}>

        {/* Header */}
        <div style={s.header}>
          <div style={s.logo}>NEXO BRASIL</div>
          <div style={s.selosRow}>
            <span style={s.selo}>🔒 Compra Segura</span>
            <span style={s.selo}>✅ Mercado Pago</span>
          </div>
        </div>

        {/* Produto */}
        <div style={s.produto}>
          <div style={s.produtoInfo}>
            <div style={s.produtoNome}>Rastreador GPS 2 em 1</div>
            <div style={s.produtoDesc}>Carregador 30W + GPS integrado</div>
            <div style={s.frete}>🚚 Frete Grátis — Todo o Brasil</div>
          </div>
          <div style={s.produtoPreco}>
            <div style={s.precoLabel}>R$</div>
            <div style={s.precoValor}>197</div>
          </div>
        </div>

        {/* Garantia */}
        <div style={s.garantia}>
          🛡️ <strong>Garantia de 48h:</strong> recebeu com problema? Devolvemos R$197 no Pix. Sem perguntas.
        </div>

        {/* Depoimento */}
        <div style={s.depoimento}>
          <div style={s.depoimentoTexto}>
            &quot;Pluguei no carro da minha filha e em 2 minutos já tava vendo ela no mapa. Produto incrível!&quot;
          </div>
          <div style={s.depoimentoAutor}>— Márcia S., São Paulo</div>
        </div>

        {/* Indicador de etapas */}
        <div style={s.etapasRow}>
          <div style={{ ...s.etapaItem, opacity: etapa === 'dados' ? 1 : 0.5 }}>
            <div style={{ ...s.etapaBola, background: etapa !== 'dados' ? '#10B981' : '#F5C400' }}>
              {etapa !== 'dados' ? '✓' : '1'}
            </div>
            <span>Dados</span>
          </div>
          <div style={s.etapaLinha} />
          <div style={{ ...s.etapaItem, opacity: ['pagamento', 'pix', 'boleto', 'sucesso'].includes(etapa) ? 1 : 0.4 }}>
            <div style={{ ...s.etapaBola, background: ['pix', 'boleto', 'sucesso'].includes(etapa) ? '#10B981' : etapa === 'pagamento' ? '#F5C400' : '#D1D5DB' }}>
              {['pix', 'boleto', 'sucesso'].includes(etapa) ? '✓' : '2'}
            </div>
            <span>Pagamento</span>
          </div>
          <div style={s.etapaLinha} />
          <div style={{ ...s.etapaItem, opacity: ['pix', 'boleto', 'sucesso'].includes(etapa) ? 1 : 0.4 }}>
            <div style={{ ...s.etapaBola, background: ['pix', 'boleto'].includes(etapa) ? '#F5C400' : '#D1D5DB' }}>
              3
            </div>
            <span>Confirmar</span>
          </div>
        </div>

        {/* ── ETAPA 1 — DADOS ── */}
        {etapa === 'dados' && (
          <div>
            <h3 style={s.titulo}>Seus dados de entrega</h3>

            <div style={s.campo}>
              <label style={s.label}>Nome completo *</label>
              <input style={s.input} placeholder="João da Silva" value={form.nome}
                onChange={e => atualizarForm('nome', e.target.value)} />
            </div>

            <div style={s.campo}>
              <label style={s.label}>CEP *</label>
              <input style={s.input} placeholder="00000-000" value={form.cep} maxLength={9}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, '').replace(/^(\d{5})(\d)/, '$1-$2');
                  atualizarForm('cep', v);
                }} />
              {buscandoCEP && <span style={{ fontSize: '12px', color: '#6B7280' }}>Buscando endereço...</span>}
            </div>

            <div style={s.campo}>
              <label style={s.label}>Endereço *</label>
              <input style={s.input} placeholder="Rua das Flores" value={form.endereco}
                onChange={e => atualizarForm('endereco', e.target.value)} />
            </div>

            <div style={s.row}>
              <div style={{ ...s.campo, flex: 1 }}>
                <label style={s.label}>Número *</label>
                <input style={s.input} placeholder="123" value={form.numero}
                  onChange={e => atualizarForm('numero', e.target.value)} />
              </div>
              <div style={{ ...s.campo, flex: 2 }}>
                <label style={s.label}>Complemento</label>
                <input style={s.input} placeholder="Apto 45" value={form.complemento}
                  onChange={e => atualizarForm('complemento', e.target.value)} />
              </div>
            </div>

            <div style={s.row}>
              <div style={{ ...s.campo, flex: 2 }}>
                <label style={s.label}>Cidade *</label>
                <input style={s.input} placeholder="São Paulo" value={form.cidade}
                  onChange={e => atualizarForm('cidade', e.target.value)} />
              </div>
              <div style={{ ...s.campo, flex: 1 }}>
                <label style={s.label}>UF *</label>
                <input style={s.input} placeholder="SP" maxLength={2} value={form.estado}
                  onChange={e => atualizarForm('estado', e.target.value.toUpperCase())} />
              </div>
            </div>

            {erroMensagem && <div style={s.erro}>{erroMensagem}</div>}

            <button onClick={avancarParaPagamento} style={s.btnPrincipal}>
              Continuar para pagamento →
            </button>
          </div>
        )}

        {/* ── ETAPA 2 — PAGAMENTO ── */}
        {etapa === 'pagamento' && (
          <div>
            <h3 style={s.titulo}>Como você quer pagar?</h3>

            <div style={s.resumo}>
              <strong>Total: R$ 197,00</strong> — Frete grátis incluído
            </div>

            <button onClick={pagarPix} disabled={loading}
              style={{ ...s.btnOpcao, background: '#00B894' }}>
              <div style={s.btnOpcaoIcon}>💠</div>
              <div>
                <div style={s.btnOpcaoTitulo}>Pagar com Pix</div>
                <div style={s.btnOpcaoSub}>Aprovação imediata · Mais rápido</div>
              </div>
            </button>

            <button onClick={pagarParcelado} disabled={loading}
              style={{ ...s.btnOpcao, background: '#0070BA' }}>
              <div style={s.btnOpcaoIcon}>💳</div>
              <div>
                <div style={s.btnOpcaoTitulo}>Parcelar no cartão</div>
                <div style={s.btnOpcaoSub}>Em até 10x · Visa, Master, Elo</div>
              </div>
            </button>

            <button onClick={() => setEtapa('boleto')}
              style={{ ...s.btnOpcao, background: '#6B7280' }}>
              <div style={s.btnOpcaoIcon}>📄</div>
              <div>
                <div style={s.btnOpcaoTitulo}>Boleto bancário</div>
                <div style={s.btnOpcaoSub}>Vence em 3 dias úteis</div>
              </div>
            </button>

            {erroMensagem && <div style={s.erro}>{erroMensagem}</div>}
            {loading && <div style={s.loading}>Aguarde... gerando pagamento 🔄</div>}

            <button onClick={() => setEtapa('dados')} style={s.btnVoltar}>← Voltar</button>
          </div>
        )}

        {/* ── BOLETO — CPF ── */}
        {etapa === 'boleto' && !boletoData && (
          <div>
            <h3 style={s.titulo}>Gerar boleto</h3>
            <p style={{ color: '#6B7280', fontSize: '14px', marginBottom: '16px' }}>
              Para emitir o boleto precisamos do seu CPF.
            </p>

            <div style={s.campo}>
              <label style={s.label}>CPF *</label>
              <input style={s.input} placeholder="000.000.000-00" value={form.cpf} maxLength={14}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, '')
                    .replace(/(\d{3})(\d)/, '$1.$2')
                    .replace(/(\d{3})(\d)/, '$1.$2')
                    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
                  atualizarForm('cpf', v);
                }} />
            </div>

            {erroMensagem && <div style={s.erro}>{erroMensagem}</div>}

            <button onClick={gerarBoleto} disabled={loading} style={s.btnPrincipal}>
              {loading ? 'Gerando boleto...' : 'Gerar boleto'}
            </button>
            <button onClick={() => setEtapa('pagamento')} style={s.btnVoltar}>← Voltar</button>
          </div>
        )}

        {/* ── BOLETO GERADO ── */}
        {etapa === 'boleto' && boletoData && (
          <div>
            <h3 style={{ ...s.titulo, color: '#10B981' }}>✅ Boleto gerado!</h3>
            <div style={s.garantia}>
              Vencimento: <strong>{boletoData.dataVencimento}</strong>
            </div>
            <button onClick={() => window.open(boletoData.boletoUrl, '_blank')} style={s.btnPrincipal}>
              📄 Abrir boleto para pagar
            </button>
            <div style={s.campo}>
              <label style={s.label}>Código de barras:</label>
              <div style={{ ...s.input, fontSize: '11px', wordBreak: 'break-all', cursor: 'pointer' }}
                onClick={() => void navigator.clipboard.writeText(boletoData.boletoCodigoBarra)}>
                {boletoData.boletoCodigoBarra}
              </div>
              <span style={{ fontSize: '12px', color: '#6B7280' }}>Toque para copiar</span>
            </div>
            <p style={{ fontSize: '13px', color: '#6B7280', textAlign: 'center', marginTop: '16px' }}>
              Após o pagamento, aguarde até 3 dias úteis para compensação.
              Enviaremos o rastreamento pelo WhatsApp.
            </p>
          </div>
        )}

        {/* ── PIX ── */}
        {etapa === 'pix' && pixData && (
          <div>
            <h3 style={{ ...s.titulo, color: '#00B894' }}>💠 Pague com Pix</h3>
            <div style={s.resumo}>
              <strong>R$ 197,00</strong> · Aprovação imediata
            </div>

            {pixData.pixQrCodeBase64 && (
              <div style={{ textAlign: 'center', margin: '20px 0' }}>
                <img
                  src={`data:image/png;base64,${pixData.pixQrCodeBase64}`}
                  alt="QR Code Pix"
                  style={{ width: '200px', height: '200px', borderRadius: '12px', border: '4px solid #00B894' }}
                />
              </div>
            )}

            <p style={{ fontSize: '13px', color: '#6B7280', textAlign: 'center' }}>
              Abra o app do banco → Pix → Ler QR Code
            </p>

            <div style={{ ...s.campo, marginTop: '16px' }}>
              <label style={s.label}>Ou copie o código Pix:</label>
              <div style={{ ...s.input, fontSize: '11px', wordBreak: 'break-all', maxHeight: '80px', overflow: 'hidden' }}>
                {pixData.pixCopiaECola.substring(0, 120)}...
              </div>
            </div>

            <button onClick={copiarPix}
              style={{ ...s.btnPrincipal, background: copiado ? '#10B981' : '#00B894' }}>
              {copiado ? '✅ Código copiado!' : '📋 Copiar código Pix'}
            </button>

            <div style={s.garantia}>⏱️ Este código expira em 30 minutos</div>

            <p style={{ fontSize: '13px', color: '#6B7280', textAlign: 'center', marginTop: '12px' }}>
              Após pagar, a confirmação é automática.
              Você receberá uma mensagem no WhatsApp.
            </p>
          </div>
        )}

        {/* Rodapé */}
        <div style={s.rodape}>
          <div>🔒 Pagamento processado pelo Mercado Pago</div>
          <div>🛡️ Seus dados estão protegidos</div>
          <div>📦 Entrega para todo o Brasil</div>
        </div>

      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  bg: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #1A1A2E 0%, #16213E 100%)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '20px 16px 40px',
    fontFamily: "'Inter', -apple-system, sans-serif",
  },
  card: {
    background: '#FFFFFF',
    borderRadius: '20px',
    padding: '24px 20px',
    maxWidth: '440px',
    width: '100%',
    boxShadow: '0 25px 60px rgba(0,0,0,0.4)',
  },
  header: {
    textAlign: 'center',
    marginBottom: '20px',
    paddingBottom: '16px',
    borderBottom: '1px solid #F3F4F6',
  },
  logo: {
    fontWeight: 900,
    fontSize: '18px',
    letterSpacing: '4px',
    color: '#1A1A2E',
    marginBottom: '8px',
  },
  selosRow: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' },
  selo: {
    fontSize: '11px',
    background: '#F0FDF4',
    color: '#166534',
    padding: '3px 10px',
    borderRadius: '20px',
    border: '1px solid #BBF7D0',
  },
  produto: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: '#F9FAFB',
    borderRadius: '12px',
    padding: '14px 16px',
    marginBottom: '12px',
    border: '1px solid #E5E7EB',
  },
  produtoInfo: { flex: 1 },
  produtoNome: { fontWeight: 700, fontSize: '15px', color: '#111827' },
  produtoDesc: { fontSize: '12px', color: '#6B7280', marginTop: '2px' },
  frete: { fontSize: '12px', color: '#059669', fontWeight: 600, marginTop: '4px' },
  produtoPreco: { display: 'flex', alignItems: 'flex-start', gap: '2px' },
  precoLabel: { fontSize: '14px', fontWeight: 700, color: '#1A1A2E', marginTop: '4px' },
  precoValor: { fontSize: '36px', fontWeight: 900, color: '#1A1A2E', lineHeight: 1 },
  garantia: {
    background: '#FFF7ED',
    border: '1px solid #FED7AA',
    borderRadius: '10px',
    padding: '10px 14px',
    fontSize: '13px',
    color: '#92400E',
    marginBottom: '12px',
    lineHeight: 1.5,
  },
  depoimento: {
    background: '#F0FDF4',
    border: '1px solid #BBF7D0',
    borderRadius: '10px',
    padding: '12px 14px',
    marginBottom: '16px',
  },
  depoimentoTexto: { fontSize: '13px', color: '#166534', fontStyle: 'italic', lineHeight: 1.5 },
  depoimentoAutor: { fontSize: '12px', color: '#6B7280', marginTop: '6px', fontWeight: 600 },
  etapasRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '20px',
    gap: '4px',
  },
  etapaItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    fontSize: '11px',
    color: '#374151',
  },
  etapaBola: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '13px',
    fontWeight: 700,
    color: '#1A1A2E',
  },
  etapaLinha: { flex: 1, height: '2px', background: '#E5E7EB', maxWidth: '40px' },
  titulo: { fontSize: '18px', fontWeight: 700, color: '#111827', marginBottom: '16px' },
  campo: { marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '13px', fontWeight: 600, color: '#374151' },
  input: {
    border: '1.5px solid #E5E7EB',
    borderRadius: '10px',
    padding: '12px 14px',
    fontSize: '15px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    color: '#111827',
    background: '#FAFAFA',
  },
  row: { display: 'flex', gap: '10px' },
  resumo: {
    background: '#F3F4F6',
    borderRadius: '10px',
    padding: '12px 16px',
    fontSize: '15px',
    color: '#111827',
    marginBottom: '16px',
    textAlign: 'center',
  },
  btnOpcao: {
    width: '100%',
    color: 'white',
    border: 'none',
    borderRadius: '14px',
    padding: '16px',
    marginBottom: '10px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    textAlign: 'left',
  },
  btnOpcaoIcon: { fontSize: '24px', flexShrink: 0 },
  btnOpcaoTitulo: { fontSize: '15px', fontWeight: 700 },
  btnOpcaoSub: { fontSize: '12px', opacity: 0.85, marginTop: '2px' },
  btnPrincipal: {
    width: '100%',
    background: '#F5C400',
    color: '#1A1A2E',
    border: 'none',
    borderRadius: '14px',
    padding: '16px',
    fontSize: '16px',
    fontWeight: 800,
    cursor: 'pointer',
    marginBottom: '10px',
    letterSpacing: '0.3px',
  },
  btnVoltar: {
    width: '100%',
    background: 'transparent',
    color: '#6B7280',
    border: '1px solid #E5E7EB',
    borderRadius: '10px',
    padding: '12px',
    fontSize: '14px',
    cursor: 'pointer',
    marginTop: '4px',
  },
  erro: {
    background: '#FEF2F2',
    border: '1px solid #FECACA',
    borderRadius: '8px',
    padding: '10px 14px',
    fontSize: '13px',
    color: '#DC2626',
    marginBottom: '12px',
  },
  loading: {
    textAlign: 'center',
    fontSize: '14px',
    color: '#6B7280',
    padding: '12px',
    marginBottom: '8px',
  },
  rodape: {
    marginTop: '24px',
    paddingTop: '16px',
    borderTop: '1px solid #F3F4F6',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    fontSize: '12px',
    color: '#9CA3AF',
    textAlign: 'center',
  },
};
