"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, gql } from "@apollo/client";
import {
  Package, Plus, Pencil, Trash2, Loader2, ImageIcon, Video,
  CheckCircle2, XCircle, Upload, X, Images,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const MAX_IMAGES = 8;

// ─── Types ──────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  priceInstallments: number | null;
  installments: number;
  imageUrl: string | null;
  imageUrls: string[];
  videoUrl: string | null;
  category: string | null;
  isActive: boolean;
  createdAt: string;
}

interface FormState {
  name: string;
  description: string;
  price: string;
  priceInstallments: string;
  installments: string;
  imageUrls: string[];
  videoUrl: string;
  category: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  price: "",
  priceInstallments: "",
  installments: "10",
  imageUrls: [],
  videoUrl: "",
  category: "",
  isActive: true,
};

// ─── GraphQL ─────────────────────────────────────────────────────────────────

const GET_ORGS = gql`
  query GetOrgsForProducts {
    whatsappBusinessOrganizations { id name status }
  }
`;

// ─── Image Gallery Component ──────────────────────────────────────────────

function ImageGallery({
  images,
  onAdd,
  onRemove,
  uploading,
}: {
  images: string[];
  onAdd: (url: string) => void;
  onRemove: (idx: number) => void;
  uploading: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const slots = Array.from({ length: MAX_IMAGES });

  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {slots.map((_, idx) => {
          const url = images[idx];
          const isFirst = idx === 0;
          if (url) {
            return (
              <div
                key={idx}
                className="relative aspect-square rounded-lg border overflow-hidden group bg-muted"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Foto ${idx + 1}`}
                  className="w-full h-full object-cover"
                  onError={(e) => { e.currentTarget.src = ""; e.currentTarget.style.display = "none"; }}
                />
                {isFirst && (
                  <span className="absolute top-1 left-1 bg-primary text-white text-[9px] px-1.5 py-0.5 rounded font-medium">
                    Principal
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onRemove(idx)}
                  className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          }

          // Empty slot
          if (idx === images.length) {
            return (
              <button
                key={idx}
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="aspect-square rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
              >
                {uploading && idx === images.length ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    <span className="text-[10px]">Adicionar</span>
                  </>
                )}
              </button>
            );
          }

          // Future empty slots (greyed out)
          return (
            <div
              key={idx}
              className="aspect-square rounded-lg border border-dashed border-muted-foreground/15 bg-muted/30"
            />
          );
        })}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          const remaining = MAX_IMAGES - images.length;
          const toUpload = files.slice(0, remaining);
          for (const file of toUpload) {
            const fd = new FormData();
            fd.append("file", file);
            const res = await fetch("/api/upload", { method: "POST", body: fd });
            if (res.ok) {
              const { url } = await res.json() as { url: string };
              onAdd(url);
            }
          }
          e.target.value = "";
        }}
      />

      <p className="text-xs text-muted-foreground mt-2">
        {images.length}/{MAX_IMAGES} fotos • A 1ª foto é a principal enviada pela IA
      </p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────

export default function ProductsPage() {
  const { data: orgsData, loading: orgsLoading } = useQuery(GET_ORGS);
  const orgs: Array<{ id: string; name: string; status: string }> =
    orgsData?.whatsappBusinessOrganizations ?? [];

  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedOrgId && orgs.length > 0) setSelectedOrgId(orgs[0].id);
  }, [orgs, selectedOrgId]);

  const loadProducts = useCallback(async () => {
    if (!selectedOrgId) return;
    setLoadingProducts(true);
    try {
      const res = await fetch(`/api/products?organizationId=${selectedOrgId}`);
      setProducts(await res.json());
    } catch {
      setFeedback({ type: "err", msg: "Erro ao carregar produtos." });
    } finally {
      setLoadingProducts(false);
    }
  }, [selectedOrgId]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  function openNew() {
    setEditingProduct(null);
    setForm(EMPTY_FORM);
    setFeedback(null);
    setDialogOpen(true);
  }

  function openEdit(p: Product) {
    setEditingProduct(p);
    // Merge imageUrl into imageUrls for backward compat
    const imgs = p.imageUrls?.length
      ? p.imageUrls
      : p.imageUrl
      ? [p.imageUrl]
      : [];
    setForm({
      name: p.name,
      description: p.description ?? "",
      price: String(p.price),
      priceInstallments: p.priceInstallments != null ? String(p.priceInstallments) : "",
      installments: String(p.installments),
      imageUrls: imgs,
      videoUrl: p.videoUrl ?? "",
      category: p.category ?? "",
      isActive: p.isActive,
    });
    setFeedback(null);
    setDialogOpen(true);
  }

  const addImage = (url: string) => {
    setForm((prev) => ({
      ...prev,
      imageUrls: [...prev.imageUrls, url].slice(0, MAX_IMAGES),
    }));
  };

  const removeImage = (idx: number) => {
    setForm((prev) => ({
      ...prev,
      imageUrls: prev.imageUrls.filter((_, i) => i !== idx),
    }));
  };

  async function handleSave() {
    if (!form.name || !form.price) {
      setFeedback({ type: "err", msg: "Nome e preço são obrigatórios." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const payload = {
        name: form.name,
        description: form.description || null,
        price: parseFloat(form.price),
        priceInstallments: form.priceInstallments ? parseFloat(form.priceInstallments) : null,
        installments: parseInt(form.installments) || 10,
        imageUrls: form.imageUrls,
        imageUrl: form.imageUrls[0] ?? null,
        videoUrl: form.videoUrl || null,
        category: form.category || null,
        isActive: form.isActive,
      };

      if (editingProduct) {
        await fetch(`/api/products/${editingProduct.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        setFeedback({ type: "ok", msg: "Produto atualizado!" });
      } else {
        await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, organizationId: selectedOrgId }),
        });
        setFeedback({ type: "ok", msg: "Produto criado!" });
      }

      setDialogOpen(false);
      await loadProducts();
    } catch {
      setFeedback({ type: "err", msg: "Erro ao salvar produto." });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Excluir este produto?")) return;
    setDeletingId(id);
    try {
      await fetch(`/api/products/${id}`, { method: "DELETE" });
      setProducts((prev) => prev.filter((p) => p.id !== id));
      setFeedback({ type: "ok", msg: "Produto excluído." });
    } catch {
      setFeedback({ type: "err", msg: "Erro ao excluir produto." });
    } finally {
      setDeletingId(null);
    }
  }

  async function toggleActive(product: Product) {
    await fetch(`/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !product.isActive }),
    });
    await loadProducts();
  }

  const uploadVideoFile = async (file: File) => {
    setUploadingVideo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) { const e = await res.json() as { error?: string }; setFeedback({ type: "err", msg: e.error ?? "Falha no upload de vídeo." }); return; }
      const { url } = await res.json() as { url: string };
      setForm((prev) => ({ ...prev, videoUrl: url }));
      setFeedback({ type: "ok", msg: "Vídeo enviado!" });
    } catch { setFeedback({ type: "err", msg: "Erro no upload." }); }
    finally { setUploadingVideo(false); }
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Package className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold truncate">Catálogo de Produtos</h1>
            <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block">
              Gerencie os produtos que o agente IA usa para atender clientes
            </p>
          </div>
        </div>
        <Button onClick={openNew} disabled={!selectedOrgId} size="sm" className="flex-shrink-0">
          <Plus className="w-4 h-4 sm:mr-2" />
          <span className="hidden sm:inline">Novo Produto</span>
        </Button>
      </div>

      {/* Feedback */}
      {feedback && (
        <div className={cn(
          "flex items-center gap-2 px-4 py-3 rounded-lg text-sm mb-4",
          feedback.type === "ok" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
        )}>
          {feedback.type === "ok" ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
          {feedback.msg}
        </div>
      )}

      {/* Org selector */}
      {orgs.length > 1 && (
        <div className="mb-6">
          <Label>Organização</Label>
          <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
            <SelectTrigger className="w-full sm:w-64 mt-1">
              <SelectValue placeholder="Selecionar organização" />
            </SelectTrigger>
            <SelectContent>
              {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Product list */}
      {orgsLoading || loadingProducts ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando...
        </div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Package className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-sm">Nenhum produto cadastrado.</p>
          <p className="text-xs mt-1">Clique em "Novo Produto" para começar.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {products.map((product) => {
            const imgs = product.imageUrls?.length ? product.imageUrls : product.imageUrl ? [product.imageUrl] : [];
            return (
              <Card key={product.id} className={cn("relative transition-opacity", !product.isActive && "opacity-60")}>
                {/* Thumbnail strip */}
                {imgs.length > 0 && (
                  <div className="flex gap-1 p-3 pb-0">
                    {imgs.slice(0, 4).map((url, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={url}
                        alt=""
                        className={cn("rounded object-cover", i === 0 ? "h-20 w-24 flex-shrink-0" : "h-20 w-16 flex-shrink-0")}
                        onError={(e) => (e.currentTarget.style.display = "none")}
                      />
                    ))}
                    {imgs.length > 4 && (
                      <div className="h-20 w-16 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground font-medium flex-shrink-0">
                        +{imgs.length - 4}
                      </div>
                    )}
                  </div>
                )}

                <CardHeader className="pb-2 pt-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base truncate">{product.name}</CardTitle>
                      {product.category && <Badge variant="secondary" className="mt-1 text-xs">{product.category}</Badge>}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Switch checked={product.isActive} onCheckedChange={() => toggleActive(product)} title={product.isActive ? "Desativar" : "Ativar"} />
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(product)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(product.id)} disabled={deletingId === product.id}>
                        {deletingId === product.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-2">
                  {product.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{product.description}</p>
                  )}
                  <div className="flex items-center gap-3 text-sm font-medium">
                    <span className="text-primary">R$ {product.price.toFixed(2).replace(".", ",")}</span>
                    {product.priceInstallments && (
                      <span className="text-muted-foreground text-xs">
                        ou {product.installments}x de R$ {product.priceInstallments.toFixed(2).replace(".", ",")}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {imgs.length > 0 && (
                      <span className="flex items-center gap-1 text-green-600">
                        <Images className="w-3 h-3" />
                        {imgs.length} foto{imgs.length > 1 ? "s" : ""}
                      </span>
                    )}
                    {product.videoUrl && (
                      <span className="flex items-center gap-1 text-blue-600">
                        <Video className="w-3 h-3" /> Vídeo
                      </span>
                    )}
                    {!product.isActive && <Badge variant="outline" className="text-xs py-0">Inativo</Badge>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg w-[95vw] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingProduct ? "Editar Produto" : "Novo Produto"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Name */}
            <div>
              <Label htmlFor="p-name">Nome *</Label>
              <Input id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: BOMVINK 21V" className="mt-1" />
            </div>

            {/* Description */}
            <div>
              <Label htmlFor="p-desc">Descrição</Label>
              <Textarea id="p-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Motor Brushless, 2 baterias, torque 210–320Nm, maleta, LED…" rows={3} className="mt-1" />
            </div>

            {/* Category */}
            <div>
              <Label htmlFor="p-category">Categoria</Label>
              <Input id="p-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Ex: Ferramentas, Elétricos, Acessórios…" className="mt-1" />
            </div>

            {/* Price */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="p-price">Preço à vista (R$) *</Label>
                <Input id="p-price" type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="549.99" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="p-inst">Parcelas</Label>
                <Input id="p-inst" type="number" min="1" max="48" value={form.installments} onChange={(e) => setForm({ ...form, installments: e.target.value })} className="mt-1" />
              </div>
            </div>

            <div>
              <Label htmlFor="p-price-inst">Valor por parcela (R$)</Label>
              <Input id="p-price-inst" type="number" step="0.01" value={form.priceInstallments} onChange={(e) => setForm({ ...form, priceInstallments: e.target.value })} placeholder="61.74" className="mt-1" />
            </div>

            {/* Multi-image gallery */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Fotos do Produto (até {MAX_IMAGES})</Label>
                {form.imageUrls.length > 0 && (
                  <span className="text-xs text-muted-foreground">{form.imageUrls.length}/{MAX_IMAGES}</span>
                )}
              </div>
              <ImageGallery
                images={form.imageUrls}
                onAdd={addImage}
                onRemove={removeImage}
                uploading={uploadingImg}
              />
            </div>

            {/* Video upload */}
            <div>
              <Label>Vídeo do Produto</Label>
              <div className="mt-1 flex gap-2">
                <Input
                  value={form.videoUrl}
                  onChange={(e) => setForm({ ...form, videoUrl: e.target.value })}
                  placeholder="Cole uma URL ou faça upload →"
                  className="flex-1 text-sm"
                />
                <Button type="button" variant="outline" size="sm" className="flex-shrink-0 gap-1.5" onClick={() => videoInputRef.current?.click()} disabled={uploadingVideo}>
                  {uploadingVideo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  Upload
                </Button>
                <input ref={videoInputRef} type="file" accept="video/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadVideoFile(f); e.target.value = ""; }} />
              </div>
              {form.videoUrl && (
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-xs text-muted-foreground truncate flex-1">✓ {form.videoUrl.length > 60 ? "Vídeo carregado" : form.videoUrl.split("/").pop()}</p>
                  <button type="button" onClick={() => setForm((p) => ({ ...p, videoUrl: "" }))} className="text-muted-foreground hover:text-destructive">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Active */}
            <div className="flex items-center gap-3">
              <Switch id="p-active" checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
              <Label htmlFor="p-active">Produto ativo (visível para o agente IA)</Label>
            </div>

            {/* Inline feedback */}
            {feedback && (
              <div className={cn("flex items-center gap-2 px-3 py-2 rounded text-sm", feedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700")}>
                {feedback.msg}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingProduct ? "Salvar Alterações" : "Criar Produto"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
