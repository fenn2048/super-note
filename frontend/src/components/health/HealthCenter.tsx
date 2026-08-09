/**
 * 家人健康管理档案中心
 * 成员 → 病历本 → 时间轴 → 详情 / OCR / 复盘
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Calendar,
  ChevronDown,
  Filter,
  HeartPulse,
  Loader2,
  Package,
  Plus,
  ScanText,
  Stethoscope,
  Trash2,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
import { api, getCurrentWorkspace, getBaseUrl } from "@/lib/api";
import type {
  HealthAttachment,
  HealthBook,
  HealthMember,
  HealthOcrStructured,
  HealthRecordDetail,
  HealthRecordTimelineItem,
} from "@/types";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { useAppActions } from "@/store/AppContext";
import { MobileChromeIconButton } from "@/components/common/MobileChromeHeader";
import ModuleShell from "@/components/layout/ModuleShell";
import {
  EmptyState,
  EmptyActionButton,
  LoadingBlock,
  ErrorBanner,
} from "@/components/common/FeedbackStates";
import { BottomSheet } from "@/components/common/BottomSheet";
import { AppModal } from "@/components/common/AppModal";
import { Button } from "@/components/ui/button";
import { FieldInput, fieldControlClass } from "@/components/ui/field";
import { Motion } from "@/components/common/Motion";
import HealthAnalytics from "@/components/health/HealthAnalytics";
import MedicineCabinet from "@/components/health/MedicineCabinet";
import {
  HEALTH_MED_PREFILL_KEY,
  medicineSystemBadgeClass,
  recordStatusBadgeClass,
} from "@/lib/healthUi";
import { useMediaQuery } from "@/hooks/useMediaQuery";

type RangeMode = "year" | "month" | "custom";
type Panel = "main" | "analytics";
/** 健康模块顶层：病历档案 | 家庭药箱 */
type Section = "archive" | "cabinet";

const STATUS_LABEL: Record<string, string> = {
  ongoing: "进行中",
  recovered: "已痊愈",
  chronic: "慢性随访",
  unknown: "未知",
};

const TYPE_LABEL: Record<string, string> = {
  visit: "门诊",
  hospitalization: "住院",
  surgery: "手术",
  infusion: "输液",
  checkup: "体检/检查",
  medication: "用药",
  emergency: "急诊",
  other: "其他",
};

const SYSTEM_LABEL: Record<string, string> = {
  western: "西医",
  tcm: "中医",
  integrated: "中西医",
  unknown: "未区分",
};

const KIND_LABEL: Record<string, string> = {
  medical_record: "病历",
  invoice: "发票",
  exam_lab: "检查化验",
  prescription: "处方(通用)",
  prescription_western: "西药处方",
  prescription_tcm: "中药方笺",
  other: "其他",
};

function systemBadgeClass(sys?: string) {
  return medicineSystemBadgeClass(sys);
}

function diagnosisLine(r: {
  diagnosis?: string | null;
  diagnosisWestern?: string | null;
  diagnosisTcm?: string | null;
  medicineSystem?: string | null;
}) {
  const w = (r.diagnosisWestern || "").trim();
  const t = (r.diagnosisTcm || "").trim();
  if (w && t && w !== t) return `西：${w} · 中：${t}`;
  if (t && r.medicineSystem === "tcm") return t;
  if (w) return w;
  if (t) return t;
  return r.diagnosis || "";
}

const REL_OPTIONS = ["本人", "配偶", "子女", "父母", "祖辈", "其他"];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rangeForMode(mode: RangeMode, customFrom: string, customTo: string) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (mode === "year") {
    return { from: `${y}-01-01`, to: todayISO() };
  }
  if (mode === "month") {
    return {
      from: `${y}-${String(m + 1).padStart(2, "0")}-01`,
      to: todayISO(),
    };
  }
  return {
    from: customFrom || `${y}-01-01`,
    to: customTo || todayISO(),
  };
}

function authAssetUrl(path: string | undefined) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  // 附件走相对 /api；浏览器 img 需完整 base（同源时 /api 亦可）
  const base = getBaseUrl().replace(/\/api\/?$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export default function HealthCenter() {
  const appActions = useAppActions();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [workspaceId, setWorkspaceId] = useState(() => getCurrentWorkspace());
  const [section, setSection] = useState<Section>("archive");
  const [panel, setPanel] = useState<Panel>("main");
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  /** 时间轴 stagger 仅首次有数据时播放 */
  const timelineStaggerRef = useRef(true);
  const [useTimelineStagger, setUseTimelineStagger] = useState(true);

  const [members, setMembers] = useState<HealthMember[]>([]);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [books, setBooks] = useState<HealthBook[]>([]);
  const [bookId, setBookId] = useState<string | null>(null);
  const [records, setRecords] = useState<HealthRecordTimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);

  const [rangeMode, setRangeMode] = useState<RangeMode>("year");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  /** 时间轴医疗体系筛选：all | western | tcm | integrated */
  const [systemFilter, setSystemFilter] = useState<string>("all");

  // sheets
  const [showMemberForm, setShowMemberForm] = useState(false);
  const [memberName, setMemberName] = useState("");
  const [memberRel, setMemberRel] = useState("本人");
  const [memberBirth, setMemberBirth] = useState("");
  const [savingMember, setSavingMember] = useState(false);

  const [showBookForm, setShowBookForm] = useState(false);
  const [bookTitle, setBookTitle] = useState("");
  const [savingBook, setSavingBook] = useState(false);

  const [showRecordForm, setShowRecordForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [savingRecord, setSavingRecord] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<HealthRecordDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // OCR
  const [showOcr, setShowOcr] = useState(false);
  const [ocrKind, setOcrKind] = useState("prescription_tcm");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrStructured, setOcrStructured] = useState<HealthOcrStructured | null>(null);
  const [ocrAttachmentIds, setOcrAttachmentIds] = useState<string[]>([]);
  const [ocrPreviews, setOcrPreviews] = useState<string[]>([]);
  const [ocrApplying, setOcrApplying] = useState(false);
  /** 写入方式：新建病历 | 合并到已有 */
  const [ocrWriteMode, setOcrWriteMode] = useState<"create" | "merge">("create");
  /** 合并目标病历 id */
  const [ocrTargetRecordId, setOcrTargetRecordId] = useState<string | null>(null);

  useEffect(() => {
    const onWs = (e: Event) => {
      const custom = e as CustomEvent<{ workspaceId?: string }>;
      setWorkspaceId(custom.detail?.workspaceId || getCurrentWorkspace());
    };
    window.addEventListener("super:workspace-changed", onWs);
    return () => window.removeEventListener("super:workspace-changed", onWs);
  }, []);

  const goBack = useCallback(() => {
    appActions.setViewMode("more");
    appActions.setMobileView("list");
  }, [appActions]);

  const loadMembers = useCallback(async () => {
    if (!workspaceId) {
      setMembers([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await api.health.listMembers(workspaceId);
      setMembers(list);
      setMemberId((prev) => {
        if (prev && list.some((m) => m.id === prev)) return prev;
        return list[0]?.id || null;
      });
    } catch (e: any) {
      setError(e?.message || "加载成员失败");
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const loadBooks = useCallback(async () => {
    if (!memberId) {
      setBooks([]);
      setBookId(null);
      return;
    }
    try {
      const list = await api.health.listBooks(memberId);
      setBooks(list);
      setBookId((prev) => {
        if (prev && list.some((b) => b.id === prev)) return prev;
        return list[0]?.id || null;
      });
    } catch (e: any) {
      toast.error(e?.message || "加载病历本失败");
      setBooks([]);
    }
  }, [memberId]);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  const dateRange = useMemo(
    () => rangeForMode(rangeMode, customFrom, customTo),
    [rangeMode, customFrom, customTo],
  );

  const loadRecords = useCallback(async () => {
    if (!bookId) {
      setRecords([]);
      return;
    }
    setListLoading(true);
    try {
      const list = await api.health.listRecords({
        bookId,
        from: dateRange.from,
        to: dateRange.to,
        medicineSystem: systemFilter === "all" ? undefined : systemFilter,
      });
      setRecords(list);
    } catch (e: any) {
      toast.error(e?.message || "加载时间轴失败");
      setRecords([]);
    } finally {
      setListLoading(false);
    }
  }, [bookId, dateRange.from, dateRange.to, systemFilter]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    if (records.length > 0 && timelineStaggerRef.current) {
      const t = window.setTimeout(() => {
        timelineStaggerRef.current = false;
        setUseTimelineStagger(false);
      }, 600);
      return () => window.clearTimeout(t);
    }
  }, [records.length]);

  const activeMember = members.find((m) => m.id === memberId) || null;
  const activeBook = books.find((b) => b.id === bookId) || null;

  const filterSummary = useMemo(() => {
    const rangeLabel =
      rangeMode === "year" ? "本年" : rangeMode === "month" ? "本月" : "自定义区间";
    const sysLabel =
      systemFilter === "all"
        ? "全部体系"
        : SYSTEM_LABEL[systemFilter] || systemFilter;
    const bookLabel = activeBook?.title || "未选病历本";
    return `${bookLabel} · ${rangeLabel} · ${sysLabel}`;
  }, [rangeMode, systemFilter, activeBook?.title]);

  const openCreateRecord = () => {
    setEditingId(null);
    setForm(emptyForm());
    setShowRecordForm(true);
  };

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  }, []);

  /** 将处方信息预填到药箱并切换分区 */
  const sendPrescriptionToCabinet = useCallback(
    (d: HealthRecordDetail) => {
      const rx = (d.prescription || "").trim();
      const nameGuess =
        rx.split(/[\n,，、]/)[0]?.trim().slice(0, 40) ||
        d.title?.slice(0, 40) ||
        "处方药品";
      try {
        sessionStorage.setItem(
          HEALTH_MED_PREFILL_KEY,
          JSON.stringify({
            name: nameGuess,
            usageText: rx || "",
            notes: [
              d.hospital && `医院：${d.hospital}`,
              d.doctor && `医生：${d.doctor}`,
              d.occurredAt && `就诊：${d.occurredAt}`,
              d.diagnosisWestern && `西医：${d.diagnosisWestern}`,
              d.diagnosisTcm && `中医：${d.diagnosisTcm}`,
            ]
              .filter(Boolean)
              .join("\n"),
            category:
              d.medicineSystem === "tcm"
                ? "tcm_patent"
                : d.medicineSystem === "western"
                  ? "western"
                  : "other",
            sourceRecordId: d.id,
          }),
        );
      } catch {
        /* ignore */
      }
      closeDetail();
      setSection("cabinet");
      toast.success("已带到药箱，请核对后保存");
    },
    [closeDetail],
  );

  const openEditFromDetail = (d: HealthRecordDetail) => {
    setEditingId(d.id);
    setForm({
      title: d.title || "",
      recordType: d.recordType || "visit",
      status: d.status || "ongoing",
      medicineSystem: d.medicineSystem || "unknown",
      occurredAt: d.occurredAt || todayISO(),
      endedAt: d.endedAt || "",
      hospital: d.hospital || "",
      department: d.department || "",
      doctor: d.doctor || "",
      diagnosisWestern: d.diagnosisWestern || "",
      diagnosisTcm: d.diagnosisTcm || "",
      diagnosis: d.diagnosis || "",
      prescription: d.prescription || "",
      advice: d.advice || "",
      notes: d.notes || "",
      costYuan: d.costMinor != null ? (d.costMinor / 100).toFixed(2) : "",
      careWard: String((d.careExtra as any)?.ward || ""),
      careBed: String((d.careExtra as any)?.bedNo || ""),
      careSurgeryName: String((d.careExtra as any)?.surgeryName || ""),
      careSurgeon: String((d.careExtra as any)?.surgeon || ""),
      careInfusionDrug: String((d.careExtra as any)?.drugName || ""),
      careInfusionVolume: String((d.careExtra as any)?.volume || ""),
      careInfusionSite: String((d.careExtra as any)?.site || ""),
      stagesText: (d.stages || [])
        .map((s) => {
          const head = [s.stageDate, s.label].filter(Boolean).join(" ");
          return head ? `${head}：${s.symptoms}` : s.symptoms;
        })
        .join("\n"),
    });
    closeDetail();
    setShowRecordForm(true);
  };

  const saveMember = async () => {
    if (!workspaceId || !memberName.trim()) {
      toast.error("请填写姓名");
      return;
    }
    setSavingMember(true);
    try {
      const r = await api.health.createMember({
        workspaceId,
        displayName: memberName.trim(),
        relationship: memberRel || null,
        birthDate: memberBirth || null,
      });
      toast.success("已添加家庭成员");
      setShowMemberForm(false);
      setMemberName("");
      setMemberBirth("");
      await loadMembers();
      setMemberId(r.member.id);
    } catch (e: any) {
      toast.error(e?.message || "创建失败");
    } finally {
      setSavingMember(false);
    }
  };

  const saveBook = async () => {
    if (!memberId || !bookTitle.trim()) {
      toast.error("请填写病历本名称");
      return;
    }
    setSavingBook(true);
    try {
      const b = await api.health.createBook({
        memberId,
        title: bookTitle.trim(),
      });
      toast.success("已创建病历本");
      setShowBookForm(false);
      setBookTitle("");
      await loadBooks();
      setBookId(b.id);
    } catch (e: any) {
      toast.error(e?.message || "创建失败");
    } finally {
      setSavingBook(false);
    }
  };

  const parseStages = (text: string) => {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, i) => {
        const m = line.match(/^(\d{4}-\d{2}-\d{2})?\s*([^：:]*)[：:]\s*(.+)$/);
        if (m) {
          return {
            stageDate: m[1] || null,
            label: m[2]?.trim() || null,
            symptoms: m[3].trim(),
            sortOrder: i,
          };
        }
        return { symptoms: line, sortOrder: i };
      });
  };

  const saveRecord = async () => {
    if (!bookId) return;
    if (!form.title.trim()) {
      toast.error("请填写标题/诊断简称");
      return;
    }
    if (!form.occurredAt) {
      toast.error("请填写就诊日期");
      return;
    }
    setSavingRecord(true);
    const costMinor =
      form.costYuan.trim() === ""
        ? null
        : Math.round(parseFloat(form.costYuan) * 100);
    const stages = parseStages(form.stagesText);
    const careExtra: Record<string, string> = {};
    if (form.recordType === "hospitalization") {
      if (form.careWard) careExtra.ward = form.careWard;
      if (form.careBed) careExtra.bedNo = form.careBed;
    }
    if (form.recordType === "surgery") {
      if (form.careSurgeryName) careExtra.surgeryName = form.careSurgeryName;
      if (form.careSurgeon) careExtra.surgeon = form.careSurgeon;
    }
    if (form.recordType === "infusion") {
      if (form.careInfusionDrug) careExtra.drugName = form.careInfusionDrug;
      if (form.careInfusionVolume) careExtra.volume = form.careInfusionVolume;
      if (form.careInfusionSite) careExtra.site = form.careInfusionSite;
    }
    const payload = {
      bookId,
      title: form.title.trim(),
      recordType: form.recordType,
      status: form.status,
      medicineSystem: form.medicineSystem || "unknown",
      occurredAt: form.occurredAt,
      endedAt: form.endedAt || null,
      hospital: form.hospital || null,
      department: form.department || null,
      doctor: form.doctor || null,
      diagnosisWestern: form.diagnosisWestern || null,
      diagnosisTcm: form.diagnosisTcm || null,
      diagnosis: form.diagnosis || null,
      prescription: form.prescription || null,
      advice: form.advice || null,
      notes: form.notes || null,
      costMinor: Number.isFinite(costMinor as number) ? costMinor : null,
      careExtra: Object.keys(careExtra).length ? careExtra : null,
      stages,
    };
    try {
      if (editingId) {
        await api.health.updateRecord(editingId, payload);
        toast.success("已更新病历");
      } else {
        await api.health.createRecord(payload);
        toast.success("已创建病历");
      }
      setShowRecordForm(false);
      await loadRecords();
    } catch (e: any) {
      toast.error(e?.message || "保存失败");
    } finally {
      setSavingRecord(false);
    }
  };

  const openDetail = async (id: string) => {
    // 先打开弹层，再拉数据——避免依赖 detail 才 open 导致「点了没反应」
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    try {
      const d = await api.health.getRecord(id);
      setDetail(d);
    } catch (e: any) {
      const msg = e?.message || "加载详情失败";
      setDetailError(msg);
      toast.error(msg);
    } finally {
      setDetailLoading(false);
    }
  };

  const deleteRecord = async (id: string) => {
    if (!confirm("确定删除这条病历？")) return;
    try {
      await api.health.deleteRecord(id);
      toast.success("已删除");
      closeDetail();
      await loadRecords();
    } catch (e: any) {
      toast.error(e?.message || "删除失败");
    }
  };

  const resetRecordOcrSession = () => {
    ocrPreviews.forEach((u) => URL.revokeObjectURL(u));
    setOcrPreviews([]);
    setOcrAttachmentIds([]);
    setOcrStructured(null);
  };

  const openOcrSheet = (opts?: { mergeToRecordId?: string; kind?: string }) => {
    if (opts?.kind) setOcrKind(opts.kind);
    if (opts?.mergeToRecordId) {
      setOcrWriteMode("merge");
      setOcrTargetRecordId(opts.mergeToRecordId);
    } else if (detailOpen && detail?.id) {
      setOcrWriteMode("merge");
      setOcrTargetRecordId(detail.id);
    } else {
      setOcrWriteMode("create");
      setOcrTargetRecordId(records[0]?.id || null);
    }
    resetRecordOcrSession();
    setShowOcr(true);
  };

  /** 追加多张报告图（最多 6） */
  const addRecordOcrFiles = async (files: FileList | File[]) => {
    if (!workspaceId || !bookId) {
      toast.error("请先选择成员与病历本");
      return;
    }
    const arr = Array.from(files).filter(
      (f) => f.type.startsWith("image/") || f.type === "application/pdf",
    );
    if (!arr.length) {
      toast.error("请选择图片或 PDF");
      return;
    }
    // 多图综合仅支持图片；PDF 仍可单张
    const images = arr.filter((f) => f.type.startsWith("image/"));
    const pdfs = arr.filter((f) => f.type === "application/pdf");
    if (pdfs.length && ocrAttachmentIds.length + images.length > 0) {
      toast.warning("多图模式请使用图片；PDF 请单独识别");
    }
    const remaining = Math.max(0, 6 - ocrAttachmentIds.length);
    if (remaining <= 0) {
      toast.warning("最多 6 张图片");
      return;
    }
    const slice = (images.length ? images : arr).slice(0, remaining);
    setOcrBusy(true);
    try {
      const newIds: string[] = [];
      const newPreviews: string[] = [];
      for (const file of slice) {
        const att = await api.health.uploadAttachment({
          file,
          workspaceId,
          kind: ocrKind,
          bookId,
          memberId: memberId || undefined,
          recordId:
            ocrWriteMode === "merge" && ocrTargetRecordId
              ? ocrTargetRecordId
              : undefined,
        });
        newIds.push(att.id);
        if (file.type.startsWith("image/")) {
          newPreviews.push(URL.createObjectURL(file));
        }
      }
      setOcrAttachmentIds((prev) => [...prev, ...newIds]);
      setOcrPreviews((prev) => [...prev, ...newPreviews]);
      setOcrStructured(null);
      toast.success(`已添加 ${slice.length} 张（共 ${ocrAttachmentIds.length + slice.length}）`);
    } catch (e: any) {
      toast.error(e?.message || "上传失败");
    } finally {
      setOcrBusy(false);
    }
  };

  const removeRecordOcrImage = (index: number) => {
    setOcrAttachmentIds((prev) => prev.filter((_, i) => i !== index));
    setOcrPreviews((prev) => {
      const url = prev[index];
      if (url) URL.revokeObjectURL(url);
      return prev.filter((_, i) => i !== index);
    });
    setOcrStructured(null);
  };

  const runRecordMultiOcr = async () => {
    if (!ocrAttachmentIds.length) {
      toast.error("请先添加至少一张图片");
      return;
    }
    setOcrBusy(true);
    setOcrStructured(null);
    try {
      toast.success(
        ocrAttachmentIds.length > 1
          ? `正在综合 ${ocrAttachmentIds.length} 张报告识别…`
          : "正在识别…",
      );
      const r =
        ocrAttachmentIds.length === 1
          ? await api.health.runOcr(ocrAttachmentIds[0], ocrKind)
          : await api.health.runOcrBatch(ocrAttachmentIds, ocrKind);
      if ((r as any).attachmentIds?.length) {
        setOcrAttachmentIds((r as any).attachmentIds);
      }
      setOcrStructured(r.structured);
      toast.success("识别完成，请核对");
    } catch (e: any) {
      toast.error(e?.message || "OCR 失败");
    } finally {
      setOcrBusy(false);
    }
  };

  const applyOcr = async () => {
    if (!ocrStructured) return;
    if (ocrWriteMode === "merge") {
      if (!ocrTargetRecordId) {
        toast.error("请选择要合并的已有病历");
        return;
      }
    } else if (!bookId) {
      toast.error("请先选择病历本");
      return;
    }
    setOcrApplying(true);
    try {
      const rec =
        ocrWriteMode === "merge"
          ? await api.health.applyOcr({
              recordId: ocrTargetRecordId!,
              structured: ocrStructured,
              attachmentIds: ocrAttachmentIds,
              merge: true,
            })
          : await api.health.applyOcr({
              bookId: bookId!,
              structured: ocrStructured,
              attachmentIds: ocrAttachmentIds,
              merge: false,
            });
      toast.success(
        ocrWriteMode === "merge"
          ? "已合并到已有病历（检查结果写入检查区，不占处方）"
          : "已创建新病历",
      );
      setShowOcr(false);
      resetRecordOcrSession();
      await loadRecords();
      if (rec?.id) openDetail(rec.id);
    } catch (e: any) {
      toast.error(e?.message || "应用失败");
    } finally {
      setOcrApplying(false);
    }
  };

  const uploadToDetail = async (file: File, kind: string) => {
    if (!detail || !workspaceId) return;
    try {
      await api.health.uploadAttachment({
        file,
        workspaceId,
        kind,
        recordId: detail.id,
      });
      toast.success("附件已上传");
      openDetail(detail.id);
    } catch (e: any) {
      toast.error(e?.message || "上传失败");
    }
  };

  if (panel === "analytics") {
    return (
      <HealthAnalytics
        workspaceId={workspaceId}
        memberId={memberId}
        members={members}
        onBack={() => setPanel("main")}
      />
    );
  }

  if (!workspaceId) {
    return (
      <ModuleShell title="健康档案" onBack={goBack}>
        <EmptyState
          icon={HeartPulse}
          title="需要家庭工作区"
          description="健康档案绑定家庭空间。请先创建或加入工作区后再使用。"
        />
      </ModuleShell>
    );
  }

  const sectionTabs = (
    <div className="flex gap-2 p-1 rounded-card bg-app-elevated">
      {(
        [
          ["archive", "病历档案"],
          ["cabinet", "家庭药箱"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => setSection(id)}
          className={cn(
            "flex-1 min-h-11 rounded-button text-sm font-medium",
            "transition-[background-color,color,box-shadow,transform] duration-fast ease-out active:scale-[0.98]",
            section === id
              ? "bg-app-surface text-tx-primary shadow-xs"
              : "text-tx-tertiary [@media(hover:hover)_and_(pointer:fine)]:hover:bg-app-hover",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <ModuleShell
      title="健康"
      subtitle="病历档案 · 家庭药箱 · OCR 录入"
      onBack={goBack}
      materialHeader
      mobileRight={
        section === "archive" ? (
          <MobileChromeIconButton
            aria-label="复盘统计"
            onClick={() => setPanel("analytics")}
          >
            <BarChart3 size={20} />
          </MobileChromeIconButton>
        ) : undefined
      }
      desktopActions={
        section === "archive" ? (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="min-h-11"
              onClick={() => setPanel("analytics")}
            >
              <BarChart3 size={16} className="mr-1.5" />
              复盘
            </Button>
            <Button size="sm" className="min-h-11" onClick={() => setShowMemberForm(true)}>
              <UserPlus size={16} className="mr-1.5" />
              添加成员
            </Button>
          </div>
        ) : undefined
      }
      canvasClassName="pb-24 md:pb-8"
    >
        {sectionTabs}

        <Motion.div
          key={section}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="flex flex-col gap-3 min-h-0"
        >
        {section === "cabinet" ? (
          <MedicineCabinet workspaceId={workspaceId} />
        ) : (
          <>
        {error && <ErrorBanner message={error} onRetry={loadMembers} />}
        {loading ? (
          <LoadingBlock label="加载家庭成员…" />
        ) : members.length === 0 ? (
          <EmptyState
            icon={HeartPulse}
            title="还没有健康成员"
            description="先添加家人（可无账号），再为 TA 创建病历本与就诊记录。"
            action={
              <EmptyActionButton onClick={() => setShowMemberForm(true)}>
                添加家庭成员
              </EmptyActionButton>
            }
          />
        ) : (
          <>
            {/* 成员 chips */}
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMemberId(m.id)}
                  className={cn(
                    "shrink-0 min-h-11 px-4 rounded-button text-sm font-medium",
                    "transition-colors duration-fast ease-out",
                    memberId === m.id
                      ? "bg-accent-primary text-white shadow-accent"
                      : "bg-app-surface text-tx-secondary border border-app-border",
                  )}
                >
                  {m.displayName}
                  {m.relationship ? (
                    <span className="ml-1 opacity-70 text-xs">{m.relationship}</span>
                  ) : null}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowMemberForm(true)}
                className="shrink-0 min-h-11 min-w-11 rounded-button border border-dashed border-app-border text-tx-tertiary flex items-center justify-center"
                aria-label="添加成员"
              >
                <Plus size={18} />
              </button>
            </div>

            {activeMember && (
              <div className="rounded-card bg-app-surface border border-app-border p-3 text-sm text-tx-secondary">
                <div className="font-medium text-tx-primary">{activeMember.displayName}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-tx-tertiary">
                  {activeMember.relationship && <span>{activeMember.relationship}</span>}
                  {activeMember.birthDate && <span>出生 {activeMember.birthDate}</span>}
                  {activeMember.bloodType && <span>血型 {activeMember.bloodType}</span>}
                  {activeMember.allergies && <span>过敏：{activeMember.allergies}</span>}
                </div>
              </div>
            )}

            {/* 筛选摘要（病历本 / 范围 / 体系）— 减噪 */}
            <button
              type="button"
              onClick={() => setShowFilterSheet(true)}
              className={cn(
                "w-full min-h-12 flex items-center gap-2 px-3 rounded-card",
                "border border-app-border bg-app-surface text-left",
                "transition-[background-color,border-color,transform] duration-fast ease-out active:scale-[0.99]",
                "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-app-hover",
              )}
            >
              <Filter size={16} className="text-accent-primary shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-tx-tertiary">筛选</div>
                <div className="text-sm text-tx-primary truncate">{filterSummary}</div>
              </div>
              <ChevronDown size={16} className="text-tx-tertiary shrink-0" />
            </button>

            {/* 时间轴 + 桌面 master-detail */}
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-tx-primary flex items-center gap-1.5">
                <Calendar size={16} className="text-accent-primary" />
                时间轴
                <span className="text-xs font-normal text-tx-tertiary">
                  {dateRange.from} ~ {dateRange.to}
                </span>
              </div>
            </div>

            {listLoading ? (
              <LoadingBlock label="加载病历…" />
            ) : !bookId ? (
              <EmptyState title="请选择或创建病历本" description="每个成员可有多本病历本。" />
            ) : records.length === 0 ? (
              <EmptyState
                icon={Stethoscope}
                title="此区间暂无病历"
                description="可手动创建，或上传病历/处方/发票进行 OCR 填充。"
                action={
                  <div className="flex flex-wrap gap-2 justify-center">
                    <EmptyActionButton onClick={openCreateRecord}>新建病历</EmptyActionButton>
                    <EmptyActionButton onClick={() => openOcrSheet()}>
                      OCR 识别
                    </EmptyActionButton>
                  </div>
                }
              />
            ) : (
              <ul className="relative space-y-0 pl-4 border-l-2 border-app-border ml-2 min-w-0 max-w-3xl">
                {records.map((r, idx) => (
                  <Motion.li
                    key={r.id}
                    initial={useTimelineStagger ? { opacity: 0, y: 6 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={
                      useTimelineStagger
                        ? { delay: Math.min(idx * 0.03, 0.18), duration: 0.2 }
                        : { duration: 0 }
                    }
                    className="relative pb-4"
                  >
                    <span className="absolute -left-[21px] top-2 h-3 w-3 rounded-full bg-accent-primary ring-4 ring-app-bg" />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void openDetail(r.id);
                      }}
                      className={cn(
                        "w-full text-left rounded-card bg-app-surface border border-app-border p-3",
                        "min-h-12 transition-[background-color,border-color,transform] duration-fast ease-out",
                        "active:scale-[0.99] active:bg-app-elevated",
                        "[@media(hover:hover)_and_(pointer:fine)]:hover:border-accent-primary/40",
                        "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-app-hover",
                        "cursor-pointer relative z-[1]",
                        detailOpen && detail?.id === r.id && "border-accent-primary/50 bg-accent-primary/5",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs text-tx-tertiary">{r.occurredAt}</div>
                          <div className="font-medium text-tx-primary mt-0.5">{r.title}</div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span
                            className={cn(
                              "text-[10px] px-2 py-0.5 rounded-full font-medium",
                              systemBadgeClass(r.medicineSystem),
                            )}
                          >
                            {SYSTEM_LABEL[r.medicineSystem || "unknown"] || "未区分"}
                          </span>
                          <span
                            className={cn(
                              "text-[10px] px-2 py-0.5 rounded-full font-medium",
                              recordStatusBadgeClass(r.status),
                            )}
                          >
                            {STATUS_LABEL[r.status] || r.status}
                          </span>
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-tx-secondary line-clamp-2">
                        {[
                          TYPE_LABEL[r.recordType] || r.recordType,
                          r.hospital,
                          r.doctor,
                          diagnosisLine(r),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </button>
                  </Motion.li>
                ))}
              </ul>
            )}
          </>
        )}
          </>
        )}
        </Motion.div>

      {/* 筛选 Sheet */}
      <BottomSheet
        open={showFilterSheet}
        onClose={() => setShowFilterSheet(false)}
        title="筛选病历"
      >
        <div className="space-y-4 p-1 pb-4">
          <div>
            <div className="text-xs font-medium text-tx-secondary mb-2">病历本</div>
            <div className="flex flex-wrap gap-2">
              {books.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBookId(b.id)}
                  className={cn(
                    "min-h-11 px-3 rounded-button text-sm active:scale-[0.97]",
                    bookId === b.id
                      ? "bg-accent-primary text-white"
                      : "bg-app-elevated text-tx-secondary border border-app-border",
                  )}
                >
                  {b.title}
                </button>
              ))}
              <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setShowBookForm(true)}>
                <Plus size={16} className="mr-1" />
                新建本
              </Button>
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-tx-secondary mb-2">时间范围</div>
            <div className="flex flex-wrap gap-2">
              {(["year", "month", "custom"] as RangeMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setRangeMode(mode)}
                  className={cn(
                    "min-h-11 px-3 rounded-button text-xs font-medium active:scale-[0.97]",
                    rangeMode === mode
                      ? "bg-accent-primary text-white"
                      : "bg-app-surface border border-app-border text-tx-secondary",
                  )}
                >
                  {mode === "year" ? "本年" : mode === "month" ? "本月" : "自定义"}
                </button>
              ))}
            </div>
            {rangeMode === "custom" && (
              <div className="flex items-center gap-2 mt-2">
                <FieldInput type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                <span className="text-tx-tertiary text-xs">至</span>
                <FieldInput type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </div>
            )}
          </div>
          <div>
            <div className="text-xs font-medium text-tx-secondary mb-2">医疗体系</div>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["all", "全部"],
                  ["western", "西医"],
                  ["tcm", "中医"],
                  ["integrated", "中西医"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSystemFilter(id)}
                  className={cn(
                    "min-h-11 px-3 rounded-button text-xs font-medium active:scale-[0.97]",
                    systemFilter === id
                      ? "bg-accent-primary text-white"
                      : "bg-app-surface border border-app-border text-tx-secondary",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Button className="w-full min-h-11" onClick={() => setShowFilterSheet(false)}>
            完成
          </Button>
        </div>
      </BottomSheet>

      {/* FAB — 主按钮展开次级（OCR） */}
      {section === "archive" && memberId && bookId && (
        <div
          className={cn(
            "fixed right-4 z-30 flex flex-col gap-2 items-end",
            "bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] md:bottom-6",
          )}
        >
          {fabOpen && (
            <>
              <Button
                size="sm"
                variant="secondary"
                className="min-h-11 shadow-fab rounded-full px-4"
                onClick={() => {
                  setFabOpen(false);
                  openOcrSheet();
                }}
              >
                <ScanText size={16} className="mr-1.5" />
                OCR
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="min-h-11 shadow-fab rounded-full px-4"
                onClick={() => {
                  setFabOpen(false);
                  openCreateRecord();
                }}
              >
                <Plus size={16} className="mr-1.5" />
                新建病历
              </Button>
            </>
          )}
          <Button
            size="sm"
            className="min-h-12 min-w-12 shadow-fab rounded-full px-0 w-12"
            aria-expanded={fabOpen}
            aria-label={fabOpen ? "收起" : "创建"}
            onClick={() => setFabOpen((v) => !v)}
          >
            {fabOpen ? <X size={20} /> : <Plus size={20} />}
          </Button>
        </div>
      )}

      {/* 成员表单 */}
      <BottomSheet open={showMemberForm} onClose={() => setShowMemberForm(false)} title="添加家庭成员">
        <div className="space-y-3 p-1">
          <Field label="姓名 *">
            <input
              className={fieldControlClass}
              value={memberName}
              onChange={(e) => setMemberName(e.target.value)}
              placeholder="如：小明"
            />
          </Field>
          <Field label="关系">
            <select
              className={fieldControlClass}
              value={memberRel}
              onChange={(e) => setMemberRel(e.target.value)}
            >
              {REL_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field label="出生日期">
            <input
              type="date"
              className={fieldControlClass}
              value={memberBirth}
              onChange={(e) => setMemberBirth(e.target.value)}
            />
          </Field>
          <Button className="w-full min-h-11" disabled={savingMember} onClick={saveMember}>
            {savingMember ? <Loader2 className="animate-spin" size={18} /> : "创建（含默认病历本）"}
          </Button>
        </div>
      </BottomSheet>

      {/* 病历本 */}
      <BottomSheet open={showBookForm} onClose={() => setShowBookForm(false)} title="新建病历本">
        <div className="space-y-3 p-1">
          <Field label="名称 *">
            <input
              className={fieldControlClass}
              value={bookTitle}
              onChange={(e) => setBookTitle(e.target.value)}
              placeholder="如：儿科、口腔"
            />
          </Field>
          <Button className="w-full min-h-11" disabled={savingBook} onClick={saveBook}>
            {savingBook ? <Loader2 className="animate-spin" size={18} /> : "创建"}
          </Button>
        </div>
      </BottomSheet>

      {/* 病历表单 */}
      <BottomSheet
        open={showRecordForm}
        onClose={() => setShowRecordForm(false)}
        title={editingId ? "编辑病历" : "新建病历"}
      >
        <div className="space-y-3 p-1 max-h-[70vh] overflow-y-auto">
          <Field label="标题 / 疾病简称 *">
            <input
              className={fieldControlClass}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <Field label="医疗体系 *">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  ["western", "西医"],
                  ["tcm", "中医"],
                  ["integrated", "中西医结合"],
                  ["unknown", "暂不区分"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setForm({ ...form, medicineSystem: id })}
                  className={cn(
                    "min-h-11 rounded-button text-xs font-medium border",
                    form.medicineSystem === id
                      ? "bg-accent-primary text-white border-transparent"
                      : "bg-app-surface border-app-border text-tx-secondary",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="类型">
              <select
                className={fieldControlClass}
                value={form.recordType}
                onChange={(e) => setForm({ ...form, recordType: e.target.value })}
              >
                {Object.entries(TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="状态">
              <select
                className={fieldControlClass}
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="就诊日期 *">
              <input
                type="date"
                className={fieldControlClass}
                value={form.occurredAt}
                onChange={(e) => setForm({ ...form, occurredAt: e.target.value })}
              />
            </Field>
            <Field
              label={
                form.recordType === "hospitalization"
                  ? "出院日期"
                  : form.recordType === "infusion"
                    ? "结束日期"
                    : "结束/出院"
              }
            >
              <input
                type="date"
                className={fieldControlClass}
                value={form.endedAt}
                onChange={(e) => setForm({ ...form, endedAt: e.target.value })}
              />
            </Field>
          </div>
          {form.recordType === "hospitalization" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="病区/病房">
                <input
                  className={fieldControlClass}
                  value={form.careWard}
                  onChange={(e) => setForm({ ...form, careWard: e.target.value })}
                />
              </Field>
              <Field label="床号">
                <input
                  className={fieldControlClass}
                  value={form.careBed}
                  onChange={(e) => setForm({ ...form, careBed: e.target.value })}
                />
              </Field>
            </div>
          )}
          {form.recordType === "surgery" && (
            <>
              <Field label="手术名称">
                <input
                  className={fieldControlClass}
                  value={form.careSurgeryName}
                  onChange={(e) =>
                    setForm({ ...form, careSurgeryName: e.target.value })
                  }
                />
              </Field>
              <Field label="主刀医生">
                <input
                  className={fieldControlClass}
                  value={form.careSurgeon}
                  onChange={(e) => setForm({ ...form, careSurgeon: e.target.value })}
                />
              </Field>
            </>
          )}
          {form.recordType === "infusion" && (
            <>
              <Field label="输液药品">
                <input
                  className={fieldControlClass}
                  value={form.careInfusionDrug}
                  onChange={(e) =>
                    setForm({ ...form, careInfusionDrug: e.target.value })
                  }
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="剂量/容量">
                  <input
                    className={fieldControlClass}
                    value={form.careInfusionVolume}
                    onChange={(e) =>
                      setForm({ ...form, careInfusionVolume: e.target.value })
                    }
                    placeholder="如 250ml"
                  />
                </Field>
                <Field label="部位">
                  <input
                    className={fieldControlClass}
                    value={form.careInfusionSite}
                    onChange={(e) =>
                      setForm({ ...form, careInfusionSite: e.target.value })
                    }
                    placeholder="左手背等"
                  />
                </Field>
              </div>
            </>
          )}
          <Field label="医院">
            <input
              className={fieldControlClass}
              value={form.hospital}
              onChange={(e) => setForm({ ...form, hospital: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="科室">
              <input
                className={fieldControlClass}
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
              />
            </Field>
            <Field label="医生">
              <input
                className={fieldControlClass}
                value={form.doctor}
                onChange={(e) => setForm({ ...form, doctor: e.target.value })}
              />
            </Field>
          </div>
          {(form.medicineSystem === "western" ||
            form.medicineSystem === "integrated" ||
            form.medicineSystem === "unknown") && (
            <Field label="西医诊断">
              <textarea
                className={cn(fieldControlClass, "min-h-[64px]")}
                value={form.diagnosisWestern}
                onChange={(e) => setForm({ ...form, diagnosisWestern: e.target.value })}
                placeholder="如：急性上呼吸道感染"
              />
            </Field>
          )}
          {(form.medicineSystem === "tcm" ||
            form.medicineSystem === "integrated" ||
            form.medicineSystem === "unknown") && (
            <Field label="中医病名 / 证候">
              <textarea
                className={cn(fieldControlClass, "min-h-[64px]")}
                value={form.diagnosisTcm}
                onChange={(e) => setForm({ ...form, diagnosisTcm: e.target.value })}
                placeholder="如：小儿咳嗽病（痰热壅肺证）"
              />
            </Field>
          )}
          <Field
            label={
              form.medicineSystem === "tcm"
                ? "中药方 / 处方原文"
                : form.medicineSystem === "western"
                  ? "西药处方原文"
                  : "处方原文（中药方或西药）"
            }
          >
            <textarea
              className={cn(fieldControlClass, "min-h-[88px]")}
              value={form.prescription}
              onChange={(e) => setForm({ ...form, prescription: e.target.value })}
              placeholder={
                form.medicineSystem === "tcm"
                  ? "药味+克数、剂数、煎服法…"
                  : "药品、规格、用法用量…"
              }
            />
          </Field>
          <Field label="医嘱 / 建议">
            <textarea
              className={cn(fieldControlClass, "min-h-[64px]")}
              value={form.advice}
              onChange={(e) => setForm({ ...form, advice: e.target.value })}
            />
          </Field>
          <Field label="阶段症状（每行一条，可用「日期 标签：症状」）">
            <textarea
              className={cn(fieldControlClass, "min-h-[88px]")}
              value={form.stagesText}
              onChange={(e) => setForm({ ...form, stagesText: e.target.value })}
              placeholder={"2026-03-01 发病：发烧咳嗽\n2026-03-03 就诊后：退烧"}
            />
          </Field>
          <Field label="费用（元）">
            <input
              className={fieldControlClass}
              inputMode="decimal"
              value={form.costYuan}
              onChange={(e) => setForm({ ...form, costYuan: e.target.value })}
            />
          </Field>
          <Field label="备注">
            <textarea
              className={cn(fieldControlClass, "min-h-[56px]")}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
          <Button className="w-full min-h-11" disabled={savingRecord} onClick={saveRecord}>
            {savingRecord ? <Loader2 className="animate-spin" size={18} /> : "保存"}
          </Button>
        </div>
      </BottomSheet>

      {/* OCR：支持新建 / 合并到已有病历（先检查后开方） */}
      <BottomSheet open={showOcr} onClose={() => !ocrBusy && setShowOcr(false)} title="OCR 识别填充">
        <div className="space-y-3 p-1 max-h-[75vh] overflow-y-auto">
          <p className="text-xs text-tx-tertiary leading-relaxed">
            上传病历 / 处方 / 发票 / 化验单。可「新建病历」，或「合并到已有」——适合先检查再开方：检查 OCR
            写入一条，处方 OCR 再合并进去。合并时：空字段直接填；已有内容冲突则写入备注，附件始终挂上。
          </p>

          <Field label="写入方式">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={ocrBusy}
                onClick={() => setOcrWriteMode("create")}
                className={cn(
                  "min-h-11 rounded-button text-sm font-medium border",
                  ocrWriteMode === "create"
                    ? "bg-accent-primary text-white border-transparent"
                    : "bg-app-surface border-app-border text-tx-secondary",
                )}
              >
                新建病历
              </button>
              <button
                type="button"
                disabled={ocrBusy || records.length === 0}
                onClick={() => {
                  setOcrWriteMode("merge");
                  if (!ocrTargetRecordId && records[0]) {
                    setOcrTargetRecordId(records[0].id);
                  }
                }}
                className={cn(
                  "min-h-11 rounded-button text-sm font-medium border",
                  ocrWriteMode === "merge"
                    ? "bg-accent-primary text-white border-transparent"
                    : "bg-app-surface border-app-border text-tx-secondary",
                  records.length === 0 && "opacity-50",
                )}
              >
                合并到已有
              </button>
            </div>
            {records.length === 0 && (
              <p className="text-[11px] text-tx-tertiary mt-1">
                当前时间轴暂无病历，请先新建或放宽日期筛选。
              </p>
            )}
          </Field>

          {ocrWriteMode === "merge" && (
            <Field label="目标病历">
              <select
                className={fieldControlClass}
                value={ocrTargetRecordId || ""}
                onChange={(e) => setOcrTargetRecordId(e.target.value || null)}
                disabled={ocrBusy}
              >
                <option value="">请选择…</option>
                {records.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.occurredAt} · {r.title}
                    {r.diagnosis ? `（${String(r.diagnosis).slice(0, 20)}）` : ""}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-tx-tertiary mt-1">
                列表来自当前病历本与时间筛选；先检查后开方时，选检查那天的那条再合并处方。
              </p>
            </Field>
          )}

          <Field label="附件类型">
            <select
              className={fieldControlClass}
              value={ocrKind}
              onChange={(e) => setOcrKind(e.target.value)}
              disabled={ocrBusy}
            >
              {Object.entries(KIND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            {ocrKind === "exam_lab" && (
              <p className="text-[11px] text-tx-tertiary mt-1">
                检查结果写入「检查结论 / 化验项目」，不会占用处方字段。多页报告可加多张图。
              </p>
            )}
          </Field>

          {ocrPreviews.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {ocrPreviews.map((url, i) => (
                <div
                  key={url}
                  className="relative shrink-0 w-20 h-20 rounded-card overflow-hidden border border-app-border"
                >
                  <img src={url} alt={`报告 ${i + 1}`} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    disabled={ocrBusy}
                    onClick={() => removeRecordOcrImage(i)}
                    className="absolute top-0.5 right-0.5 min-w-7 min-h-7 rounded-full bg-black/60 text-white text-xs"
                    aria-label="删除"
                  >
                    ×
                  </button>
                  <span className="absolute bottom-0 inset-x-0 text-[10px] text-center bg-black/50 text-white">
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
                <span className="text-sm text-tx-secondary">处理中…</span>
              </>
            ) : (
              <>
                <Upload size={22} className="text-tx-tertiary" />
                <span className="text-sm text-tx-secondary">
                  {ocrAttachmentIds.length
                    ? `继续添加（${ocrAttachmentIds.length}/6）`
                    : "选择图片（可多选，报告多页）"}
                </span>
              </>
            )}
            <input
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void addRecordOcrFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>

          {ocrAttachmentIds.length > 0 && !ocrStructured && (
            <Button
              className="w-full min-h-11"
              disabled={ocrBusy}
              onClick={() => void runRecordMultiOcr()}
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
            <div className="space-y-2 rounded-card border border-app-border p-3 bg-app-surface">
              <div className="text-sm font-semibold text-tx-primary">
                识别结果（可改）
                {ocrAttachmentIds.length > 1
                  ? ` · 已综合 ${ocrAttachmentIds.length} 张`
                  : ""}
              </div>
              {ocrStructured.warnings?.length ? (
                <ul className="text-xs text-accent-warning space-y-0.5">
                  {ocrStructured.warnings.map((w, i) => (
                    <li key={i}>· {w}</li>
                  ))}
                </ul>
              ) : null}
              <Field label="医疗体系">
                <select
                  className={fieldControlClass}
                  value={ocrStructured.medicineSystem || "unknown"}
                  onChange={(e) =>
                    setOcrStructured({
                      ...ocrStructured,
                      medicineSystem: e.target.value as any,
                    })
                  }
                >
                  {Object.entries(SYSTEM_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              {(
                [
                  ["title", "标题"],
                  ["occurredAt", "日期"],
                  ["hospital", "医院"],
                  ["department", "科室"],
                  ["doctor", "医生"],
                  ["diagnosisWestern", "西医诊断"],
                  ["diagnosisTcm", "中医证候"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
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
                </Field>
              ))}

              {/* 检查专用：不占用处方 */}
              {(ocrKind === "exam_lab" ||
                ocrStructured.documentType?.includes("exam") ||
                ocrStructured.examFindings ||
                (ocrStructured.labs && ocrStructured.labs.length > 0)) && (
                <>
                  <Field label="检查结论 / 影像所见">
                    <textarea
                      className={cn(fieldControlClass, "min-h-[72px]")}
                      value={ocrStructured.examFindings || ""}
                      onChange={(e) =>
                        setOcrStructured({
                          ...ocrStructured,
                          examFindings: e.target.value,
                        })
                      }
                      placeholder="总评、所见、结论…"
                    />
                  </Field>
                  {(ocrStructured.labs || []).length > 0 && (
                    <div className="rounded-card border border-app-border overflow-hidden">
                      <div className="text-xs font-medium px-2 py-1.5 bg-app-elevated">
                        化验项目（{ocrStructured.labs!.length}）
                      </div>
                      <div className="max-h-40 overflow-y-auto text-xs">
                        <table className="w-full">
                          <thead>
                            <tr className="text-tx-tertiary text-left">
                              <th className="p-1.5 font-medium">项目</th>
                              <th className="p-1.5 font-medium">结果</th>
                              <th className="p-1.5 font-medium">参考</th>
                              <th className="p-1.5 font-medium">标记</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ocrStructured.labs!.map((lab, i) => (
                              <tr key={i} className="border-t border-app-border">
                                <td className="p-1.5">{lab.name}</td>
                                <td className="p-1.5">
                                  {lab.value}
                                  {lab.unit || ""}
                                </td>
                                <td className="p-1.5 text-tx-tertiary">
                                  {lab.refRange || "—"}
                                </td>
                                <td className="p-1.5">{lab.flag || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* 非检查单才显示处方编辑 */}
              {ocrKind !== "exam_lab" &&
                !ocrStructured.documentType?.includes("exam") && (
                  <Field label="处方">
                    <textarea
                      className={cn(fieldControlClass, "min-h-[64px]")}
                      value={ocrStructured.prescription || ""}
                      onChange={(e) =>
                        setOcrStructured({
                          ...ocrStructured,
                          prescription: e.target.value,
                        })
                      }
                    />
                  </Field>
                )}
              <Field label="建议">
                <input
                  className={fieldControlClass}
                  value={ocrStructured.advice || ""}
                  onChange={(e) =>
                    setOcrStructured({
                      ...ocrStructured,
                      advice: e.target.value,
                    })
                  }
                />
              </Field>
              <Button
                className="w-full min-h-11"
                disabled={
                  ocrApplying ||
                  (ocrWriteMode === "merge" && !ocrTargetRecordId)
                }
                onClick={() => void applyOcr()}
              >
                {ocrApplying ? (
                  <Loader2 className="animate-spin" size={18} />
                ) : ocrWriteMode === "merge" ? (
                  "确认合并到已有病历"
                ) : (
                  "确认创建新病历"
                )}
              </Button>
            </div>
          )}
        </div>
      </BottomSheet>

      {/* 详情：桌面 AppModal（可靠可见）；移动 BottomSheet */}
      {(() => {
        const detailBody = (
          <div className="space-y-4 overflow-y-auto min-h-0 px-1 pb-4">
            {detailLoading && !detail ? (
              <LoadingBlock label="加载详情…" />
            ) : detailError && !detail ? (
              <div className="space-y-3">
                <ErrorBanner message={detailError} />
                <Button className="w-full min-h-11" variant="secondary" onClick={closeDetail}>
                  关闭
                </Button>
              </div>
            ) : detail ? (
              <>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="px-2 py-1 rounded-full bg-app-elevated">
                    {detail.occurredAt}
                  </span>
                  <span
                    className={cn(
                      "px-2 py-1 rounded-full font-medium",
                      systemBadgeClass(detail.medicineSystem),
                    )}
                  >
                    {SYSTEM_LABEL[detail.medicineSystem || "unknown"] || "未区分"}
                  </span>
                  <span
                    className={cn(
                      "px-2 py-1 rounded-full font-medium",
                      recordStatusBadgeClass(detail.status),
                    )}
                  >
                    {STATUS_LABEL[detail.status] || detail.status}
                  </span>
                  <span className="px-2 py-1 rounded-full bg-app-elevated">
                    {TYPE_LABEL[detail.recordType] || detail.recordType}
                  </span>
                </div>
                <DetailRow label="医院" value={detail.hospital} />
                <DetailRow label="科室" value={detail.department} />
                <DetailRow label="医生" value={detail.doctor} />
                {detail.recordType === "hospitalization" && (
                  <>
                    <DetailRow
                      label="病区"
                      value={String((detail.careExtra as any)?.ward || "")}
                    />
                    <DetailRow
                      label="床号"
                      value={String((detail.careExtra as any)?.bedNo || "")}
                    />
                  </>
                )}
                {detail.recordType === "surgery" && (
                  <>
                    <DetailRow
                      label="手术"
                      value={String((detail.careExtra as any)?.surgeryName || "")}
                    />
                    <DetailRow
                      label="主刀"
                      value={String((detail.careExtra as any)?.surgeon || "")}
                    />
                  </>
                )}
                {detail.recordType === "infusion" && (
                  <>
                    <DetailRow
                      label="输液药"
                      value={String((detail.careExtra as any)?.drugName || "")}
                    />
                    <DetailRow
                      label="容量"
                      value={String((detail.careExtra as any)?.volume || "")}
                    />
                    <DetailRow
                      label="部位"
                      value={String((detail.careExtra as any)?.site || "")}
                    />
                  </>
                )}
                <DetailRow label="西医诊断" value={detail.diagnosisWestern} />
                <DetailRow label="中医病名/证候" value={detail.diagnosisTcm} />
                {!detail.diagnosisWestern &&
                  !detail.diagnosisTcm &&
                  detail.diagnosis && (
                    <DetailRow label="诊断" value={detail.diagnosis} />
                  )}

                {/* 检查专用区：careExtra.examFindings / labs */}
                {!!(detail.careExtra as any)?.examFindings && (
                  <DetailRow
                    label="检查结论"
                    value={String((detail.careExtra as any).examFindings)}
                  />
                )}
                {Array.isArray((detail.careExtra as any)?.labs) &&
                  (detail.careExtra as any).labs.length > 0 && (
                    <div>
                      <div className="text-xs text-tx-tertiary mb-1">化验项目</div>
                      <div className="rounded-card border border-app-border overflow-hidden text-xs">
                        <table className="w-full">
                          <thead>
                            <tr className="bg-app-elevated text-tx-tertiary text-left">
                              <th className="p-2 font-medium">项目</th>
                              <th className="p-2 font-medium">结果</th>
                              <th className="p-2 font-medium">参考</th>
                              <th className="p-2 font-medium">标记</th>
                            </tr>
                          </thead>
                          <tbody>
                            {((detail.careExtra as any).labs as any[]).map(
                              (lab, i) => (
                                <tr
                                  key={i}
                                  className={cn(
                                    "border-t border-app-border",
                                    lab.flag &&
                                      /高|↑|H|abnormal|阳/i.test(String(lab.flag)) &&
                                      "bg-accent-warning/10",
                                  )}
                                >
                                  <td className="p-2">{lab.name}</td>
                                  <td className="p-2">
                                    {lab.value}
                                    {lab.unit || ""}
                                  </td>
                                  <td className="p-2 text-tx-tertiary">
                                    {lab.refRange || "—"}
                                  </td>
                                  <td className="p-2">{lab.flag || "—"}</td>
                                </tr>
                              ),
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                <DetailRow
                  label={
                    detail.medicineSystem === "tcm" ? "中药方 / 处方" : "处方"
                  }
                  value={detail.prescription}
                />
                <DetailRow label="建议" value={detail.advice} />
                <DetailRow label="备注" value={detail.notes} />
                {(detail.medicineSystem === "integrated" ||
                  (detail.diagnosisWestern && detail.diagnosisTcm)) && (
                  <p className="text-[11px] text-tx-tertiary leading-relaxed">
                    本条同时含中西医信息，仅作家庭档案记录；中西药并用请遵医嘱，不能替代面诊。
                  </p>
                )}
                {detail.costMinor != null && (
                  <DetailRow
                    label="费用"
                    value={`¥${(detail.costMinor / 100).toFixed(2)}`}
                  />
                )}

                <div>
                  <div className="text-sm font-semibold text-tx-primary mb-2">阶段症状</div>
                  {(detail.stages || []).length === 0 ? (
                    <p className="text-xs text-tx-tertiary">暂无阶段记录</p>
                  ) : (
                    <ul className="space-y-2">
                      {(detail.stages || []).map((s) => (
                        <li
                          key={s.id}
                          className="rounded-card border border-app-border p-2 text-sm"
                        >
                          <div className="text-xs text-tx-tertiary">
                            {[s.stageDate, s.label].filter(Boolean).join(" · ")}
                          </div>
                          <div className="text-tx-primary mt-0.5 whitespace-pre-wrap">
                            {s.symptoms}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <div className="text-sm font-semibold text-tx-primary mb-2">附件</div>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {Object.entries(KIND_LABEL).map(([kind, label]) => (
                      <label
                        key={kind}
                        className="min-h-11 px-3 rounded-button bg-app-elevated text-xs flex items-center gap-1 cursor-pointer"
                      >
                        <Upload size={14} />
                        {label}
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadToDetail(f, kind);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  {(detail.attachments || []).length === 0 ? (
                    <p className="text-xs text-tx-tertiary">暂无附件</p>
                  ) : (
                    <ul className="space-y-2">
                      {(detail.attachments || []).map((a: HealthAttachment) => (
                        <li
                          key={a.id}
                          className="flex items-center justify-between gap-2 rounded-card border border-app-border p-2 text-sm"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {KIND_LABEL[a.kind] || a.kind} · {a.filename}
                            </div>
                            <div className="text-[10px] text-tx-tertiary">
                              OCR: {a.ocrStatus}
                              {a.mimeType?.startsWith("image/") && a.url ? (
                                <a
                                  className="ml-2 text-accent-primary underline"
                                  href={authAssetUrl(a.url)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  预览
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-2 sticky bottom-0 bg-app-surface/95 backdrop-blur-sm pb-1">
                  {!!(detail.prescription || "").trim() && (
                    <Button
                      variant="secondary"
                      className="flex-1 min-h-11"
                      onClick={() => sendPrescriptionToCabinet(detail)}
                    >
                      <Package size={16} className="mr-1.5" />
                      加入药箱
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    className="flex-1 min-h-11"
                    onClick={() => {
                      closeDetail();
                      openOcrSheet({ mergeToRecordId: detail.id });
                    }}
                  >
                    <ScanText size={16} className="mr-1.5" />
                    OCR 合并
                  </Button>
                  <Button
                    variant="secondary"
                    className="flex-1 min-h-11"
                    onClick={() => openEditFromDetail(detail)}
                  >
                    编辑
                  </Button>
                  <Button
                    variant="secondary"
                    className="min-h-11 text-accent-danger"
                    onClick={() => deleteRecord(detail.id)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-tx-tertiary">暂无数据</p>
            )}
          </div>
        );

        if (isDesktop) {
          return detailOpen ? (
            <AppModal
              title={detail?.title || "病历详情"}
              onClose={closeDetail}
              widthClass="max-w-lg"
              heightClass="max-h-[88vh]"
            >
              <div className="p-4 min-h-0 flex-1 overflow-y-auto">{detailBody}</div>
            </AppModal>
          ) : null;
        }

        return (
          <BottomSheet
            open={detailOpen}
            onClose={closeDetail}
            title={detail?.title || "病历详情"}
            maxHeight="min(92dvh, 100%)"
            zClassName="z-modal"
          >
            {detailBody}
          </BottomSheet>
        );
      })()}
    </ModuleShell>
  );
}

function emptyForm() {
  return {
    title: "",
    recordType: "visit",
    status: "ongoing",
    medicineSystem: "unknown",
    occurredAt: todayISO(),
    endedAt: "",
    hospital: "",
    department: "",
    doctor: "",
    diagnosisWestern: "",
    diagnosisTcm: "",
    diagnosis: "",
    prescription: "",
    advice: "",
    notes: "",
    costYuan: "",
    careWard: "",
    careBed: "",
    careSurgeryName: "",
    careSurgeon: "",
    careInfusionDrug: "",
    careInfusionVolume: "",
    careInfusionSite: "",
    stagesText: "",
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-tx-secondary">{label}</span>
      {children}
    </label>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-xs text-tx-tertiary">{label}</div>
      <div className="text-sm text-tx-primary whitespace-pre-wrap mt-0.5">{value}</div>
    </div>
  );
}
