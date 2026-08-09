/**
 * 家庭药箱：列表 / 搜索 / 标签 / CRUD / OCR
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  Package,
  Plus,
  ScanText,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { api } from "@/lib/api";
import type { HealthMedicine, HealthMedicineTag, MedicineOcrStructured } from "@/types";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { BottomSheet } from "@/components/common/BottomSheet";
import { AppModal } from "@/components/common/AppModal";
import {
  EmptyState,
  EmptyActionButton,
  LoadingBlock,
  ErrorBanner,
} from "@/components/common/FeedbackStates";
import { Button } from "@/components/ui/button";
import { fieldControlClass } from "@/components/ui/field";
import {
  HEALTH_MED_PREFILL_KEY,
  expiryBadgeClass,
  expiryCardBorderClass,
} from "@/lib/healthUi";
import { useMediaQuery } from "@/hooks/useMediaQuery";

const CATEGORY_LABEL: Record<string, string> = {
  western: "西药",
  tcm_patent: "中成药",
  tcm_herb: "中药饮片/颗粒",
  topical: "外用",
  supplement: "保健/营养",
  other: "其他",
};

type ExpiryFilter = "all" | "soon" | "expired" | "ok";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function expiryStatus(expiryDate: string | null | undefined): "ok" | "soon" | "expired" | "none" {
  if (!expiryDate) return "none";
  const today = todayISO();
  if (expiryDate < today) return "expired";
  const d = new Date(today + "T00:00:00");
  d.setDate(d.getDate() + 30);
  const soon = d.toISOString().slice(0, 10);
  if (expiryDate <= soon) return "soon";
  return "ok";
}

function emptyMedForm() {
  return {
    name: "",
    brand: "",
    category: "western",
    spec: "",
    usageText: "",
    efficacy: "",
    form: "",
    unit: "片",
    quantityRemain: "",
    expiryDate: "",
    location: "",
    notes: "",
    tagInput: "",
  };
}

export default function MedicineCabinet({ workspaceId }: { workspaceId: string }) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [list, setList] = useState<HealthMedicine[]>([]);
  const [tags, setTags] = useState<HealthMedicineTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [expiry, setExpiry] = useState<ExpiryFilter>("all");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyMedForm());
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<HealthMedicine | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [showOcr, setShowOcr] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrApplying, setOcrApplying] = useState(false);
  const [ocrStructured, setOcrStructured] = useState<MedicineOcrStructured | null>(null);
  /** 已上传的附件 id（多图） */
  const [ocrAttachmentIds, setOcrAttachmentIds] = useState<string[]>([]);
  /** 本地预览 URL（object URL） */
  const [ocrPreviews, setOcrPreviews] = useState<string[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const [meds, tlist] = await Promise.all([
        api.health.listMedicines({
          workspaceId,
          q: qDebounced || undefined,
          tag: tagFilter || undefined,
          expiry: expiry === "all" ? undefined : expiry,
        }),
        api.health.listMedicineTags(workspaceId),
      ]);
      setList(meds);
      setTags(tlist);
    } catch (e: any) {
      setError(e?.message || "加载药箱失败");
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, qDebounced, tagFilter, expiry]);

  useEffect(() => {
    load();
  }, [load]);

  /** 从病历处方跳转预填 */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(HEALTH_MED_PREFILL_KEY);
      if (!raw) return;
      sessionStorage.removeItem(HEALTH_MED_PREFILL_KEY);
      const data = JSON.parse(raw) as {
        name?: string;
        usageText?: string;
        notes?: string;
        category?: string;
      };
      setEditingId(null);
      setForm({
        ...emptyMedForm(),
        name: data.name || "",
        usageText: data.usageText || "",
        notes: data.notes || "",
        category: data.category || "western",
      });
      setShowForm(true);
    } catch {
      /* ignore */
    }
  }, [workspaceId]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyMedForm());
    setShowForm(true);
  };

  const openEdit = (m: HealthMedicine) => {
    setEditingId(m.id);
    setForm({
      name: m.name || "",
      brand: m.brand || "",
      category: m.category || "western",
      spec: m.spec || "",
      usageText: m.usageText || "",
      efficacy: m.efficacy || "",
      form: m.form || "",
      unit: m.unit || "片",
      quantityRemain: m.quantityRemain != null ? String(m.quantityRemain) : "",
      expiryDate: m.expiryDate || "",
      location: m.location || "",
      notes: m.notes || "",
      tagInput: (m.tags || []).map((t) => t.name).join("，"),
    });
    setDetailOpen(false);
    setShowForm(true);
  };

  const parseTags = (s: string) =>
    s
      .split(/[,，、\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("请填写药品名称");
      return;
    }
    setSaving(true);
    const payload = {
      workspaceId,
      name: form.name.trim(),
      brand: form.brand || null,
      category: form.category,
      spec: form.spec || null,
      usageText: form.usageText || null,
      efficacy: form.efficacy || null,
      form: form.form || null,
      unit: form.unit || null,
      quantityRemain:
        form.quantityRemain.trim() === ""
          ? null
          : Number(form.quantityRemain),
      expiryDate: form.expiryDate || null,
      location: form.location || null,
      notes: form.notes || null,
      tagNames: parseTags(form.tagInput),
    };
    try {
      if (editingId) {
        await api.health.updateMedicine(editingId, payload);
        toast.success("已更新");
      } else {
        await api.health.createMedicine(payload);
        toast.success("已添加药品");
      }
      setShowForm(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (id: string) => {
    setDetailOpen(true);
    try {
      const d = await api.health.getMedicine(id);
      setDetail(d);
    } catch (e: any) {
      toast.error(e?.message || "加载失败");
      setDetailOpen(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("确定从药箱删除该药品？")) return;
    try {
      await api.health.deleteMedicine(id);
      toast.success("已删除");
      setDetailOpen(false);
      setDetail(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "删除失败");
    }
  };

  const resetOcrSession = () => {
    ocrPreviews.forEach((u) => URL.revokeObjectURL(u));
    setOcrPreviews([]);
    setOcrAttachmentIds([]);
    setOcrStructured(null);
  };

  const closeOcrSheet = () => {
    if (ocrBusy) return;
    resetOcrSession();
    setShowOcr(false);
  };

  /** 追加多张药盒照片（不立刻识别，可继续加拍） */
  const addOcrFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!arr.length) {
      toast.error("请选择图片文件");
      return;
    }
    const remaining = Math.max(0, 6 - ocrAttachmentIds.length);
    if (remaining <= 0) {
      toast.warning("最多 6 张照片");
      return;
    }
    const slice = arr.slice(0, remaining);
    setOcrBusy(true);
    try {
      const newIds: string[] = [];
      const newPreviews: string[] = [];
      for (const file of slice) {
        const att = await api.health.uploadMedicineAttachment({
          file,
          workspaceId,
          kind: "drug_box",
        });
        newIds.push(att.id);
        newPreviews.push(URL.createObjectURL(file));
      }
      setOcrAttachmentIds((prev) => [...prev, ...newIds]);
      setOcrPreviews((prev) => [...prev, ...newPreviews]);
      // 新增照片后清空旧识别结果，需重新点「开始识别」
      setOcrStructured(null);
      toast.success(
        `已添加 ${slice.length} 张（共 ${ocrAttachmentIds.length + slice.length} 张）`,
      );
    } catch (e: any) {
      toast.error(e?.message || "上传失败");
    } finally {
      setOcrBusy(false);
    }
  };

  const removeOcrImage = (index: number) => {
    setOcrAttachmentIds((prev) => prev.filter((_, i) => i !== index));
    setOcrPreviews((prev) => {
      const url = prev[index];
      if (url) URL.revokeObjectURL(url);
      return prev.filter((_, i) => i !== index);
    });
    setOcrStructured(null);
  };

  const runMultiOcr = async () => {
    if (!ocrAttachmentIds.length) {
      toast.error("请先添加至少一张药盒照片");
      return;
    }
    setOcrBusy(true);
    setOcrStructured(null);
    try {
      toast.success(
        ocrAttachmentIds.length > 1
          ? `正在综合 ${ocrAttachmentIds.length} 张照片识别…`
          : "正在识别…",
      );
      const r =
        ocrAttachmentIds.length === 1
          ? await api.health.runMedicineOcr(ocrAttachmentIds[0])
          : await api.health.runMedicineOcrBatch(ocrAttachmentIds);
      if (r.attachmentIds?.length) {
        setOcrAttachmentIds(r.attachmentIds);
      }
      setOcrStructured(r.structured);
      toast.success("识别完成，请核对字段");
    } catch (e: any) {
      toast.error(e?.message || "OCR 失败");
    } finally {
      setOcrBusy(false);
    }
  };

  const applyOcr = async () => {
    if (!ocrStructured) return;
    setOcrApplying(true);
    try {
      const med = await api.health.applyMedicineOcr({
        workspaceId,
        structured: ocrStructured,
        attachmentIds: ocrAttachmentIds,
        attachmentId: ocrAttachmentIds[0],
        tagNames: ocrStructured.suggestedTags,
      });
      toast.success("已写入药箱");
      resetOcrSession();
      setShowOcr(false);
      await load();
      openDetail(med.id);
    } catch (e: any) {
      toast.error(e?.message || "写入失败");
    } finally {
      setOcrApplying(false);
    }
  };

  const stats = useMemo(() => {
    let expired = 0;
    let soon = 0;
    for (const m of list) {
      const s = expiryStatus(m.expiryDate);
      if (s === "expired") expired++;
      if (s === "soon") soon++;
    }
    return { expired, soon };
  }, [list]);

  return (
    <div className="flex flex-col gap-3 pb-8">
      {(stats.expired > 0 || stats.soon > 0) && (
        <div
          className={cn(
            "rounded-card border px-3 py-2.5 text-xs flex items-start gap-2",
            stats.expired > 0
              ? "border-accent-danger/40 bg-accent-danger/8 text-accent-danger"
              : "border-accent-warning/40 bg-accent-warning/8 text-accent-warning",
          )}
          role="status"
        >
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <div className="min-w-0 leading-relaxed">
            {stats.expired > 0 && (
              <span>
                <strong>{stats.expired}</strong> 种已过期
                {stats.soon > 0 ? "，" : "。"}
              </span>
            )}
            {stats.soon > 0 && (
              <span>
                <strong>{stats.soon}</strong> 种 30 天内将过期。
              </span>
            )}
            <span className="text-tx-tertiary"> 请及时清理或更换，勿服用过期药。</span>
            <div className="flex flex-wrap gap-2 mt-2">
              {stats.expired > 0 && (
                <button
                  type="button"
                  className="min-h-9 px-2.5 rounded-button bg-app-surface border border-app-border text-tx-secondary text-[11px]"
                  onClick={() => setExpiry("expired")}
                >
                  查看已过期
                </button>
              )}
              {stats.soon > 0 && (
                <button
                  type="button"
                  className="min-h-9 px-2.5 rounded-button bg-app-surface border border-app-border text-tx-secondary text-[11px]"
                  onClick={() => setExpiry("soon")}
                >
                  查看将过期
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[160px]">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-tx-tertiary pointer-events-none"
          />
          <input
            className={cn(fieldControlClass, "pl-9 w-full")}
            placeholder="搜索名称 / 规格 / 标签"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button size="sm" className="min-h-11" onClick={openCreate}>
          <Plus size={16} className="mr-1" />
          添加
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="min-h-11"
          onClick={() => setShowOcr(true)}
        >
          <ScanText size={16} className="mr-1" />
          OCR
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "全部"],
            ["soon", "将过期"],
            ["expired", "已过期"],
            ["ok", "正常"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setExpiry(id)}
            className={cn(
              "min-h-11 px-3 rounded-button text-xs font-medium",
              "transition-[background-color,color,transform] duration-fast ease-out active:scale-[0.97]",
              expiry === id
                ? "bg-accent-primary text-white shadow-accent"
                : "bg-app-surface border border-app-border text-tx-secondary [@media(hover:hover)_and_(pointer:fine)]:hover:bg-app-hover",
            )}
          >
            {label}
            {id === "soon" && stats.soon > 0 ? ` ${stats.soon}` : ""}
            {id === "expired" && stats.expired > 0 ? ` ${stats.expired}` : ""}
          </button>
        ))}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTagFilter("")}
            className={cn(
              "min-h-11 px-3 rounded-button text-xs",
              !tagFilter
                ? "bg-accent-primary/15 text-accent-primary"
                : "text-tx-tertiary",
            )}
          >
            全部标签
          </button>
          {tags.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTagFilter(tagFilter === t.name ? "" : t.name)}
              className={cn(
                "min-h-11 px-3 rounded-button text-xs border",
                tagFilter === t.name
                  ? "bg-accent-primary text-white border-transparent"
                  : "border-app-border text-tx-secondary",
              )}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={load} />}
      {loading ? (
        <LoadingBlock label="加载药箱…" />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Package}
          title="药箱还是空的"
          description="添加家里常备药，记录规格、用法与过期日；也可拍药盒 OCR 录入。"
          action={
            <div className="flex flex-wrap gap-2 justify-center">
              <EmptyActionButton onClick={openCreate}>添加药品</EmptyActionButton>
              <EmptyActionButton onClick={() => setShowOcr(true)}>
                OCR 识别
              </EmptyActionButton>
            </div>
          }
        />
      ) : (
        <ul className="space-y-2">
          {list.map((m) => {
            const st = expiryStatus(m.expiryDate);
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => openDetail(m.id)}
                  className={cn(
                    "w-full text-left rounded-card border p-3 min-h-12",
                    "bg-app-surface",
                    "transition-[background-color,border-color,transform] duration-fast ease-out",
                    "active:scale-[0.99]",
                    "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-app-hover",
                    expiryCardBorderClass(st),
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-tx-primary truncate">{m.name}</div>
                      <div className="text-xs text-tx-tertiary mt-0.5 line-clamp-1">
                        {[
                          CATEGORY_LABEL[m.category] || m.category,
                          m.spec,
                          m.quantityRemain != null
                            ? `剩余 ${m.quantityRemain}${m.unit || ""}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    {st === "expired" && (
                      <span
                        className={cn(
                          "shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-0.5",
                          expiryBadgeClass("expired"),
                        )}
                      >
                        <AlertTriangle size={10} />
                        已过期
                      </span>
                    )}
                    {st === "soon" && (
                      <span
                        className={cn(
                          "shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium",
                          expiryBadgeClass("soon"),
                        )}
                      >
                        将过期 {m.expiryDate}
                      </span>
                    )}
                    {st === "ok" && m.expiryDate && (
                      <span className={cn("shrink-0 text-[10px]", expiryBadgeClass("ok"))}>
                        至 {m.expiryDate}
                      </span>
                    )}
                  </div>
                  {(m.tags || []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {m.tags!.map((t) => (
                        <span
                          key={t.id}
                          className="text-[10px] px-1.5 py-0.5 rounded-full bg-app-elevated text-tx-secondary"
                        >
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* 表单 */}
      <BottomSheet
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingId ? "编辑药品" : "添加药品"}
      >
        <div className="space-y-3 p-1 max-h-[70vh] overflow-y-auto">
          <label className="block space-y-1">
            <span className="text-xs text-tx-secondary">名称 *</span>
            <input
              className={fieldControlClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-xs text-tx-secondary">分类</span>
              <select
                className={fieldControlClass}
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-tx-secondary">品牌/厂家</span>
              <input
                className={fieldControlClass}
                value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
              />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-xs text-tx-secondary">规格</span>
            <input
              className={fieldControlClass}
              value={form.spec}
              onChange={(e) => setForm({ ...form, spec: e.target.value })}
              placeholder="如 0.5g×24片"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-tx-secondary">用法用量</span>
            <textarea
              className={cn(fieldControlClass, "min-h-[64px]")}
              value={form.usageText}
              onChange={(e) => setForm({ ...form, usageText: e.target.value })}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-tx-secondary">功效 / 适应症</span>
            <textarea
              className={cn(fieldControlClass, "min-h-[56px]")}
              value={form.efficacy}
              onChange={(e) => setForm({ ...form, efficacy: e.target.value })}
            />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block space-y-1">
              <span className="text-xs text-tx-secondary">剩余</span>
              <input
                className={fieldControlClass}
                inputMode="decimal"
                value={form.quantityRemain}
                onChange={(e) => setForm({ ...form, quantityRemain: e.target.value })}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-tx-secondary">单位</span>
              <input
                className={fieldControlClass}
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-tx-secondary">过期日</span>
              <input
                type="date"
                className={fieldControlClass}
                value={form.expiryDate}
                onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
              />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-xs text-tx-secondary">存放位置</span>
            <input
              className={fieldControlClass}
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-tx-secondary">标签（逗号分隔）</span>
            <input
              className={fieldControlClass}
              value={form.tagInput}
              onChange={(e) => setForm({ ...form, tagInput: e.target.value })}
              placeholder="退烧，儿童，常备"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-tx-secondary">备注</span>
            <textarea
              className={cn(fieldControlClass, "min-h-[48px]")}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          <Button className="w-full min-h-11" disabled={saving} onClick={save}>
            {saving ? <Loader2 className="animate-spin" size={18} /> : "保存"}
          </Button>
        </div>
      </BottomSheet>

      {/* OCR：支持多图（正面/侧面/说明书）综合识别 */}
      <BottomSheet open={showOcr} onClose={closeOcrSheet} title="药盒 OCR">
        <div className="space-y-3 p-1 max-h-[75vh] overflow-y-auto">
          <p className="text-xs text-tx-tertiary leading-relaxed">
            一种药可拍多张：药盒正面、侧面规格、说明书页等（最多 6 张）。全部加完后点「开始识别」，系统会综合多图信息。结果请人工核对（非用药医嘱）。
          </p>

          {/* 已选缩略图 */}
          {ocrPreviews.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {ocrPreviews.map((url, i) => (
                <div
                  key={url}
                  className="relative shrink-0 w-20 h-20 rounded-card overflow-hidden border border-app-border bg-app-elevated"
                >
                  <img src={url} alt={`药盒图 ${i + 1}`} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    disabled={ocrBusy}
                    onClick={() => removeOcrImage(i)}
                    className="absolute top-0.5 right-0.5 min-w-7 min-h-7 rounded-full bg-black/60 text-white text-xs flex items-center justify-center"
                    aria-label={`删除第 ${i + 1} 张`}
                  >
                    ×
                  </button>
                  <span className="absolute bottom-0 left-0 right-0 text-[10px] text-center bg-black/50 text-white">
                    {i + 1}
                  </span>
                </div>
              ))}
            </div>
          )}

          <label
            className={cn(
              "flex flex-col items-center justify-center gap-2 min-h-[100px] rounded-card",
              "border border-dashed border-app-border bg-app-elevated cursor-pointer",
              (ocrBusy || ocrAttachmentIds.length >= 6) && "opacity-60 pointer-events-none",
            )}
          >
            {ocrBusy && !ocrPreviews.length ? (
              <>
                <Loader2 className="animate-spin text-accent-primary" size={24} />
                <span className="text-sm">处理中…</span>
              </>
            ) : (
              <>
                <Upload size={22} className="text-tx-tertiary" />
                <span className="text-sm text-tx-secondary">
                  {ocrAttachmentIds.length
                    ? `继续添加照片（${ocrAttachmentIds.length}/6）`
                    : "选择药盒照片（可多选）"}
                </span>
                <span className="text-[11px] text-tx-tertiary">支持一次选多张</span>
              </>
            )}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void addOcrFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>

          {ocrAttachmentIds.length > 0 && !ocrStructured && (
            <Button
              className="w-full min-h-11"
              disabled={ocrBusy}
              onClick={() => void runMultiOcr()}
            >
              {ocrBusy ? (
                <>
                  <Loader2 className="animate-spin mr-2" size={18} />
                  识别中（{ocrAttachmentIds.length} 张）…
                </>
              ) : (
                <>
                  <ScanText size={18} className="mr-2" />
                  开始识别（{ocrAttachmentIds.length} 张）
                </>
              )}
            </Button>
          )}

          {ocrStructured && (
            <div className="space-y-2 rounded-card border border-app-border p-3">
              <p className="text-xs text-tx-tertiary">
                已综合 {ocrAttachmentIds.length} 张照片 · 可改字段后写入
              </p>
              {ocrStructured.warnings?.map((w, i) => (
                <p key={i} className="text-xs text-accent-warning">
                  · {w}
                </p>
              ))}
              {(
                [
                  ["name", "名称"],
                  ["brand", "品牌"],
                  ["spec", "规格"],
                  ["usageText", "用法用量"],
                  ["efficacy", "功效"],
                  ["form", "剂型"],
                  ["unit", "单位"],
                  ["expiryDate", "过期日"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block space-y-1">
                  <span className="text-xs text-tx-secondary">{label}</span>
                  <input
                    className={fieldControlClass}
                    value={(ocrStructured as any)[key] || ""}
                    onChange={(e) =>
                      setOcrStructured({
                        ...ocrStructured,
                        [key]: e.target.value,
                      })
                    }
                  />
                </label>
              ))}
              <label className="block space-y-1">
                <span className="text-xs text-tx-secondary">建议标签</span>
                <input
                  className={fieldControlClass}
                  value={(ocrStructured.suggestedTags || []).join("，")}
                  onChange={(e) =>
                    setOcrStructured({
                      ...ocrStructured,
                      suggestedTags: e.target.value
                        .split(/[,，、\s]+/)
                        .map((x) => x.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1 min-h-11"
                  disabled={ocrBusy}
                  onClick={() => {
                    setOcrStructured(null);
                  }}
                >
                  重新识别
                </Button>
                <Button
                  className="flex-1 min-h-11"
                  disabled={ocrApplying}
                  onClick={() => void applyOcr()}
                >
                  {ocrApplying ? (
                    <Loader2 className="animate-spin" size={18} />
                  ) : (
                    "确认写入药箱"
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </BottomSheet>

      {/* 详情：桌面 AppModal / 移动 BottomSheet */}
      {(() => {
        const closeMedDetail = () => {
          setDetailOpen(false);
          setDetail(null);
        };
        const body = !detail ? (
          <LoadingBlock label="加载…" />
        ) : (
          <div className="space-y-3 px-1 pb-4">
            {expiryStatus(detail.expiryDate) === "expired" && (
              <p className="text-xs text-accent-danger flex items-center gap-1 rounded-card border border-accent-danger/30 bg-accent-danger/8 px-3 py-2">
                <AlertTriangle size={14} />
                该药品已过期，请勿继续使用，及时清理。
              </p>
            )}
            {expiryStatus(detail.expiryDate) === "soon" && (
              <p className="text-xs text-accent-warning flex items-center gap-1 rounded-card border border-accent-warning/30 bg-accent-warning/8 px-3 py-2">
                <AlertTriangle size={14} />
                将于 {detail.expiryDate} 过期，请优先使用。
              </p>
            )}
            <Row label="分类" value={CATEGORY_LABEL[detail.category] || detail.category} />
            <Row label="品牌" value={detail.brand} />
            <Row label="规格" value={detail.spec} />
            <Row label="剂型" value={detail.form} />
            <Row
              label="剩余"
              value={
                detail.quantityRemain != null
                  ? `${detail.quantityRemain}${detail.unit || ""}`
                  : null
              }
            />
            <Row label="过期日" value={detail.expiryDate} />
            <Row label="用法用量" value={detail.usageText} />
            <Row label="功效" value={detail.efficacy} />
            <Row label="存放" value={detail.location} />
            <Row label="备注" value={detail.notes} />
            {(detail.tags || []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {detail.tags!.map((t) => (
                  <span
                    key={t.id}
                    className="text-xs px-2 py-0.5 rounded-full bg-app-elevated"
                  >
                    {t.name}
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <Button
                variant="secondary"
                className="flex-1 min-h-11"
                onClick={() => openEdit(detail)}
              >
                编辑
              </Button>
              <Button
                variant="secondary"
                className="min-h-11 text-accent-danger"
                onClick={() => remove(detail.id)}
              >
                <Trash2 size={16} />
              </Button>
            </div>
          </div>
        );

        if (isDesktop) {
          return detailOpen ? (
            <AppModal
              title={detail?.name || "药品详情"}
              onClose={closeMedDetail}
              widthClass="max-w-md"
              heightClass="max-h-[88vh]"
            >
              <div className="p-4 min-h-0 flex-1 overflow-y-auto">{body}</div>
            </AppModal>
          ) : null;
        }

        return (
          <BottomSheet
            open={detailOpen}
            onClose={closeMedDetail}
            title={detail?.name || "药品详情"}
            maxHeight="min(88dvh, 100%)"
            zClassName="z-modal"
          >
            {body}
          </BottomSheet>
        );
      })()}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-xs text-tx-tertiary">{label}</div>
      <div className="text-sm text-tx-primary whitespace-pre-wrap mt-0.5">{value}</div>
    </div>
  );
}
