"use client";

import { useEffect, useState, useCallback } from "react";
import { useQuery, gql } from "@apollo/client";
import {
  TrendingUp, TrendingDown, Wallet, AlertCircle, RefreshCw, Plus,
  ChevronDown, ChevronUp, CreditCard, RotateCcw, Layers, X, Check,
  User, Building2, DollarSign, Calendar, Receipt,
} from "lucide-react";

// ─── GraphQL ───────────────────────────────────────────────────────────────────

const GET_ORGS = gql`
  query GetOrgsForFinanceiro {
    whatsappBusinessOrganizations { id name status }
  }
`;

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Overview {
  mes: string;
  totalReceitas: number;
  totalDespesas: number;
  saldoMes: number;
  totalPendentes: number;
  totalVencidas: number;
  qtdVencidas: number;
  totalRecorrentes: number;
  totalParcelamentos: number;
  installments: Array<{
    name: string;
    installmentValue: number;
    installmentCount: number;
    paidCount: number;
    remaining: number;
    valorRestante: number;
    competenciaStart: string;
  }>;
  recurring: Array<{ name: string; amount: number; dueDay: number }>;
}

interface Profile {
  id: string;
  name: string;
  personType: string;
}

interface FinancialAccount {
  id: string;
  name: string;
  accountType: string;
  balance: number;
  profileId?: string;
  profile?: { name: string; personType: string };
}

interface Category {
  id: string;
  name: string;
  type: string;
  icon?: string;
  color?: string;
}

interface Transaction {
  id: string;
  type: string;
  amount: number;
  description: string;
  status: string;
  dueDate?: string;
  paidAt?: string;
  createdAt: string;
  profile?: { name: string; personType: string };
  account?: { name: string };
  category?: { name: string; icon?: string; color?: string };
}

interface RecurringBill {
  id: string;
  name: string;
  amount: number;
  dueDay: number;
  profile?: { name: string; personType: string };
  category?: { name: string; icon?: string };
}

interface InstallmentPlan {
  id: string;
  name: string;
  totalAmount: number;
  installmentCount: number;
  installmentValue: number;
  paidCount: number;
  competenciaStart: string;
  profile?: { name: string; personType: string };
  account?: { name: string };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Pill({ type }: { type: string }) {
  const map: Record<string, string> = {
    PESSOA_FISICA: "bg-blue-100 text-blue-700",
    PESSOA_JURIDICA: "bg-purple-100 text-purple-700",
    RECEITA: "bg-emerald-100 text-emerald-700",
    DESPESA: "bg-red-100 text-red-700",
    PAGO: "bg-green-100 text-green-700",
    PENDENTE: "bg-yellow-100 text-yellow-700",
    VENCIDO: "bg-red-100 text-red-700",
    CANCELADO: "bg-gray-100 text-gray-500",
  };
  const label: Record<string, string> = {
    PESSOA_FISICA: "PF",
    PESSOA_JURIDICA: "PJ",
    RECEITA: "Receita",
    DESPESA: "Despesa",
    PAGO: "Pago",
    PENDENTE: "Pendente",
    VENCIDO: "Vencido",
    CANCELADO: "Cancelado",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[type] ?? "bg-gray-100 text-gray-600"}`}>
      {label[type] ?? type}
    </span>
  );
}

// ─── Modal ─────────────────────────────────────────────────────────────────────

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

const TABS = ["Overview", "Lançamentos", "Recorrentes", "Parcelamentos", "Contas"] as const;
type Tab = typeof TABS[number];

export default function FinanceiroPage() {
  const { data: orgsData } = useQuery(GET_ORGS);
  const orgs: Array<{ id: string; name: string }> = orgsData?.whatsappBusinessOrganizations ?? [];

  const [orgId, setOrgId] = useState("");
  const [tab, setTab] = useState<Tab>("Overview");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Data
  const [overview, setOverview] = useState<Overview | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [recurring, setRecurring] = useState<RecurringBill[]>([]);
  const [installments, setInstallments] = useState<InstallmentPlan[]>([]);

  // Modals
  const [showTxModal, setShowTxModal] = useState(false);
  const [showRecModal, setShowRecModal] = useState(false);
  const [showInstModal, setShowInstModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);

  // Forms
  const [txForm, setTxForm] = useState({ type: "DESPESA", amount: "", description: "", status: "PAGO", dueDate: "", profileId: "", accountId: "", categoryId: "", competencia: "" });
  const [recForm, setRecForm] = useState({ name: "", amount: "", dueDay: "", profileId: "", categoryId: "" });
  const [instForm, setInstForm] = useState({ name: "", totalAmount: "", installmentCount: "", installmentValue: "", competenciaStart: "", profileId: "", accountId: "" });
  const [profileForm, setProfileForm] = useState({ name: "", personType: "PESSOA_FISICA", cpfCnpj: "" });
  const [accountForm, setAccountForm] = useState({ name: "", accountType: "CORRENTE", profileId: "", balance: "", dueDay: "", closingDay: "" });

  const showMsg = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3500); };

  // Auto-select first org
  useEffect(() => {
    if (!orgId && orgs.length > 0) setOrgId(orgs[0].id);
  }, [orgs, orgId]);

  const loadAll = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [ov, pr, ac, ca, tx, re, ins] = await Promise.all([
        fetch(`/api/financeiro/overview?organizationId=${orgId}`).then((r) => r.json()),
        fetch(`/api/financeiro/profiles?organizationId=${orgId}`).then((r) => r.json()),
        fetch(`/api/financeiro/accounts?organizationId=${orgId}`).then((r) => r.json()),
        fetch(`/api/financeiro/categories?organizationId=${orgId}`).then((r) => r.json()),
        fetch(`/api/financeiro/transactions?organizationId=${orgId}&limit=50`).then((r) => r.json()),
        fetch(`/api/financeiro/recurring?organizationId=${orgId}`).then((r) => r.json()),
        fetch(`/api/financeiro/installments?organizationId=${orgId}`).then((r) => r.json()),
      ]);
      setOverview(ov);
      setProfiles(Array.isArray(pr) ? pr : []);
      setAccounts(Array.isArray(ac) ? ac : []);
      setCategories(Array.isArray(ca) ? ca : []);
      setTransactions(Array.isArray(tx) ? tx : []);
      setRecurring(Array.isArray(re) ? re : []);
      setInstallments(Array.isArray(ins) ? ins : []);
    } catch {
      showMsg("Erro ao carregar dados financeiros.");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Submit handlers ────────────────────────────────────────────────────────

  async function submitTransaction() {
    const res = await fetch("/api/financeiro/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: orgId,
        type: txForm.type,
        amount: parseFloat(txForm.amount),
        description: txForm.description,
        status: txForm.status,
        dueDate: txForm.dueDate || undefined,
        paidAt: txForm.status === "PAGO" ? new Date().toISOString() : undefined,
        profileId: txForm.profileId || undefined,
        accountId: txForm.accountId || undefined,
        categoryId: txForm.categoryId || undefined,
        competencia: txForm.competencia || undefined,
      }),
    });
    if (res.ok) { showMsg("Lançamento criado!"); setShowTxModal(false); await loadAll(); }
    else showMsg("Erro ao criar lançamento.");
  }

  async function submitRecurring() {
    const res = await fetch("/api/financeiro/recurring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: orgId,
        name: recForm.name,
        amount: parseFloat(recForm.amount),
        dueDay: parseInt(recForm.dueDay),
        profileId: recForm.profileId || undefined,
        categoryId: recForm.categoryId || undefined,
      }),
    });
    if (res.ok) { showMsg("Recorrente criada!"); setShowRecModal(false); await loadAll(); }
    else showMsg("Erro ao criar recorrente.");
  }

  async function submitInstallment() {
    const total = parseFloat(instForm.totalAmount);
    const count = parseInt(instForm.installmentCount);
    const value = instForm.installmentValue ? parseFloat(instForm.installmentValue) : total / count;
    const res = await fetch("/api/financeiro/installments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: orgId,
        name: instForm.name,
        totalAmount: total,
        installmentCount: count,
        installmentValue: value,
        competenciaStart: instForm.competenciaStart,
        profileId: instForm.profileId || undefined,
        accountId: instForm.accountId || undefined,
      }),
    });
    if (res.ok) { showMsg("Parcelamento criado!"); setShowInstModal(false); await loadAll(); }
    else showMsg("Erro ao criar parcelamento.");
  }

  async function submitProfile() {
    const res = await fetch("/api/financeiro/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: orgId, ...profileForm }),
    });
    if (res.ok) { showMsg("Perfil criado!"); setShowProfileModal(false); await loadAll(); }
    else showMsg("Erro ao criar perfil.");
  }

  async function submitAccount() {
    const res = await fetch("/api/financeiro/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: orgId,
        name: accountForm.name,
        accountType: accountForm.accountType,
        profileId: accountForm.profileId || undefined,
        balance: accountForm.balance ? parseFloat(accountForm.balance) : 0,
        dueDay: accountForm.dueDay ? parseInt(accountForm.dueDay) : undefined,
        closingDay: accountForm.closingDay ? parseInt(accountForm.closingDay) : undefined,
      }),
    });
    if (res.ok) { showMsg("Conta criada!"); setShowAccountModal(false); await loadAll(); }
    else showMsg("Erro ao criar conta.");
  }

  async function payInstallment(id: string) {
    const now = new Date();
    const competencia = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const res = await fetch("/api/financeiro/installments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: orgId, action: "pay_installment", id, competencia }),
    });
    if (res.ok) { showMsg("Parcela lançada!"); await loadAll(); }
    else showMsg("Erro ao lançar parcela.");
  }

  async function deleteRecurring(id: string) {
    await fetch(`/api/financeiro/recurring?id=${id}`, { method: "DELETE" });
    showMsg("Recorrente removida.");
    await loadAll();
  }

  // ── Field helpers ──────────────────────────────────────────────────────────

  const input = "w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const select = "w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const label = "block text-sm font-medium text-gray-700 mb-1";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm animate-fade-in">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-white gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Wallet className="text-indigo-600" size={22} />
          <h1 className="font-bold text-lg text-gray-800">Gestão Financeira</h1>
          {overview && (
            <span className="text-xs text-gray-500 hidden sm:inline">{overview.mes}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {orgs.length > 1 && (
            <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className="text-sm border rounded-lg px-2 py-1">
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <button onClick={loadAll} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" title="Atualizar">
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setShowProfileModal(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700"
          >
            <Plus size={14} /> Perfil
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 pt-2 border-b bg-white overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium rounded-t-lg whitespace-nowrap transition-colors ${
              tab === t ? "bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 bg-gray-50">

        {/* ── OVERVIEW ─────────────────────────────────────────────────────── */}
        {tab === "Overview" && overview && (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card icon={<TrendingUp className="text-emerald-500" size={20} />} label="Receitas" value={`R$ ${fmt(overview.totalReceitas)}`} sub="pagas no mês" color="emerald" />
              <Card icon={<TrendingDown className="text-red-500" size={20} />} label="Despesas" value={`R$ ${fmt(overview.totalDespesas)}`} sub="pagas no mês" color="red" />
              <Card
                icon={<Wallet className={overview.saldoMes >= 0 ? "text-indigo-500" : "text-orange-500"} size={20} />}
                label="Saldo do Mês"
                value={`R$ ${fmt(overview.saldoMes)}`}
                sub={overview.saldoMes >= 0 ? "positivo" : "negativo"}
                color={overview.saldoMes >= 0 ? "indigo" : "orange"}
              />
              <Card
                icon={<AlertCircle className="text-amber-500" size={20} />}
                label="Vencidas"
                value={overview.qtdVencidas > 0 ? `R$ ${fmt(overview.totalVencidas)}` : "Nenhuma"}
                sub={overview.qtdVencidas > 0 ? `${overview.qtdVencidas} conta(s)` : "Em dia!"}
                color={overview.qtdVencidas > 0 ? "amber" : "gray"}
              />
            </div>

            {/* Profiles */}
            {profiles.length > 0 && (
              <Section title="Perfis Financeiros" icon={<User size={16} />}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {profiles.map((p) => (
                    <div key={p.id} className="bg-white rounded-lg border p-3 flex items-center gap-3">
                      {p.personType === "PESSOA_JURIDICA" ? <Building2 size={20} className="text-purple-500" /> : <User size={20} className="text-blue-500" />}
                      <div>
                        <p className="font-medium text-sm">{p.name}</p>
                        <Pill type={p.personType} />
                      </div>
                      <div className="ml-auto">
                        <p className="text-xs text-gray-500">{accounts.filter((a) => a.profileId === p.id).length} conta(s)</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Recurring summary */}
            {overview.recurring.length > 0 && (
              <Section title="Recorrentes Mensais" icon={<RotateCcw size={16} />} action={<span className="text-sm font-semibold text-indigo-600">R$ {fmt(overview.totalRecorrentes)}/mês</span>}>
                <div className="space-y-2">
                  {overview.recurring.map((r, i) => (
                    <div key={i} className="flex items-center justify-between bg-white rounded-lg border px-3 py-2">
                      <span className="text-sm">{r.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">dia {r.dueDay}</span>
                        <span className="text-sm font-medium">R$ {fmt(r.amount)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Installments summary */}
            {overview.installments.length > 0 && (
              <Section title="Parcelamentos" icon={<CreditCard size={16} />} action={<span className="text-sm font-semibold text-red-600">R$ {fmt(overview.totalParcelamentos)}/mês</span>}>
                <div className="space-y-2">
                  {overview.installments.map((inst, i) => {
                    const pct = Math.round((inst.paidCount / inst.installmentCount) * 100);
                    return (
                      <div key={i} className="bg-white rounded-lg border p-3">
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-sm font-medium">{inst.name}</span>
                          <span className="text-sm font-semibold">R$ {fmt(inst.installmentValue)}/mês</span>
                        </div>
                        <div className="flex items-center gap-2 mb-1">
                          <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                            <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-gray-500">{inst.paidCount}/{inst.installmentCount}</span>
                        </div>
                        <p className="text-xs text-gray-500">Restante: R$ {fmt(inst.valorRestante)} ({inst.remaining}x)</p>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {/* WhatsApp hint */}
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
              <p className="text-sm font-medium text-indigo-800 mb-1">📱 Agente Financeiro no WhatsApp</p>
              <p className="text-xs text-indigo-600">
                Envie comprovantes de pagamento pelo WhatsApp para lançamento automático.<br />
                Digite <strong>overview financeiro</strong>, <strong>recorrentes</strong> ou <strong>parcelamentos</strong> para consultar.
              </p>
            </div>
          </div>
        )}

        {/* ── LANÇAMENTOS ──────────────────────────────────────────────────── */}
        {tab === "Lançamentos" && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <p className="text-sm text-gray-500">{transactions.length} lançamento(s)</p>
              <button onClick={() => setShowTxModal(true)} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700">
                <Plus size={14} /> Novo Lançamento
              </button>
            </div>
            {transactions.length === 0 ? (
              <Empty label="Nenhum lançamento ainda." hint='Clique em "Novo Lançamento" ou envie um comprovante pelo WhatsApp.' />
            ) : (
              <div className="space-y-2">
                {transactions.map((tx) => (
                  <div key={tx.id} className="bg-white rounded-lg border px-3 py-2 flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${tx.type === "RECEITA" ? "bg-emerald-100" : "bg-red-100"}`}>
                      {tx.type === "RECEITA" ? <TrendingUp size={14} className="text-emerald-600" /> : <TrendingDown size={14} className="text-red-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{tx.description}</p>
                      <div className="flex items-center gap-1 flex-wrap">
                        {tx.category && <span className="text-xs text-gray-500">{tx.category.icon} {tx.category.name}</span>}
                        {tx.profile && <Pill type={tx.profile.personType} />}
                        <Pill type={tx.status} />
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-semibold ${tx.type === "RECEITA" ? "text-emerald-600" : "text-red-600"}`}>
                        {tx.type === "RECEITA" ? "+" : "-"}R$ {fmt(tx.amount)}
                      </p>
                      <p className="text-xs text-gray-400">{new Date(tx.createdAt).toLocaleDateString("pt-BR")}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── RECORRENTES ──────────────────────────────────────────────────── */}
        {tab === "Recorrentes" && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <p className="text-sm text-gray-500">{recurring.length} conta(s) recorrente(s)</p>
              <button onClick={() => setShowRecModal(true)} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700">
                <Plus size={14} /> Nova Recorrente
              </button>
            </div>
            {recurring.length === 0 ? (
              <Empty label="Nenhuma conta recorrente." hint="Cadastre parcela de casa, água, luz, internet, etc." />
            ) : (
              <div className="space-y-2">
                {recurring.map((r) => (
                  <div key={r.id} className="bg-white rounded-lg border px-3 py-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-sm flex-shrink-0">
                      {r.category?.icon ?? "🔄"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{r.name}</p>
                      <div className="flex items-center gap-1 flex-wrap">
                        {r.profile && <Pill type={r.profile.personType} />}
                        {r.category && <span className="text-xs text-gray-500">{r.category.name}</span>}
                        <span className="text-xs text-gray-400">• vence dia {r.dueDay}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-semibold text-amber-700">R$ {fmt(r.amount)}/mês</span>
                      <button onClick={() => deleteRecurring(r.id)} className="text-gray-300 hover:text-red-500 p-1" title="Remover">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex justify-between">
                  <span className="text-sm font-medium text-amber-800">Total mensal</span>
                  <span className="text-sm font-bold text-amber-800">R$ {fmt(recurring.reduce((s, r) => s + r.amount, 0))}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PARCELAMENTOS ─────────────────────────────────────────────────── */}
        {tab === "Parcelamentos" && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <p className="text-sm text-gray-500">{installments.length} parcelamento(s)</p>
              <button onClick={() => setShowInstModal(true)} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700">
                <Plus size={14} /> Novo Parcelamento
              </button>
            </div>
            {installments.length === 0 ? (
              <Empty label="Nenhum parcelamento ativo." hint="Cadastre empréstimos e parcelas de cartão." />
            ) : (
              <div className="space-y-3">
                {installments.map((inst) => {
                  const remaining = inst.installmentCount - inst.paidCount;
                  const pct = Math.round((inst.paidCount / inst.installmentCount) * 100);
                  return (
                    <div key={inst.id} className="bg-white rounded-xl border p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="font-medium text-sm">{inst.name}</p>
                          {inst.profile && <Pill type={inst.profile.personType} />}
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-red-600">R$ {fmt(inst.installmentValue)}/mês</p>
                          <p className="text-xs text-gray-500">{remaining}x restantes</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex-1 bg-gray-100 rounded-full h-2">
                          <div className="bg-indigo-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-gray-500 w-12 text-right">{inst.paidCount}/{inst.installmentCount}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-500">Restante: <strong>R$ {fmt(remaining * inst.installmentValue)}</strong></p>
                        <button
                          onClick={() => payInstallment(inst.id)}
                          disabled={remaining === 0}
                          className="flex items-center gap-1 px-3 py-1 bg-emerald-600 text-white rounded-lg text-xs hover:bg-emerald-700 disabled:opacity-40"
                        >
                          <Check size={12} /> Pagar parcela
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── CONTAS ────────────────────────────────────────────────────────── */}
        {tab === "Contas" && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <p className="text-sm text-gray-500">{accounts.length} conta(s)</p>
              <button onClick={() => setShowAccountModal(true)} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700">
                <Plus size={14} /> Nova Conta
              </button>
            </div>
            {accounts.length === 0 ? (
              <Empty label="Nenhuma conta cadastrada." hint='Clique em "Nova Conta" para cadastrar banco, cartão ou carteira.' />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {accounts.map((acc) => (
                  <div key={acc.id} className="bg-white rounded-xl border p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
                        {acc.accountType === "CARTAO_CREDITO" ? <CreditCard size={16} className="text-indigo-600" /> : <DollarSign size={16} className="text-indigo-600" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{acc.name}</p>
                        <span className="text-xs text-gray-500">{acc.accountType.replace("_", " ")}</span>
                      </div>
                    </div>
                    {acc.profile && <Pill type={acc.profile.personType} />}
                    <p className="text-lg font-bold mt-2 text-gray-800">R$ {fmt(acc.balance)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── MODALS ─────────────────────────────────────────────────────────── */}

      {/* New Transaction */}
      <Modal open={showTxModal} onClose={() => setShowTxModal(false)} title="Novo Lançamento">
        <div className="space-y-3">
          <div>
            <label className={label}>Tipo</label>
            <div className="flex gap-2">
              {["RECEITA", "DESPESA"].map((t) => (
                <button key={t} onClick={() => setTxForm((f) => ({ ...f, type: t }))}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border ${txForm.type === t ? (t === "RECEITA" ? "bg-emerald-600 text-white border-emerald-600" : "bg-red-600 text-white border-red-600") : "border-gray-200 text-gray-600"}`}>
                  {t === "RECEITA" ? "📈 Receita" : "📉 Despesa"}
                </button>
              ))}
            </div>
          </div>
          <div><label className={label}>Descrição *</label><input className={input} value={txForm.description} onChange={(e) => setTxForm((f) => ({ ...f, description: e.target.value }))} placeholder="Ex: Conta de luz" /></div>
          <div><label className={label}>Valor (R$) *</label><input type="number" className={input} value={txForm.amount} onChange={(e) => setTxForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0,00" /></div>
          <div>
            <label className={label}>Status</label>
            <select className={select} value={txForm.status} onChange={(e) => setTxForm((f) => ({ ...f, status: e.target.value }))}>
              <option value="PAGO">Pago</option>
              <option value="PENDENTE">Pendente</option>
            </select>
          </div>
          {txForm.status === "PENDENTE" && (
            <div><label className={label}>Vencimento</label><input type="date" className={input} value={txForm.dueDate} onChange={(e) => setTxForm((f) => ({ ...f, dueDate: e.target.value }))} /></div>
          )}
          <div>
            <label className={label}>Perfil (PF/PJ)</label>
            <select className={select} value={txForm.profileId} onChange={(e) => setTxForm((f) => ({ ...f, profileId: e.target.value }))}>
              <option value="">Sem perfil</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.personType === "PESSOA_FISICA" ? "PF" : "PJ"})</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Conta</label>
            <select className={select} value={txForm.accountId} onChange={(e) => setTxForm((f) => ({ ...f, accountId: e.target.value }))}>
              <option value="">Sem conta</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Categoria</label>
            <select className={select} value={txForm.categoryId} onChange={(e) => setTxForm((f) => ({ ...f, categoryId: e.target.value }))}>
              <option value="">Sem categoria</option>
              {categories.filter((c) => c.type === txForm.type).map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </div>
          <div><label className={label}>Competência (AAAA-MM)</label><input className={input} placeholder="2025-05" value={txForm.competencia} onChange={(e) => setTxForm((f) => ({ ...f, competencia: e.target.value }))} /></div>
          <button onClick={submitTransaction} className="w-full py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700">
            Lançar
          </button>
        </div>
      </Modal>

      {/* New Recurring */}
      <Modal open={showRecModal} onClose={() => setShowRecModal(false)} title="Nova Conta Recorrente">
        <div className="space-y-3">
          <div><label className={label}>Nome *</label><input className={input} value={recForm.name} onChange={(e) => setRecForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex: Conta de Água e Luz" /></div>
          <div><label className={label}>Valor (R$) *</label><input type="number" className={input} value={recForm.amount} onChange={(e) => setRecForm((f) => ({ ...f, amount: e.target.value }))} /></div>
          <div><label className={label}>Dia do vencimento *</label><input type="number" min="1" max="31" className={input} value={recForm.dueDay} onChange={(e) => setRecForm((f) => ({ ...f, dueDay: e.target.value }))} placeholder="15" /></div>
          <div>
            <label className={label}>Perfil (PF/PJ)</label>
            <select className={select} value={recForm.profileId} onChange={(e) => setRecForm((f) => ({ ...f, profileId: e.target.value }))}>
              <option value="">Sem perfil</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.personType === "PESSOA_FISICA" ? "PF" : "PJ"})</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Categoria</label>
            <select className={select} value={recForm.categoryId} onChange={(e) => setRecForm((f) => ({ ...f, categoryId: e.target.value }))}>
              <option value="">Sem categoria</option>
              {categories.filter((c) => c.type === "DESPESA").map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </div>
          <button onClick={submitRecurring} className="w-full py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700">
            Cadastrar Recorrente
          </button>
        </div>
      </Modal>

      {/* New Installment */}
      <Modal open={showInstModal} onClose={() => setShowInstModal(false)} title="Novo Parcelamento">
        <div className="space-y-3">
          <div><label className={label}>Nome *</label><input className={input} value={instForm.name} onChange={(e) => setInstForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex: Empréstimo CEF / Cartão Nubank Fev" /></div>
          <div><label className={label}>Valor total (R$) *</label><input type="number" className={input} value={instForm.totalAmount} onChange={(e) => setInstForm((f) => ({ ...f, totalAmount: e.target.value }))} /></div>
          <div><label className={label}>Quantidade de parcelas *</label><input type="number" className={input} value={instForm.installmentCount} onChange={(e) => setInstForm((f) => ({ ...f, installmentCount: e.target.value }))} placeholder="12" /></div>
          <div><label className={label}>Valor da parcela (R$) — deixe vazio para calcular</label><input type="number" className={input} value={instForm.installmentValue} onChange={(e) => setInstForm((f) => ({ ...f, installmentValue: e.target.value }))} /></div>
          <div><label className={label}>Competência inicial (AAAA-MM) *</label><input className={input} placeholder="2025-01" value={instForm.competenciaStart} onChange={(e) => setInstForm((f) => ({ ...f, competenciaStart: e.target.value }))} /></div>
          <div>
            <label className={label}>Perfil (PF/PJ)</label>
            <select className={select} value={instForm.profileId} onChange={(e) => setInstForm((f) => ({ ...f, profileId: e.target.value }))}>
              <option value="">Sem perfil</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.personType === "PESSOA_FISICA" ? "PF" : "PJ"})</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Conta/Cartão</label>
            <select className={select} value={instForm.accountId} onChange={(e) => setInstForm((f) => ({ ...f, accountId: e.target.value }))}>
              <option value="">Sem conta</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <button onClick={submitInstallment} className="w-full py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700">
            Cadastrar Parcelamento
          </button>
        </div>
      </Modal>

      {/* New Profile */}
      <Modal open={showProfileModal} onClose={() => setShowProfileModal(false)} title="Novo Perfil Financeiro">
        <div className="space-y-3">
          <div>
            <label className={label}>Tipo *</label>
            <div className="flex gap-2">
              {["PESSOA_FISICA", "PESSOA_JURIDICA"].map((t) => (
                <button key={t} onClick={() => setProfileForm((f) => ({ ...f, personType: t }))}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border ${profileForm.personType === t ? "bg-indigo-600 text-white border-indigo-600" : "border-gray-200 text-gray-600"}`}>
                  {t === "PESSOA_FISICA" ? "👤 Pessoa Física" : "🏢 Pessoa Jurídica"}
                </button>
              ))}
            </div>
          </div>
          <div><label className={label}>Nome *</label><input className={input} value={profileForm.name} onChange={(e) => setProfileForm((f) => ({ ...f, name: e.target.value }))} placeholder={profileForm.personType === "PESSOA_FISICA" ? "Seu nome" : "Nome da empresa"} /></div>
          <div><label className={label}>{profileForm.personType === "PESSOA_FISICA" ? "CPF" : "CNPJ"}</label><input className={input} value={profileForm.cpfCnpj} onChange={(e) => setProfileForm((f) => ({ ...f, cpfCnpj: e.target.value }))} /></div>
          <button onClick={submitProfile} className="w-full py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700">
            Criar Perfil
          </button>
        </div>
      </Modal>

      {/* New Account */}
      <Modal open={showAccountModal} onClose={() => setShowAccountModal(false)} title="Nova Conta Financeira">
        <div className="space-y-3">
          <div><label className={label}>Nome *</label><input className={input} value={accountForm.name} onChange={(e) => setAccountForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex: Nubank, Caixa, Carteira" /></div>
          <div>
            <label className={label}>Tipo *</label>
            <select className={select} value={accountForm.accountType} onChange={(e) => setAccountForm((f) => ({ ...f, accountType: e.target.value }))}>
              <option value="CORRENTE">Conta Corrente</option>
              <option value="POUPANCA">Poupança</option>
              <option value="CARTAO_CREDITO">Cartão de Crédito</option>
              <option value="DINHEIRO">Dinheiro / Carteira</option>
              <option value="INVESTIMENTO">Investimento</option>
            </select>
          </div>
          <div><label className={label}>Saldo inicial (R$)</label><input type="number" className={input} value={accountForm.balance} onChange={(e) => setAccountForm((f) => ({ ...f, balance: e.target.value }))} placeholder="0,00" /></div>
          {accountForm.accountType === "CARTAO_CREDITO" && (
            <>
              <div><label className={label}>Dia de fechamento</label><input type="number" min="1" max="31" className={input} value={accountForm.closingDay} onChange={(e) => setAccountForm((f) => ({ ...f, closingDay: e.target.value }))} /></div>
              <div><label className={label}>Dia de vencimento</label><input type="number" min="1" max="31" className={input} value={accountForm.dueDay} onChange={(e) => setAccountForm((f) => ({ ...f, dueDay: e.target.value }))} /></div>
            </>
          )}
          <div>
            <label className={label}>Perfil (PF/PJ)</label>
            <select className={select} value={accountForm.profileId} onChange={(e) => setAccountForm((f) => ({ ...f, profileId: e.target.value }))}>
              <option value="">Sem perfil</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.personType === "PESSOA_FISICA" ? "PF" : "PJ"})</option>)}
            </select>
          </div>
          <button onClick={submitAccount} className="w-full py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700">
            Criar Conta
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Card({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string; sub: string; color: string }) {
  const bg: Record<string, string> = { emerald: "bg-emerald-50", red: "bg-red-50", indigo: "bg-indigo-50", orange: "bg-orange-50", amber: "bg-amber-50", gray: "bg-gray-50" };
  return (
    <div className={`${bg[color] ?? "bg-white"} rounded-xl border p-3`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-lg font-bold text-gray-800 leading-tight">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
    </div>
  );
}

function Section({ title, icon, children, action }: { title: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2 text-gray-700 font-medium text-sm">
          {icon} {title}
        </div>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function Empty({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="text-center py-12 bg-white rounded-xl border">
      <p className="text-gray-500 text-sm font-medium">{label}</p>
      <p className="text-gray-400 text-xs mt-1">{hint}</p>
    </div>
  );
}
