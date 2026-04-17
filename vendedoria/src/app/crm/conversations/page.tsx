"use client";

import React, { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, gql } from "@apollo/client";
import {
  MessageSquare, Search, RefreshCw, Phone, Clock,
  ChevronLeft, ChevronDown, Loader2, Send, Bot, UserCheck,
  AlertTriangle, CheckCheck, Check, Image as ImageIcon,
  Video, ShieldOff, ArrowLeft, MoreVertical, X, MapPin,
  User, SlidersHorizontal, Paperclip, Film, Smile,
} from "lucide-react";
import { ContactPanel } from "@/components/crm/ContactPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// ── GraphQL ───────────────────────────────────────────────────────────────────

const GET_ORGS = gql`
  query GetOrgsConversations {
    whatsappBusinessOrganizations { id name status }
  }
`;

const SEND_MESSAGE = gql`
  mutation SendMessage($conversationId: String!, $content: String!) {
    sendWhatsappMessage(conversationId: $conversationId, content: $content) {
      id content type role sentAt status
    }
  }
`;

const TAKEOVER = gql`
  mutation Takeover($conversationId: String!, $takeover: Boolean!) {
    takeoverConversation(conversationId: $conversationId, takeover: $takeover) {
      id humanTakeover
    }
  }
`;

const DEESCALATE = gql`
  mutation Deescalate($conversationId: String!) {
    deescalateConversation(conversationId: $conversationId) {
      id humanTakeover lead { id status }
    }
  }
`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface LastMessage { content: string; role: string; sentAt: string; type: string }
interface FollowUp { status: string; step: number; nextSendAt: string }
interface Lead { id: string; profileName: string | null; phoneNumber: string; status: string }
interface Conversation {
  id: string;
  customerWhatsappBusinessId: string;
  profileName: string | null;
  lastMessageAt: string | null;
  isActive: boolean;
  humanTakeover: boolean;
  etapa: string;
  localizacaoRecebida: boolean;
  produtoInteresse: string | null;
  localizacaoTexto: string | null;
  nomeRecebedor: string | null;
  horarioEntrega: string | null;
  formaPagamento: string | null;
  lead: Lead | null;
  messages: LastMessage[];
  followUp: FollowUp | null;
}
interface Message {
  id: string; content: string; role: string; sentAt: string; type: string;
  status?: string; mediaUrl?: string | null; caption?: string | null;
}
interface Product {
  id: string; name: string; imageUrl: string | null; imageUrls: string[];
  videoUrl: string | null; price: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  OPEN:      "bg-green-100 text-green-700",
  ESCALATED: "bg-orange-100 text-orange-700",
  BLOCKED:   "bg-red-100 text-red-700",
  CLOSED:    "bg-gray-100 text-gray-600",
};
const STATUS_LABELS: Record<string, string> = {
  OPEN: "Aberto", ESCALATED: "Escalado", BLOCKED: "Bloqueado", CLOSED: "Fechado",
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function getContactName(conv: Conversation): string {
  return conv.lead?.profileName ?? conv.profileName ?? conv.customerWhatsappBusinessId;
}

function getContactInitial(conv: Conversation): string {
  return (getContactName(conv)?.[0] ?? "?").toUpperCase();
}

// Format Brazilian phone for display
function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  // Normalise Brazilian 8-digit format (55 + DDD + 8digits) → 9-digit (55 + DDD + 9 + 8digits)
  // so existing DB records stored before the webhook fix also display correctly
  const norm =
    /^55\d{10}$/.test(d) && /^[6-9]/.test(d.slice(4))
      ? `55${d.slice(2, 4)}9${d.slice(4)}`
      : d;
  const local = norm.startsWith("55") && norm.length > 11 ? norm.slice(2) : norm;
  if (local.length === 11) return `(${local.slice(0,2)}) ${local.slice(2,7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0,2)}) ${local.slice(2,6)}-${local.slice(6)}`;
  return local || raw;
}

const AVATAR_COLORS = [
  "bg-indigo-100 text-indigo-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
  "bg-orange-100 text-orange-700",
];
function avatarColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// ── PortalDropdown — renders floating menus at body level (avoids z-index clipping) ──

function PortalDropdown({
  open,
  anchorRef,
  onClose,
  children,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({ top: rect.top - 4, left: rect.left });
  }, [open, anchorRef]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
      <div
        style={{
          position: "fixed",
          bottom: `calc(100vh - ${pos.top}px)`,
          left: pos.left,
          zIndex: 9999,
          background: "#fff",
          border: "1px solid #E5E7EB",
          borderRadius: "12px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
          padding: "4px 0",
          minWidth: "160px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body
  );
}

// ── LocationCard — Google Maps Static API thumbnail ──────────────────────────

function LocationCard({ lat, lng, endereco }: { lat?: string; lng?: string; endereco?: string }) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "AIzaSyBieVsbis7QSowEGVVp12psG4ugrlk5uSg";
  const mapsUrl = lat && lng ? `https://maps.google.com/?q=${lat},${lng}` : null;
  const staticMapUrl = lat && lng && apiKey
    ? `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=15&size=300x140&scale=2&markers=color:red%7C${lat},${lng}&key=${apiKey}&style=feature:poi%7Cvisibility:off`
    : null;

  const card = (
    <div style={{
      borderRadius: "12px", overflow: "hidden",
      border: "1px solid #E5E7EB", background: "#fff",
      maxWidth: "260px", cursor: mapsUrl ? "pointer" : "default",
    }}>
      {staticMapUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={staticMapUrl} alt="Mapa" style={{ width: "100%", height: "140px", objectFit: "cover", display: "block" }} />
      ) : (
        <div style={{ width: "100%", height: "140px", background: "#E8EAF0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "40px" }}>🗺️</div>
      )}
      <div style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: "8px" }}>
        <MapPin className="w-4 h-4 text-red-500 shrink-0" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: "13px", fontWeight: 600, color: "#111827", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {endereco ?? (lat && lng ? `${parseFloat(lat).toFixed(5)}, ${parseFloat(lng).toFixed(5)}` : "Localização")}
          </p>
          {mapsUrl && <p style={{ fontSize: "12px", color: "#1976D2", margin: 0, marginTop: "2px" }}>Abrir no Google Maps →</p>}
        </div>
      </div>
    </div>
  );

  if (mapsUrl) {
    return <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", display: "block" }}>{card}</a>;
  }
  return card;
}

/** Resolves a media_id into a proxy URL the browser can fetch */
function mediaProxyUrl(mediaUrl: string): string {
  // If it's already a full URL (e.g. Cloudinary outbound image) — use directly
  if (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://")) return mediaUrl;
  // Otherwise it's a WhatsApp media_id — route through our proxy
  return `/api/whatsapp/media/${mediaUrl}`;
}

function MessageContent({ msg }: { msg: Message }) {
  if (msg.type === "IMAGE") {
    if (msg.mediaUrl) {
      const src = mediaProxyUrl(msg.mediaUrl);
      return (
        <span className="flex flex-col gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={msg.caption ?? "Imagem"}
            className="rounded-lg max-w-[260px] max-h-[260px] object-cover cursor-pointer"
            onClick={() => window.open(src, "_blank")}
            onError={(e) => {
              console.warn("[CRM] Falha ao carregar imagem:", src);
              (e.currentTarget as HTMLImageElement).style.display = "none";
              (e.currentTarget.nextSibling as HTMLElement | null)?.removeAttribute("hidden");
            }}
          />
          <span hidden className="flex items-center gap-1.5 italic opacity-60 text-sm">
            <ImageIcon className="w-4 h-4 shrink-0" /> Imagem indisponível
          </span>
          {msg.caption && <span className="text-xs opacity-70">{msg.caption}</span>}
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 italic opacity-80 text-sm">
        <ImageIcon className="w-4 h-4 shrink-0" /> Imagem
      </span>
    );
  }

  if (msg.type === "VIDEO" || (msg.mediaUrl && /\.(mp4|mov|webm|3gpp?)(\?|$)/i.test(msg.mediaUrl))) {
    if (msg.mediaUrl) {
      const src = mediaProxyUrl(msg.mediaUrl);
      return (
        <span className="flex flex-col gap-1">
          <div style={{ maxWidth: "260px", borderRadius: "12px", overflow: "hidden", background: "#000" }}>
            <video controls preload="metadata"
              style={{ width: "100%", display: "block", maxHeight: "200px" }}
              onError={() => console.warn("[CRM] Falha ao carregar vídeo:", src)}
            >
              <source src={src} />
              <a href={src} target="_blank" style={{ color: "#60a5fa", padding: "8px", display: "block" }}>Baixar vídeo</a>
            </video>
          </div>
          {msg.caption && <span className="text-xs opacity-70">{msg.caption}</span>}
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 italic opacity-80 text-sm">
        <Video className="w-4 h-4 shrink-0" /> Vídeo
      </span>
    );
  }

  if (msg.type === "AUDIO" || (msg.mediaUrl && /\.(ogg|mp3|m4a|opus|aac)(\?|$)/i.test(msg.mediaUrl))) {
    if (msg.mediaUrl) {
      const src = mediaProxyUrl(msg.mediaUrl);
      return (
        <span className="flex flex-col gap-1">
          <div style={{
            background: "#F0F0F0", borderRadius: "24px",
            padding: "10px 16px", display: "flex",
            alignItems: "center", gap: "10px", maxWidth: "260px",
          }}>
            <span style={{ fontSize: "20px" }}>🎙️</span>
            <audio controls preload="metadata" style={{ flex: 1, height: "32px" }}
              onError={() => console.warn("[CRM] Falha ao carregar áudio:", src)}>
              <source src={src} />
            </audio>
          </div>
          {/* Show transcript if AI transcribed it */}
          {msg.content && !msg.content.startsWith("[Áudio") && (
            <span className="text-xs italic opacity-70 mt-0.5">{msg.content}</span>
          )}
        </span>
      );
    }
    // No mediaUrl — show transcript or placeholder
    const transcript = msg.content?.replace(/^\[Áudio transcrito\]:\s*/i, "");
    if (transcript && !transcript.startsWith("[Áudio")) {
      return (
        <span className="flex flex-col gap-0.5 text-sm">
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">🎙 Áudio transcrito</span>
          <span className="italic">{transcript}</span>
        </span>
      );
    }
    return <span className="italic opacity-80 text-sm">🎙 Áudio</span>;
  }

  if (msg.type === "DOCUMENT" || (msg.mediaUrl && /\.(pdf|doc|docx|xls|xlsx)(\?|$)/i.test(msg.mediaUrl))) {
    if (msg.mediaUrl) {
      const src = mediaProxyUrl(msg.mediaUrl);
      const filename = msg.caption ?? msg.content ?? "Documento";
      return (
        <a href={src} target="_blank" rel="noopener noreferrer"
          style={{
            display: "flex", alignItems: "center", gap: "8px",
            padding: "10px 14px", background: "#F3F4F6",
            borderRadius: "12px", textDecoration: "none",
            maxWidth: "260px", color: "#111827",
          }}>
          <span style={{ fontSize: "24px" }}>📄</span>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600 }}>{filename}</div>
            <div style={{ fontSize: "12px", color: "#6B7280" }}>Toque para abrir</div>
          </div>
        </a>
      );
    }
    return <span className="text-sm italic opacity-80">📄 Documento</span>;
  }

  if (msg.type === "LOCATION") {
    const text = msg.content ?? "";
    const latMatch = text.match(/lat:([-\d.]+)/);
    const lngMatch = text.match(/lng:([-\d.]+)/);
    const addrMatch = text.match(/endereço:\s*([^|]+)/);
    const pointMatch = text.match(/ponto:\s*(.+)/);
    const lat = latMatch?.[1];
    const lng = lngMatch?.[1];
    const label = pointMatch?.[1]?.trim() ?? addrMatch?.[1]?.trim() ?? "Localização recebida";
    return <LocationCard lat={lat} lng={lng} endereco={label} />;
  }

  // Detect location coordinates or Maps links embedded in TEXT messages
  if (msg.type === "TEXT" || !msg.type) {
    const content = msg.content ?? "";
    const mapsShort = content.match(/maps\.app\.goo\.gl\/\S+|goo\.gl\/maps\/\S+/);
    const latLng1 = content.match(/lat:([-\d.]+)\s+lng:([-\d.]+)/);
    const latLng2 = content.match(/@([-\d.]+),([-\d.]+)/);
    const latLng3 = content.match(/maps\.google\.com\/\?q=([-\d.]+),([-\d.]+)/);

    if (latLng1) return <LocationCard lat={latLng1[1]} lng={latLng1[2]} />;
    if (latLng2) return <LocationCard lat={latLng2[1]} lng={latLng2[2]} />;
    if (latLng3) return <LocationCard lat={latLng3[1]} lng={latLng3[2]} />;
    if (mapsShort) {
      return (
        <a href={mapsShort[0]} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl max-w-[260px] no-underline hover:bg-green-100 transition-colors">
          <span className="text-xl">📍</span>
          <div>
            <p className="text-xs font-semibold text-green-800">Localização recebida</p>
            <p className="text-xs text-blue-600">Abrir no Google Maps</p>
          </div>
        </a>
      );
    }
  }

  return <p className="whitespace-pre-wrap break-words leading-relaxed text-sm">{msg.content}</p>;
}

// ── Avatar Component ─────────────────────────────────────────────────────────

function Avatar({ conv, size = "md" }: { conv: Conversation; size?: "sm" | "md" | "lg" }) {
  const status = conv.lead?.status ?? "OPEN";
  const sizeClass = { sm: "w-8 h-8 text-xs", md: "w-10 h-10 text-sm", lg: "w-12 h-12 text-base" }[size];
  const dotColor = {
    OPEN: "bg-green-500", ESCALATED: "bg-orange-500",
    BLOCKED: "bg-red-500", CLOSED: "bg-gray-400",
  }[status] ?? "bg-gray-400";

  return (
    <div className="relative shrink-0">
      <div className={cn("rounded-full font-semibold flex items-center justify-center", avatarColor(getContactName(conv)), sizeClass)}>
        {getContactInitial(conv)}
      </div>
      <span className={cn("absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white", dotColor)} />
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

function ConversationsContent() {
  const searchParams = useSearchParams();

  const { data: orgsData } = useQuery(GET_ORGS);
  const orgs: Array<{ id: string; name: string }> = orgsData?.whatsappBusinessOrganizations ?? [];

  const [orgId, setOrgId]               = useState("");
  const [search, setSearch]             = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading]           = useState(false);
  const [hasMore, setHasMore]           = useState(false);
  const [nextCursor, setNextCursor]     = useState<string | null>(null);
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages]         = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [msgInput, setMsgInput]         = useState("");
  const [sending, setSending]           = useState(false);
  const [takingOver, setTakingOver]     = useState(false);
  const [deescalating, setDeescalating] = useState(false);
  const [diagResult, setDiagResult]     = useState<Record<string, unknown> | null>(null);
  const [diagLoading, setDiagLoading]   = useState(false);
  const [diagExpanded, setDiagExpanded] = useState(false); // banner colapsado por padrão
  // Mobile: "list" = show conversation list; "chat" = show chat panel
  const [mobilePanel, setMobilePanel]   = useState<"list" | "chat">("list");
  const [showSearch, setShowSearch]     = useState(false);
  const [showContactPanel, setShowContactPanel] = useState(false);
  // Advanced filters
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [produtoFilter, setProdutoFilter] = useState("");
  const [etapaFilter, setEtapaFilter]     = useState("");
  const [tempoFilter, setTempoFilter]     = useState("");
  // BUG 2: rastrear se usuário está no final (state para effects, ref para callbacks async)
  const [atBottom, setAtBottom]         = useState(true);
  // Media sending
  const [products, setProducts]           = useState<Product[]>([]);
  const [mediaDropdown, setMediaDropdown] = useState<string | null>(null); // product id | "__clip" | null
  const [mediaModal, setMediaModal]       = useState<"image" | "video" | null>(null);
  const [sendingMedia, setSendingMedia]   = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const messagesEndRef       = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevLastMsgIdRef     = useRef<string>("");
  const prevMsgCountRef      = useRef(0);
  const currentConvIdRef     = useRef<string | null>(null);
  const isFirstLoadRef       = useRef(false);
  const atBottomRef          = useRef(true);
  const inputRef             = useRef<HTMLTextAreaElement>(null);
  const fileInputRef         = useRef<HTMLInputElement>(null);
  const clipBtnRef           = useRef<HTMLButtonElement>(null);
  const productBtnRefs       = useRef<Map<string, HTMLButtonElement>>(new Map());
  const emojiPickerRef       = useRef<HTMLDivElement>(null);

  const handleContainerScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = dist < 60;
    atBottomRef.current = near;
    setAtBottom(near);
  }, []);

  const [sendMessage]       = useMutation(SEND_MESSAGE);
  const [takeoverMutation]  = useMutation(TAKEOVER);
  const [deescalateMutation] = useMutation(DEESCALATE);

  // Auto-select org
  useEffect(() => {
    if (!orgId && orgs.length > 0) setOrgId(orgs[0].id);
  }, [orgs, orgId]);

  // Fetch products for media toolbar
  useEffect(() => {
    if (!orgId) return;
    fetch(`/api/products?organizationId=${orgId}`)
      .then(r => r.json())
      .then((data: Product[]) => setProducts(data.filter(p => p.imageUrl || p.videoUrl)))
      .catch(() => {});
  }, [orgId]);

  // Open conversation from URL param (?id=xxx)
  useEffect(() => {
    const idParam = searchParams.get("id");
    if (idParam) { setSelectedId(idParam); setMobilePanel("chat"); }
  }, [searchParams]);

  // ── Fetch conversation list ──────────────────────────────────────────────────
  const fetchConversations = useCallback(async (reset = true) => {
    if (!orgId) return;
    if (reset) setLoading(true);
    try {
      const cursor = reset ? "" : (nextCursor ?? "");
      const params = new URLSearchParams({ organizationId: orgId, status: statusFilter });
      if (search) params.set("search", search);
      if (cursor) params.set("cursor", cursor);
      if (produtoFilter) params.set("produto", produtoFilter);
      if (etapaFilter)   params.set("etapa", etapaFilter);
      if (tempoFilter)   params.set("tempo", tempoFilter);
      const res = await fetch(`/api/conversations?${params}`);
      const data = await res.json() as {
        conversations: Conversation[];
        hasMore: boolean;
        nextCursor: string | null;
      };
      setConversations(prev => reset ? data.conversations : [...prev, ...data.conversations]);
      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor);
      // Keep selectedConv in sync with the refreshed list
      const selId = currentConvIdRef.current;
      if (selId) {
        const fresh = data.conversations.find(c => c.id === selId);
        if (fresh) {
          setSelectedConv(fresh);
        } else if (reset) {
          // Conversation not in this batch — fetch individually so the chat header stays visible
          fetch(`/api/conversations?organizationId=${orgId}&id=${selId}`)
            .then(r => r.json())
            .then((d: { conversation: Conversation | null }) => { if (d.conversation) setSelectedConv(d.conversation); })
            .catch(() => {});
        }
      }
    } finally {
      if (reset) setLoading(false);
    }
  }, [orgId, search, statusFilter, produtoFilter, etapaFilter, tempoFilter, nextCursor]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchConversations(true); }, [orgId, search, statusFilter, produtoFilter, etapaFilter, tempoFilter]);

  useEffect(() => {
    const t = setInterval(() => fetchConversations(true), 5000);
    return () => clearInterval(t);
  }, [fetchConversations]);

  // ── Fetch messages ────────────────────────────────────────────────────────────
  const fetchMessages = useCallback(async (convId: string, silent = false) => {
    if (!silent) setLoadingMessages(true);
    try {
      const res = await fetch(`/api/graphql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `query($id: String!) {
            getConversationMessages(conversationId: $id) {
              messages { id content type role sentAt status mediaUrl caption }
            }
          }`,
          variables: { id: convId },
        }),
      });
      const { data } = await res.json() as {
        data?: { getConversationMessages?: { messages?: Message[] } }
      };
      const newMsgs = data?.getConversationMessages?.messages ?? [];
      const newLastId = newMsgs[newMsgs.length - 1]?.id ?? "";
      // Stale-request guard: discard if user switched conversations while fetch was in-flight
      if (convId !== currentConvIdRef.current) return;

      const isFirstLoad = isFirstLoadRef.current;
      const hasNewMessages = newMsgs.length > prevMsgCountRef.current;

      // Skip state update entirely if content is identical (avoids re-render + scroll fight)
      if (!isFirstLoad && newLastId === prevLastMsgIdRef.current && newMsgs.length === prevMsgCountRef.current) {
        return;
      }

      setMessages(newMsgs);
      prevLastMsgIdRef.current = newLastId;
      prevMsgCountRef.current  = newMsgs.length;
      // Scroll é gerenciado pelo useEffect abaixo (inteligente, baseado em atBottom)
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) {
      currentConvIdRef.current = selectedId;
      isFirstLoadRef.current   = true;
      atBottomRef.current      = true;
      setAtBottom(true); // garante estado limpo ao abrir nova conversa
      prevMsgCountRef.current  = 0;
      prevLastMsgIdRef.current = "";
      fetchMessages(selectedId);
    } else {
      currentConvIdRef.current = null;
    }
  }, [selectedId, fetchMessages]);

  useEffect(() => {
    if (!selectedId) return;
    const t = setInterval(() => fetchMessages(selectedId, true), 3000);
    return () => clearInterval(t);
  }, [selectedId, fetchMessages]);

  // ── Scroll inteligente ────────────────────────────────────────────────────────
  // Roda sempre que as mensagens mudam ou o usuário volta ao final.
  // Regras:
  //   • Primeira carga da conversa  → scroll instant (sem animação)
  //   • Nova mensagem + usuário no final → scroll suave
  //   • Usuário rolou para cima → NENHUM scroll automático
  useEffect(() => {
    if (messages.length === 0) return;
    if (isFirstLoadRef.current) {
      // Primeira carga: sempre rola sem animação e marca como carregado
      isFirstLoadRef.current = false;
      requestAnimationFrame(() =>
        messagesEndRef.current?.scrollIntoView({ behavior: "instant" })
      );
    } else if (atBottom) {
      // Novas mensagens e usuário já estava no final: scroll suave
      requestAnimationFrame(() =>
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
      );
    }
    // atBottom=false → usuário rolou para cima → não faz nada
  }, [messages, atBottom]);

  // ── Select conversation ───────────────────────────────────────────────────────
  const selectConversation = useCallback((id: string, conv?: Conversation) => {
    setSelectedId(id);
    if (conv) setSelectedConv(conv);
    setMobilePanel("chat");
  }, []);

  const handleBackToList = useCallback(() => {
    setMobilePanel("list");
    // Keep selectedId so desktop stays selected
  }, []);

  // ── De-escalate ───────────────────────────────────────────────────────────────
  const handleDeescalate = useCallback(async () => {
    if (!selectedId || deescalating) return;
    setDeescalating(true);
    try {
      await deescalateMutation({ variables: { conversationId: selectedId } });
      const patch = (c: Conversation) =>
        c.id === selectedId
          ? { ...c, humanTakeover: false, lead: c.lead ? { ...c.lead, status: "OPEN" } : c.lead }
          : c;
      setConversations(prev => prev.map(patch));
      setSelectedConv(prev => prev ? patch(prev) : prev);
    } finally { setDeescalating(false); }
  }, [selectedId, deescalating, deescalateMutation]);

  // ── Takeover toggle ───────────────────────────────────────────────────────────
  const handleTakeover = useCallback(async (takeover: boolean) => {
    if (!selectedId || takingOver) return;
    setTakingOver(true);
    try {
      await takeoverMutation({ variables: { conversationId: selectedId, takeover } });
      const patch = (c: Conversation) =>
        c.id === selectedId ? { ...c, humanTakeover: takeover } : c;
      setConversations(prev => prev.map(patch));
      setSelectedConv(prev => prev ? patch(prev) : prev);
      if (takeover) setTimeout(() => inputRef.current?.focus(), 100);
    } finally { setTakingOver(false); }
  }, [selectedId, takingOver, takeoverMutation]);

  // ── Send product media ────────────────────────────────────────────────────────
  const handleSendProductMedia = useCallback(async (productId: string, mt: "image" | "video") => {
    if (!selectedId || sendingMedia) return;
    setSendingMedia(true);
    setMediaDropdown(null);
    setMediaModal(null);
    try {
      const res = await fetch(`/api/conversations/${selectedId}/send-media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, mediaType: mt }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        console.error("[send-media]", err.error);
      }
      await fetchMessages(selectedId, true);
    } finally {
      setSendingMedia(false);
    }
  }, [selectedId, sendingMedia, fetchMessages]);

  // ── Upload local file ─────────────────────────────────────────────────────────
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedId || sendingMedia) return;
    e.target.value = "";
    setSendingMedia(true);
    setMediaDropdown(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const isVideo = file.type.startsWith("video/");
      const isPdf   = file.type === "application/pdf";
      form.append("type", isVideo ? "video" : isPdf ? "document" : "image");
      form.append("caption", file.name);
      const res = await fetch(`/api/conversations/${selectedId}/send-media`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        console.error("[send-media file]", err.error);
      }
      await fetchMessages(selectedId, true);
    } finally {
      setSendingMedia(false);
    }
  }, [selectedId, sendingMedia, fetchMessages]);

  // ── Send message ──────────────────────────────────────────────────────────────
  // Close emoji picker on outside click
  useEffect(() => {
    if (!showEmojiPicker) return;
    const handler = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showEmojiPicker]);

  const handleSend = useCallback(async () => {
    const content = msgInput.trim();
    if (!content || !selectedId || sending) return;
    setMsgInput("");
    setSending(true);
    const optimistic: Message = {
      id: `opt-${Date.now()}`, content, role: "ASSISTANT",
      sentAt: new Date().toISOString(), type: "TEXT", status: "SENDING",
    };
    setMessages(prev => [...prev, optimistic]);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    try {
      await sendMessage({ variables: { conversationId: selectedId, content } });
      await fetchMessages(selectedId, true);
    } catch (e) {
      console.error(e);
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      setMsgInput(content);
    } finally { setSending(false); }
  }, [msgInput, selectedId, sending, sendMessage, fetchMessages]);

  const selected       = selectedConv;
  const isHumanControl = selected?.humanTakeover ?? false;
  const isEscalated    = selected?.lead?.status === "ESCALATED";

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <>
    <div className="flex flex-1 min-h-0 overflow-hidden bg-background" style={{ height: "100%" }}>

      {/* ════════════════════════════════════════════════════════════════════════
          LEFT PANEL — Conversation list
          On mobile: full screen, hidden when chat is open
          On desktop: fixed 320px column
      ════════════════════════════════════════════════════════════════════════ */}
      <div className={cn(
        "flex-shrink-0 border-r flex flex-col bg-white",
        // Desktop: always visible at 320px
        "md:w-80 md:flex",
        // Mobile: full width, toggle visibility
        mobilePanel === "list" ? "flex w-full" : "hidden",
      )}>
        {/* Mobile header */}
        <div className="p-3 border-b space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-base">Conversas</h2>
            <div className="flex items-center gap-1">
              {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
              <Button
                variant="ghost" size="icon" className="h-8 w-8"
                onClick={() => setShowSearch(s => !s)}
              >
                {showSearch ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
              </Button>
              <Button
                variant="ghost" size="icon" className="h-8 w-8"
                onClick={() => fetchConversations(true)}
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Search — collapsible on mobile */}
          {showSearch && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Nome, (61) 9044-2728, ou parte do número..."
                className="h-9 pl-8 text-sm"
              />
            </div>
          )}

          {orgs.length > 1 && (
            <Select value={orgId} onValueChange={setOrgId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {orgs.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          {/* Status filter chips */}
          <div className="flex gap-1 flex-wrap">
            {[
              ["all", "Todos"],
              ["hot", "🔥 Quentes"],
              ["open", "Abertos"],
              ["escalated", "Escalados"],
              ["blocked", "Bloqueados"],
              ["closed", "Fechados"],
            ].map(([v, l]) => (
              <button
                key={v}
                onClick={() => setStatusFilter(v)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs border transition-colors",
                  statusFilter === v
                    ? "bg-primary text-white border-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                )}
              >
                {l}
              </button>
            ))}
            <button
              onClick={() => setShowAdvancedFilters(v => !v)}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs border transition-colors flex items-center gap-1",
                (produtoFilter || etapaFilter || tempoFilter)
                  ? "bg-primary text-white border-primary"
                  : showAdvancedFilters
                  ? "border-primary text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              )}
            >
              <SlidersHorizontal className="w-3 h-3" />
              {(produtoFilter || etapaFilter || tempoFilter) ? "Filtrado" : "Filtros"}
            </button>
          </div>

          {/* Advanced filters */}
          {showAdvancedFilters && (
            <div className="space-y-1.5 pt-1">
              <div className="flex gap-1.5">
                <select
                  value={produtoFilter}
                  onChange={e => setProdutoFilter(e.target.value)}
                  className="flex-1 h-8 text-xs rounded-md border border-input bg-background px-2"
                >
                  <option value="">Todos produtos</option>
                  <option value="bomvink">Bomvink</option>
                  <option value="luatek">Luatek</option>
                </select>
                <select
                  value={tempoFilter}
                  onChange={e => setTempoFilter(e.target.value)}
                  className="flex-1 h-8 text-xs rounded-md border border-input bg-background px-2"
                >
                  <option value="">Qualquer tempo</option>
                  <option value="1h">Sem resp. 1h+</option>
                  <option value="3h">Sem resp. 3h+</option>
                  <option value="24h">Sem resp. 24h+</option>
                </select>
              </div>
              <select
                value={etapaFilter}
                onChange={e => setEtapaFilter(e.target.value)}
                className="w-full h-8 text-xs rounded-md border border-input bg-background px-2"
              >
                <option value="">Todas etapas</option>
                <option value="NOVO">Novo</option>
                <option value="PRODUTO_IDENTIFICADO">Produto identificado</option>
                <option value="NEGOCIANDO">Negociando</option>
                <option value="COLETANDO_DADOS">Coletando dados</option>
                <option value="PEDIDO_CONFIRMADO">Pedido confirmado</option>
                <option value="PERDIDO">Perdido</option>
              </select>
              {(produtoFilter || etapaFilter || tempoFilter) && (
                <button
                  onClick={() => { setProdutoFilter(""); setEtapaFilter(""); setTempoFilter(""); }}
                  className="text-xs text-red-500 hover:underline"
                >
                  Limpar filtros avançados
                </button>
              )}
            </div>
          )}
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {conversations.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <MessageSquare className="w-10 h-10 mb-2 opacity-20" />
              <p className="text-sm">Nenhuma conversa</p>
            </div>
          )}

          {conversations.map(conv => {
            const lastMsg    = conv.messages[0];
            const leadStatus = conv.lead?.status ?? "OPEN";
            const isSelected = selectedId === conv.id;

            return (
              <button
                key={conv.id}
                onClick={() => selectConversation(conv.id, conv)}
                className={cn(
                  "w-full text-left px-3 py-3 border-b hover:bg-muted/40 active:bg-muted/60 transition-colors",
                  isSelected && "bg-primary/5 border-l-2 border-l-primary"
                )}
              >
                <div className="flex items-center gap-3">
                  <Avatar conv={conv} size="md" />

                  <div className="flex-1 min-w-0">
                    {/* Name + status */}
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="text-sm font-semibold truncate flex-1">
                        {getContactName(conv)}
                      </p>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {timeAgo(conv.lastMessageAt)}
                      </span>
                    </div>

                    {/* Badges row */}
                    <div className="flex items-center gap-1 mb-0.5">
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0",
                        STATUS_COLORS[leadStatus]
                      )}>
                        {STATUS_LABELS[leadStatus] ?? leadStatus}
                      </span>
                      {conv.humanTakeover && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 shrink-0">
                          👤 Você
                        </span>
                      )}
                      {conv.followUp?.status === "ACTIVE" && (
                        <span className="text-[10px] text-amber-600 flex items-center gap-0.5 shrink-0">
                          <Clock className="w-2.5 h-2.5" />F{conv.followUp.step}
                        </span>
                      )}
                      {conv.localizacaoRecebida && (
                        <span className="text-[10px] text-emerald-700 flex items-center gap-0.5 shrink-0 font-medium">
                          <MapPin className="w-2.5 h-2.5" />Loc
                        </span>
                      )}
                      {(conv.etapa === "PEDIDO_CONFIRMADO") && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700 shrink-0">
                          ✅ Confirmado
                        </span>
                      )}
                    </div>

                    {/* Last message preview */}
                    {lastMsg && (
                      <p className="text-xs text-muted-foreground truncate">
                        {lastMsg.role === "ASSISTANT"
                          ? (conv.humanTakeover ? "👤 " : "🤖 ")
                          : "💬 "}
                        {lastMsg.type === "TEXT"   ? lastMsg.content.slice(0, 60)
                         : lastMsg.type === "IMAGE"    ? "📷 Imagem"
                         : lastMsg.type === "VIDEO"    ? "🎥 Vídeo"
                         : lastMsg.type === "AUDIO"    ? "🎙 Áudio"
                         : lastMsg.type === "DOCUMENT" ? "📄 Documento"
                         : lastMsg.type === "LOCATION" ? "📍 Localização"
                         : `[${lastMsg.type}]`}
                      </p>
                    )}
                  </div>

                  <ChevronLeft className="w-4 h-4 text-muted-foreground rotate-180 shrink-0 md:block hidden" />
                </div>
              </button>
            );
          })}

          {hasMore && (
            <button
              onClick={() => fetchConversations(false)}
              className="w-full py-4 text-xs text-primary hover:underline active:opacity-70"
            >
              Carregar mais conversas
            </button>
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          RIGHT PANEL — Chat
          On mobile: full screen, hidden when list is shown
          On desktop: takes remaining width
      ════════════════════════════════════════════════════════════════════════ */}
      <div className={cn(
        "flex-col overflow-hidden bg-[#f0f2f5]",
        "md:flex md:flex-1",
        mobilePanel === "chat" ? "flex flex-1 w-full" : "hidden",
      )}>
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <MessageSquare className="w-16 h-16 opacity-15" />
            <p className="text-sm font-medium">Selecione uma conversa</p>
            <p className="text-xs opacity-60">Escolha uma conversa na lista para ver o chat</p>
          </div>
        ) : (
          <>
            {/* ── Chat Header ─────────────────────────────────────────────────── */}
            <div className="bg-white border-b px-3 py-2 flex items-center gap-2 flex-shrink-0 shadow-sm">
              {/* Back button — mobile only */}
              <button
                onClick={handleBackToList}
                className="md:hidden p-2 -ml-1 rounded-full hover:bg-muted active:bg-muted/80 transition-colors shrink-0"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>

              {/* Avatar */}
              <Avatar conv={selected} size="sm" />

              {/* Name + phone */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold truncate">
                    {getContactName(selected)}
                  </p>
                  {selected.lead?.status && (
                    <Badge className={cn("text-[10px] shrink-0 hidden sm:inline-flex", STATUS_COLORS[selected.lead.status])}>
                      {STATUS_LABELS[selected.lead.status]}
                    </Badge>
                  )}
                  {selected.localizacaoRecebida && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700 shrink-0 hidden sm:inline-flex items-center gap-0.5">
                      <MapPin className="w-2.5 h-2.5" />Localização
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                  <Phone className="w-3 h-3 shrink-0" />
                  {formatPhone(selected.lead?.phoneNumber ?? selected.customerWhatsappBusinessId)}
                  {selected.followUp?.status === "ACTIVE" && (
                    <span className="hidden sm:inline ml-1 text-amber-600">
                      · Follow-up {selected.followUp.step}
                    </span>
                  )}
                </p>
              </div>

              {/* Controls — compact on mobile, expanded on desktop */}
              <div className="flex items-center gap-1.5 shrink-0">
                {isEscalated ? (
                  <>
                    {/* Mobile: dropdown */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" className="h-8 w-8 md:hidden border-orange-200">
                          <AlertTriangle className="w-4 h-4 text-orange-600" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={handleDeescalate} disabled={deescalating}>
                          <ShieldOff className="w-4 h-4 mr-2 text-emerald-600" />
                          Voltar para IA
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleTakeover(true)} disabled={takingOver}>
                          <UserCheck className="w-4 h-4 mr-2 text-blue-600" />
                          Assumir eu mesmo
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {/* Desktop: full buttons */}
                    <div className="hidden md:flex items-center gap-2">
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-orange-50 border border-orange-200 rounded-lg text-xs text-orange-700 font-medium">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Escalado
                      </div>
                      <Button size="sm" variant="outline" onClick={handleDeescalate} disabled={deescalating}
                        className="h-8 text-xs gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50">
                        {deescalating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldOff className="w-3.5 h-3.5" />}
                        Voltar IA
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleTakeover(true)} disabled={takingOver}
                        className="h-8 text-xs gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50">
                        {takingOver ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
                        Assumir
                      </Button>
                    </div>
                  </>
                ) : isHumanControl ? (
                  <>
                    <Button size="icon" variant="outline" onClick={() => handleTakeover(false)} disabled={takingOver}
                      className="h-8 w-8 md:hidden border-emerald-200 text-emerald-700">
                      {takingOver ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                    </Button>
                    <div className="hidden md:flex items-center gap-2">
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 font-medium">
                        <UserCheck className="w-3.5 h-3.5" />
                        Você no controle
                      </div>
                      <Button size="sm" variant="outline" onClick={() => handleTakeover(false)} disabled={takingOver}
                        className="h-8 text-xs gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50">
                        {takingOver ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
                        Devolver IA
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <Button size="icon" variant="outline" onClick={() => handleTakeover(true)} disabled={takingOver}
                      className="h-8 w-8 md:hidden border-blue-200 text-blue-700">
                      {takingOver ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                    </Button>
                    <div className="hidden md:flex items-center gap-2">
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 font-medium">
                        <Bot className="w-3.5 h-3.5" />
                        IA ativa
                      </div>
                      <Button size="sm" variant="outline" onClick={() => handleTakeover(true)} disabled={takingOver}
                        className="h-8 text-xs gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50">
                        {takingOver ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
                        Tomar controle
                      </Button>
                    </div>
                  </>
                )}

                {/* Contact panel toggle */}
                <Button
                  variant="ghost" size="icon"
                  className={cn("h-8 w-8", showContactPanel && "bg-primary/10 text-primary")}
                  onClick={() => setShowContactPanel(v => !v)}
                  title="Perfil do contato"
                >
                  <User className="w-4 h-4" />
                </Button>

                {/* More options menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => fetchMessages(selectedId!, false)}>
                      <RefreshCw className="w-4 h-4 mr-2" /> Recarregar chat
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={async () => {
                      if (!selectedId) return;
                      setDiagLoading(true);
                      setDiagResult(null);
                      try {
                        const res = await fetch("/api/debug/passagem-diag", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ conversationId: selectedId }),
                        });
                        setDiagResult(await res.json() as Record<string, unknown>);
                      } finally { setDiagLoading(false); }
                    }} disabled={diagLoading}>
                      {diagLoading
                        ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        : <AlertTriangle className="w-4 h-4 mr-2 text-amber-500" />}
                      Diagnóstico passagem
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={async () => {
                      if (!selectedId) return;
                      if (!confirm("Reenviar passagem de bastão para o dono agora?")) return;
                      try {
                        const res = await fetch("/api/debug/reenviar-passagem", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ conversationId: selectedId }),
                        });
                        const data = await res.json() as { ok: boolean; msg?: string; error?: string };
                        alert(data.ok ? `✅ ${data.msg}` : `❌ ${data.error}`);
                      } catch (err) { alert(`Erro: ${err}`); }
                    }}>
                      <Send className="w-4 h-4 mr-2 text-green-500" />
                      Reenviar passagem
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* ── Diagnóstico passagem — colapsado por padrão, max 60px ────────── */}
            {diagResult && (
              <div className="bg-slate-800 text-slate-100 text-[11px] flex-shrink-0">
                {/* Linha compacta — sempre visível, clica para expandir */}
                <div
                  className="flex items-center gap-2 px-3 cursor-pointer select-none"
                  style={{ minHeight: 36, maxHeight: 60 }}
                  onClick={() => setDiagExpanded(e => !e)}
                >
                  <span className={cn(
                    "font-semibold truncate flex-1",
                    (diagResult.dadosCompletos as boolean) ? "text-green-300" : "text-amber-300"
                  )}>
                    {(diagResult.dadosCompletos as boolean)
                      ? "✅ Dados completos"
                      : "⚠️ Dados incompletos"}
                    {Array.isArray(diagResult.camposFaltando) && (diagResult.camposFaltando as string[]).length > 0 && (
                      <span className="text-red-300 ml-1 font-normal">
                        — faltando: {(diagResult.camposFaltando as string[]).join(", ")}
                      </span>
                    )}
                  </span>
                  <ChevronDown className={cn(
                    "w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-150",
                    diagExpanded && "rotate-180"
                  )} />
                  <button
                    onClick={(e) => { e.stopPropagation(); setDiagResult(null); setDiagExpanded(false); }}
                    className="text-slate-400 hover:text-white shrink-0 ml-1 p-0.5 rounded"
                    aria-label="Fechar diagnóstico"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Painel expandido — só aparece ao clicar */}
                {diagExpanded && (
                  <div className="px-3 pb-3 border-t border-slate-700 mt-0">
                    <p className="font-bold mt-2 mb-1.5 text-amber-300">
                      {(diagResult.dadosCompletos as boolean)
                        ? "✅ Dados completos — passagem deveria disparar"
                        : "❌ Dados INCOMPLETOS — passagem bloqueada"}
                    </p>
                    {(diagResult.passagemJaFeita as boolean) && (
                      <p className="text-yellow-300 mb-1">⚠️ passagemJaFeita=true — [PASSAGEM] já foi emitido antes</p>
                    )}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-1">
                      {Object.entries(diagResult.camposDetectados as Record<string, string | null>).map(([k, v]) => (
                        <span key={k}>
                          <span className={v ? "text-green-300" : "text-red-400"}>{v ? "✅" : "❌"}</span>
                          {" "}<span className="text-slate-400">{k}:</span>
                          {" "}<span className="text-white">{v ? v.substring(0, 50) : "não detectado"}</span>
                        </span>
                      ))}
                    </div>
                    {(diagResult.etapa as string) && (
                      <p className="mt-1.5 text-slate-400">etapa DB: <span className="text-white">{diagResult.etapa as string}</span></p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Status banners ───────────────────────────────────────────────── */}
            {isEscalated && (
              <div className="bg-orange-500 text-white text-xs px-3 py-2 flex items-start gap-2 flex-shrink-0">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  <strong>Escalado para humano.</strong>
                  {" "}IA parada.{" "}
                  <span className="opacity-80">Toque no ícone <AlertTriangle className="w-3 h-3 inline" /> acima para retomar ou assumir.</span>
                </span>
              </div>
            )}
            {!isEscalated && isHumanControl && (
              <div className="bg-blue-600 text-white text-xs px-3 py-2 flex items-start gap-2 flex-shrink-0">
                <UserCheck className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  <strong>IA pausada.</strong>
                  {" "}Você está respondendo manualmente.
                </span>
              </div>
            )}

            {/* ── Content area: messages + optional contact panel ──────────────── */}
            <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Chat column */}
            <div className={cn(
              "flex flex-col flex-1 min-w-0",
              showContactPanel ? "hidden md:flex" : "flex"
            )}>
            {/* ── Messages area ────────────────────────────────────────────────── */}
            <div
              ref={messagesContainerRef}
              onScroll={handleContainerScroll}
              className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 space-y-1"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='0.015'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }}
            >
              {loadingMessages && messages.length === 0 && (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              )}

              {messages.map((msg, i) => {
                const isMe   = msg.role === "ASSISTANT";
                const prevMsg = messages[i - 1];
                const showTime = !prevMsg ||
                  (new Date(msg.sentAt).getTime() - new Date(prevMsg.sentAt).getTime()) > 5 * 60 * 1000;

                return (
                  <React.Fragment key={msg.id}>
                    {showTime && (
                      <div className="flex justify-center my-3">
                        <span className="text-[11px] text-muted-foreground bg-white/80 px-3 py-0.5 rounded-full shadow-sm">
                          {new Date(msg.sentAt).toLocaleDateString("pt-BR", {
                            day: "2-digit", month: "short",
                          })} {formatTime(msg.sentAt)}
                        </span>
                      </div>
                    )}
                    <div className={cn("flex", isMe ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "max-w-[80%] sm:max-w-[72%] rounded-2xl px-3.5 py-2 shadow-sm",
                        isMe
                          ? "bg-[#dcf8c6] text-gray-800 rounded-tr-sm"
                          : "bg-white text-gray-800 rounded-tl-sm"
                      )}>
                        <MessageContent msg={msg} />
                        <div className="flex items-center justify-end gap-1 mt-1">
                          <span className="text-[10px] text-gray-400">{formatTime(msg.sentAt)}</span>
                          {isMe && (
                            msg.status === "SENDING"
                              ? <Clock className="w-3 h-3 text-gray-400" />
                              : msg.status === "READ"
                              ? <CheckCheck className="w-3 h-3 text-blue-500" />
                              : <Check className="w-3 h-3 text-gray-400" />
                          )}
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* ── Message input ────────────────────────────────────────────────── */}
            <div className="bg-white border-t flex-shrink-0">
              {/* IA status bar */}
              {!isHumanControl && (
                <div className="px-3 pt-2 pb-0">
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Bot className="w-3 h-3 shrink-0" />
                    IA respondendo automaticamente.
                    <button
                      className="text-blue-600 font-medium underline underline-offset-2 ml-0.5"
                      onClick={() => handleTakeover(true)}
                    >
                      Tomar controle
                    </button>
                    para responder.
                  </p>
                </div>
              )}

              {/* Media toolbar — visible only when human is in control */}
              {isHumanControl && (
                <div
                  className="px-3 pt-2 pb-1.5 flex items-center gap-1.5 border-b overflow-x-auto scrollbar-hide"
                  onClick={() => setMediaDropdown(null)}
                >
                  {/* Quick-send product buttons — Portal dropdown */}
                  {products.map(p => {
                    const btnRef = { current: productBtnRefs.current.get(p.id) ?? null } as React.RefObject<HTMLButtonElement | null>;
                    return (
                      <div key={p.id} className="relative shrink-0">
                        <button
                          ref={(el) => { if (el) productBtnRefs.current.set(p.id, el); }}
                          onClick={() => setMediaDropdown(mediaDropdown === p.id ? null : p.id)}
                          disabled={sendingMedia}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
                        >
                          <ImageIcon className="w-3 h-3 shrink-0" />
                          <span className="truncate max-w-[72px]">{p.name}</span>
                          <ChevronDown className="w-3 h-3 shrink-0" />
                        </button>
                        <PortalDropdown open={mediaDropdown === p.id} anchorRef={btnRef} onClose={() => setMediaDropdown(null)}>
                          {(p.imageUrl || (p.imageUrls && p.imageUrls.length > 0)) && (
                            <button
                              onClick={() => { void handleSendProductMedia(p.id, "image"); setMediaDropdown(null); }}
                              className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted transition-colors"
                            >
                              <ImageIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                              Foto
                            </button>
                          )}
                          {p.videoUrl && (
                            <button
                              onClick={() => { void handleSendProductMedia(p.id, "video"); setMediaDropdown(null); }}
                              className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted transition-colors"
                            >
                              <Film className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                              Vídeo
                            </button>
                          )}
                        </PortalDropdown>
                      </div>
                    );
                  })}

                  {/* Separator */}
                  {products.length > 0 && <span className="w-px h-4 bg-border shrink-0" />}

                  {/* 📎 General attachment — Portal dropdown */}
                  <div className="relative shrink-0">
                    <button
                      ref={clipBtnRef}
                      onClick={() => setMediaDropdown(mediaDropdown === "__clip" ? null : "__clip")}
                      disabled={sendingMedia}
                      title="Anexar mídia"
                      className="flex items-center justify-center w-8 h-8 rounded-full bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
                    >
                      {sendingMedia
                        ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        : <Paperclip className="w-4 h-4 text-muted-foreground" />
                      }
                    </button>
                    <PortalDropdown open={mediaDropdown === "__clip"} anchorRef={clipBtnRef} onClose={() => setMediaDropdown(null)}>
                      <button
                        onClick={() => { setMediaModal("image"); setMediaDropdown(null); }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted transition-colors"
                      >
                        <ImageIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        Foto do produto
                      </button>
                      <button
                        onClick={() => { setMediaModal("video"); setMediaDropdown(null); }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted transition-colors"
                      >
                        <Film className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                        Vídeo do produto
                      </button>
                      <div className="border-t my-1" />
                      <button
                        onClick={() => { fileInputRef.current?.click(); setMediaDropdown(null); }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted transition-colors"
                      >
                        <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        Arquivo do celular
                      </button>
                    </PortalDropdown>
                  </div>

                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp,video/mp4,video/quicktime,application/pdf"
                    className="hidden"
                    onChange={e => void handleFileChange(e)}
                  />
                </div>
              )}

              {/* Text input row */}
              <div className="px-3 py-2 flex gap-2 items-end relative">
                {/* Emoji picker button */}
                <div className="relative shrink-0" ref={emojiPickerRef}>
                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker(v => !v)}
                    className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-muted transition-colors"
                    title="Emojis"
                  >
                    <Smile className="w-5 h-5 text-muted-foreground" />
                  </button>
                  {showEmojiPicker && (
                    <div className="absolute bottom-10 left-0 z-50 bg-white rounded-xl shadow-xl border p-2 w-72">
                      {[
                        { cat: "😊 Expressões", emojis: ["😀","😃","😄","😁","😅","😂","🤣","😊","😇","🥰","😍","🤩","😘","😗","😚","😙","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","😐","😑","😶","😏","😒","🙄","😬","🤥","😔","😪","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","😱","😨","😰","😥","😓","🥴","😵","🤡","😷","🤒","🤕","🤧","😇","🤠","🥳","😎","🤓","🧐"] },
                        { cat: "👋 Gestos", emojis: ["👋","🤚","🖐","✋","🖖","👌","🤌","🤏","✌","🤞","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝","👍","👎","✊","👊","🤛","🤜","👏","🙌","🤲","🤝","🙏","💪","🦾","🫶"] },
                        { cat: "❤️ Símbolos", emojis: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","❤️‍🔥","💔","❣️","💕","💞","💓","💗","💖","💘","💝","🌟","⭐","✨","💫","🔥","🎉","🎊","🏆","💯","✅","❌","⚡","💥","🌈"] },
                        { cat: "🛍️ Comércio", emojis: ["📦","🛒","💳","💰","💵","🏷️","🎁","📋","📱","💬","🔔","🚀","⏰","📍","🗺️","🏠","🚗","🛵","📸","🎥","🛠️","🔧","⚙️","📊","📈","🤝","👑","💎","🌟","🎯","✔️","📞"] },
                      ].map(({ cat, emojis }) => (
                        <div key={cat} className="mb-2">
                          <p className="text-[10px] text-muted-foreground font-medium px-1 mb-1">{cat}</p>
                          <div className="flex flex-wrap gap-0.5">
                            {emojis.map(em => (
                              <button
                                key={em}
                                type="button"
                                className="text-xl hover:bg-muted rounded p-0.5 leading-none"
                                onClick={() => {
                                  setMsgInput(v => v + em);
                                  inputRef.current?.focus();
                                }}
                              >
                                {em}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <Textarea
                  ref={inputRef}
                  value={msgInput}
                  onChange={e => setMsgInput(e.target.value)}
                  placeholder={
                    isHumanControl
                      ? "Digite sua mensagem..."
                      : "Mensagem (tome controle para enviar)"
                  }
                  rows={1}
                  className="min-h-[42px] max-h-32 resize-none text-sm flex-1 leading-snug py-2.5"
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                />
                <Button
                  size="icon"
                  onClick={() => void handleSend()}
                  disabled={sending || !msgInput.trim()}
                  className={cn(
                    "h-11 w-11 shrink-0 transition-colors rounded-full",
                    isHumanControl
                      ? "bg-blue-600 hover:bg-blue-700 text-white"
                      : "bg-primary hover:bg-primary/90"
                  )}
                >
                  {sending
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Send className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground px-3 pb-2">
                Enter · enviar &nbsp;·&nbsp; Shift+Enter · nova linha
              </p>
            </div>
            {/* End chat column */}
            </div>

            {/* Contact panel — mobile: full overlay, desktop: right sidebar */}
            {showContactPanel && selected && (
              <div className={cn(
                "z-30",
                // Mobile: fixed full overlay
                "fixed inset-0 md:static md:inset-auto",
                // Desktop: flex-shrink-0 right sidebar
                "md:flex md:shrink-0"
              )}>
                <ContactPanel
                  conv={selected}
                  onClose={() => setShowContactPanel(false)}
                />
              </div>
            )}
            {/* End content area */}
            </div>
          </>
        )}
      </div>
    </div>

    {/* ── Product media modal ──────────────────────────────────────────────── */}
    {mediaModal && typeof document !== "undefined" && createPortal(
      <div
        className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/60 p-4"
        onClick={() => setMediaModal(null)}
      >
        <div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          {/* Modal header */}
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              {mediaModal === "image"
                ? <><ImageIcon className="w-4 h-4 text-blue-500" /> Selecionar foto</>
                : <><Film className="w-4 h-4 text-purple-500" /> Selecionar vídeo</>}
            </h3>
            <button
              onClick={() => setMediaModal(null)}
              className="p-1 rounded-lg hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Products list */}
          <div className="max-h-96 overflow-y-auto divide-y">
            {products.filter(p => mediaModal === "image"
              ? (p.imageUrl || (p.imageUrls && p.imageUrls.length > 0))
              : p.videoUrl
            ).map(p => {
              const thumb = mediaModal === "image"
                ? (p.imageUrls?.[0] ?? p.imageUrl ?? null)
                : null;
              return (
                <button
                  key={p.id}
                  onClick={() => void handleSendProductMedia(p.id, mediaModal)}
                  disabled={sendingMedia}
                  className="flex items-center gap-3 w-full px-4 py-3 hover:bg-muted/50 active:bg-muted transition-colors disabled:opacity-50 text-left"
                >
                  {/* Thumbnail */}
                  <div className="w-14 h-14 rounded-xl overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                    {mediaModal === "image" && thumb ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={thumb} alt={p.name} className="w-full h-full object-cover" />
                    ) : mediaModal === "video" ? (
                      <Film className="w-6 h-6 text-purple-400" />
                    ) : (
                      <ImageIcon className="w-6 h-6 text-blue-300" />
                    )}
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {mediaModal === "image"
                        ? `${p.imageUrls?.length ?? (p.imageUrl ? 1 : 0)} foto(s)`
                        : "Vídeo disponível"}
                    </p>
                  </div>
                  {sendingMedia
                    ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
                    : <Send className="w-4 h-4 text-primary shrink-0" />
                  }
                </button>
              );
            })}
            {products.filter(p => mediaModal === "image"
              ? (p.imageUrl || (p.imageUrls && p.imageUrls.length > 0))
              : p.videoUrl
            ).length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-20" />
                Nenhum produto com {mediaModal === "image" ? "foto" : "vídeo"} cadastrado
              </div>
            )}
          </div>
        </div>
      </div>,
      document.body
    )}
    </>
  );
}

export default function ConversationsPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-1 items-center justify-center h-full text-muted-foreground">
        <span className="text-sm">Carregando conversas...</span>
      </div>
    }>
      <ConversationsContent />
    </Suspense>
  );
}
