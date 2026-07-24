import React, { useCallback, useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Key,
  Loader2,
  CheckCircle2,
  Eye,
  EyeOff,
  User,
  Smartphone,
  Copy,
  Download,
  LogOut,
  RefreshCw,
  Monitor,
  Lock,
  Camera,
  Plus,
  Minus,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { api, broadcastLogout, withSudo, getServerUrl } from "@/lib/api";
import {
  confirm as confirmDialog,
  prompt as promptDialog,
} from "@/components/ui/confirm";

function QRCodeCanvas({ text }: { text: string }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(
        canvasRef.current,
        text,
        {
          width: 160,
          margin: 2,
          color: {
            dark: "#1e1b4b", // Indigo 950
            light: "#ffffff",
          },
        },
        (error) => {
          if (error) console.error("[2fa] qr generation failed:", error);
        }
      );
    }
  }, [text]);

  return (
    <div className="flex justify-center p-2.5 bg-white rounded-2xl border border-zinc-200/80 shadow-inner w-fit mx-auto transition-all duration-300">
      <canvas ref={canvasRef} className="rounded-lg" />
    </div>
  );
}

function AvatarCropModal({
  file,
  onClose,
  onCrop,
}: {
  file: File;
  onClose: () => void;
  onCrop: (blob: Blob) => void;
}) {
  const { t } = useTranslation();
  const [imageSrc, setImageSrc] = useState<string>("");
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
    };
    reader.readAsDataURL(file);
  }, [file]);

  const handleStart = (clientX: number, clientY: number) => {
    setIsDragging(true);
    setDragStart({ x: clientX - offsetX, y: clientY - offsetY });
  };

  const handleMove = (clientX: number, clientY: number) => {
    if (!isDragging) return;
    setOffsetX(clientX - dragStart.x);
    setOffsetY(clientY - dragStart.y);
  };

  const handleEnd = () => {
    setIsDragging(false);
  };

  const handleConfirm = () => {
    if (!imageSrc) return;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 256, 256);

    const img = new Image();
    img.onload = () => {
      const imgWidth = img.naturalWidth;
      const imgHeight = img.naturalHeight;
      const ratio = Math.min(280 / imgWidth, 280 / imgHeight);
      const fitWidth = imgWidth * ratio;
      const fitHeight = imgHeight * ratio;
      const drawWidth = fitWidth * zoom;
      const drawHeight = fitHeight * zoom;

      const centerX = 140 + offsetX;
      const centerY = 140 + offsetY;
      const xInContainer = centerX - drawWidth / 2;
      const yInContainer = centerY - drawHeight / 2;

      const xInCrop = xInContainer - 60; // 60 is (280 - 160) / 2
      const yInCrop = yInContainer - 60;

      const scaleFactor = 256 / 160;
      const canvasX = xInCrop * scaleFactor;
      const canvasY = yInCrop * scaleFactor;
      const canvasWidth = drawWidth * scaleFactor;
      const canvasHeight = drawHeight * scaleFactor;

      ctx.drawImage(img, canvasX, canvasY, canvasWidth, canvasHeight);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            onCrop(blob);
          }
        },
        "image/jpeg",
        0.9
      );
    };
    img.src = imageSrc;
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-200">
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-sm flex flex-col overflow-hidden p-5 space-y-4">
        <h3 className="font-bold text-tx-primary text-center">
          {t("securitySettings.cropTitle", { defaultValue: "编辑头像" })}
        </h3>

        {/* Cropper viewport container */}
        <div
          className="w-[280px] h-[280px] mx-auto bg-neutral-100 dark:bg-neutral-900 border border-border rounded-xl relative overflow-hidden select-none cursor-move touch-none"
          onMouseDown={(e) => {
            e.preventDefault();
            handleStart(e.clientX, e.clientY);
          }}
          onMouseMove={(e) => handleMove(e.clientX, e.clientY)}
          onMouseUp={handleEnd}
          onMouseLeave={handleEnd}
          onTouchStart={(e) => {
            const touch = e.touches[0];
            if (touch) handleStart(touch.clientX, touch.clientY);
          }}
          onTouchMove={(e) => {
            const touch = e.touches[0];
            if (touch) handleMove(touch.clientX, touch.clientY);
          }}
          onTouchEnd={handleEnd}
        >
          {imageSrc && (
            <img
              src={imageSrc}
              alt=""
              className="absolute pointer-events-none select-none max-w-none origin-center"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                transform: `translate(${offsetX}px, ${offsetY}px) scale(${zoom})`,
              }}
            />
          )}
          {/* Circular mask overlay */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-[160px] h-[160px] rounded-full ring-[999px] ring-black/55 border-2 border-white/80 shadow-[0_0_8px_rgba(0,0,0,0.3)]" />
          </div>
        </div>

        {/* Zoom Controls */}
        <div className="space-y-1.5 px-2">
          <div className="flex items-center justify-between text-xs text-tx-secondary font-medium">
            <span>{t("securitySettings.zoom", { defaultValue: "缩放" })}</span>
            <span>{Math.round(zoom * 100)}%</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
              className="p-1.5 rounded-lg border border-border bg-background hover:bg-accent text-tx-secondary active:scale-95 transition-all"
              type="button"
            >
              <Minus size={14} />
            </button>
            <input
              type="range"
              min={0.5}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="flex-1 accent-indigo-600 h-1 bg-neutral-200 dark:bg-neutral-700 rounded-lg cursor-pointer"
            />
            <button
              onClick={() => setZoom((z) => Math.min(3, z + 0.1))}
              className="p-1.5 rounded-lg border border-border bg-background hover:bg-accent text-tx-secondary active:scale-95 transition-all"
              type="button"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        <p className="text-center text-[11px] text-tx-tertiary">
          {t("securitySettings.cropTip", { defaultValue: "可通过拖拽图片或使用缩放条调整头像" })}
        </p>

        {/* Footer actions */}
        <div className="flex justify-end gap-2.5 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-tx-secondary rounded-xl text-xs font-medium transition-colors"
            type="button"
          >
            {t("common.cancel", { defaultValue: "取消" })}
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-medium transition-colors shadow-sm"
            type="button"
          >
            {t("common.confirm", { defaultValue: "确认" })}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfileSection({ user, onUpdate }: { user: any; onUpdate: () => void }) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSuccess, setNameSuccess] = useState(false);
  const [nameError, setNameError] = useState("");

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || "");
    }
  }, [user?.id, user?.displayName]);

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const uploadFile = async (fileToUpload: File) => {
    setSelectedFile(null);
    setError("");
    setIsUploading(true);

    const formData = new FormData();
    formData.append("file", fileToUpload);

    try {
      const res = await api.uploadAvatar(formData);
      if (res.success) {
        onUpdate();
        // Dispatch custom event to notify NavRail to update
        window.dispatchEvent(new CustomEvent("super:profile-updated"));
      } else {
        setError(t("securitySettings.uploadFailed", { defaultValue: "上传头像失败" }));
      }
    } catch (err: any) {
      setError(err?.message || t("securitySettings.uploadFailed", { defaultValue: "上传头像失败" }));
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteAvatar = async () => {
    if (!window.confirm(t("securitySettings.confirmDeleteAvatar", { defaultValue: "确认要删除头像吗？" }))) {
      return;
    }

    setError("");
    try {
      await api.deleteAvatar();
      onUpdate();
      window.dispatchEvent(new CustomEvent("super:profile-updated"));
    } catch (err: any) {
      setError(err?.message || t("securitySettings.deleteAvatarFailed", { defaultValue: "删除头像失败" }));
    }
  };

  const handleSaveDisplayName = async () => {
    const trimmed = displayName.trim();
    if (trimmed.length > 32) {
      setNameError(
        t("securitySettings.displayNameTooLong", { defaultValue: "昵称不能超过 32 个字符" }),
      );
      return;
    }
    const current = (user?.displayName || "").trim();
    if (trimmed === current) {
      setNameError(
        t("securitySettings.displayNameUnchanged", { defaultValue: "昵称未修改" }),
      );
      return;
    }

    setNameError("");
    setNameSuccess(false);
    setNameSaving(true);
    try {
      await api.updateMe({ displayName: trimmed.length === 0 ? null : trimmed });
      setNameSuccess(true);
      onUpdate();
      window.dispatchEvent(new CustomEvent("super:profile-updated"));
      window.setTimeout(() => setNameSuccess(false), 2500);
    } catch (err: any) {
      setNameError(
        err?.message ||
          t("securitySettings.displayNameSaveFailed", { defaultValue: "保存昵称失败" }),
      );
    } finally {
      setNameSaving(false);
    }
  };

  if (!user) return null;

  const firstChar = user.displayName ? user.displayName[0] : (user.username ? user.username[0] : "");
  const avatarUrl = user.avatarUrl ? (user.avatarUrl.startsWith("http") ? user.avatarUrl : (getServerUrl() + user.avatarUrl)) : null;
  const nameDirty = displayName.trim() !== (user.displayName || "").trim();

  return (
    <section className="border-b border-app-border pb-8">
      <div className="flex items-center gap-2 mb-1">
        <User className="w-4 h-4 text-indigo-500" />
        <h3 className="text-lg font-bold text-tx-primary">{t('securitySettings.profileTitle', { defaultValue: "个人资料" })}</h3>
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
        {t('securitySettings.profileDescription', { defaultValue: "设置您的个人头像和公开资料。" })}
      </p>

      <div className="flex items-center gap-6">
        <div className="relative group cursor-pointer" onClick={handleAvatarClick}>
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt="Avatar"
              className="w-20 h-20 rounded-full object-cover border-2 border-indigo-500/20 group-hover:border-indigo-500 transition-all duration-300"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-indigo-500/10 text-indigo-500 flex items-center justify-center text-2xl font-bold border-2 border-indigo-500/20 group-hover:border-indigo-500 transition-all duration-300">
              {firstChar.toUpperCase()}
            </div>
          )}
          <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            {isUploading ? (
              <Loader2 className="w-6 h-6 text-white animate-spin" />
            ) : (
              <Camera className="w-6 h-6 text-white" />
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex gap-3">
            <button
              onClick={handleAvatarClick}
              disabled={isUploading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium transition-colors shadow-sm disabled:opacity-50"
            >
              {t('securitySettings.uploadAvatar', { defaultValue: "上传新头像" })}
            </button>
            {user.avatarUrl && (
              <button
                onClick={handleDeleteAvatar}
                className="px-4 py-2 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-red-500 rounded-xl text-sm font-medium transition-colors"
              >
                {t('securitySettings.deleteAvatar', { defaultValue: "删除头像" })}
              </button>
            )}
          </div>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            {t('securitySettings.avatarLimit', { defaultValue: "支持 JPG, PNG, GIF, WEBP, SVG 格式，最大 5MB。" })}
          </p>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </div>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
      />

      {selectedFile && (
        <AvatarCropModal
          file={selectedFile}
          onClose={() => setSelectedFile(null)}
          onCrop={(blob) => {
            const croppedFile = new File([blob], selectedFile.name, { type: "image/jpeg" });
            uploadFile(croppedFile);
          }}
        />
      )}

      {/* 昵称 */}
      <div className="mt-8 space-y-4 max-w-md">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-tx-secondary">
            {t("securitySettings.usernameLabel", { defaultValue: "用户名" })}
          </label>
          <input
            type="text"
            value={user.username || ""}
            readOnly
            disabled
            className="w-full px-3 py-2.5 rounded-xl border border-app-border bg-app-sidebar/40 text-sm text-tx-tertiary cursor-not-allowed"
          />
          <p className="text-[11px] text-tx-tertiary">
            {t("securitySettings.usernameHint", {
              defaultValue: "登录用的账号名，如需修改请在下方「账号与安全」中操作。",
            })}
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-tx-secondary" htmlFor="profile-display-name">
            {t("securitySettings.displayNameLabel", { defaultValue: "昵称" })}
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id="profile-display-name"
              type="text"
              value={displayName}
              maxLength={32}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setNameError("");
                setNameSuccess(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSaveDisplayName();
                }
              }}
              placeholder={t("securitySettings.displayNamePlaceholder", {
                defaultValue: "显示在首页问候、协作评论等处",
              })}
              className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-app-border bg-app-bg text-sm text-tx-primary outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all"
            />
            <button
              type="button"
              onClick={() => void handleSaveDisplayName()}
              disabled={nameSaving || !nameDirty}
              className="shrink-0 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 min-h-[42px]"
            >
              {nameSaving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {t("common.saving", { defaultValue: "保存中…" })}
                </>
              ) : (
                t("common.save", { defaultValue: "保存" })
              )}
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-tx-tertiary">
              {t("securitySettings.displayNameHint", {
                defaultValue: "留空则对外显示用户名。最多 32 字。",
              })}
            </p>
            <span className="text-[10px] text-tx-tertiary tabular-nums shrink-0">
              {displayName.trim().length}/32
            </span>
          </div>
          {nameError && (
            <p className="text-xs text-red-500 flex items-center gap-1">{nameError}</p>
          )}
          {nameSuccess && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <CheckCircle2 size={12} />
              {t("securitySettings.displayNameSaved", { defaultValue: "昵称已保存" })}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function CaptchaSection() {
  const { t } = useTranslation();
  const [loginCaptchaEnabled, setLoginCaptchaEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getSiteSettings()
      .then((s) => {
        if (!cancelled) {
          setLoginCaptchaEnabled(s.login_captcha_enabled === "true");
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleToggleLoginCaptcha = async (next: boolean) => {
    const prev = loginCaptchaEnabled;
    setLoginCaptchaEnabled(next);
    setSaving(true);
    try {
      const updated = await api.updateSiteSettings({ login_captcha_enabled: next });
      setLoginCaptchaEnabled(updated.login_captcha_enabled === "true");
    } catch {
      setLoginCaptchaEnabled(prev);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <Shield className="w-4 h-4 text-indigo-500" />
        <h3 className="text-lg font-bold text-tx-primary">{t('settings.loginCaptchaLabel', { defaultValue: "登录验证码" })}</h3>
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
        {t('settings.loginCaptchaHint', { defaultValue: "开启后，登录界面需要输入图形验证码以防止暴力破解。" })}
      </p>

      <div className="max-w-md">
        <label className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 cursor-pointer hover:bg-white/60 dark:hover:bg-zinc-900/25 transition-colors">
          <input
            type="checkbox"
            checked={loginCaptchaEnabled}
            disabled={saving}
            onChange={(e) => handleToggleLoginCaptcha(e.target.checked)}
            className="w-4 h-4 accent-indigo-600 cursor-pointer disabled:opacity-50"
          />
          <span className="text-sm font-medium text-tx-primary flex items-center gap-1.5">
            开启登录图形验证码
            {saving && <Loader2 size={12} className="animate-spin text-zinc-400" />}
          </span>
        </label>
      </div>
    </section>
  );
}

export default function SecuritySettings() {
  const { t } = useTranslation();
  const [user, setUser] = useState<any>(null);

  const fetchUser = useCallback(() => {
    api
      .getMe()
      .then((u) => {
        setUser(u);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const isAdmin = user?.role === "admin";

  return (
    <div className="space-y-10">
      <ProfileSection user={user} onUpdate={fetchUser} />
      <PasswordSection />
      {isAdmin && <CaptchaSection />}
      <TwoFactorSection />
      <SessionsSection />
    </div>
  );
}

// ====================================================================
// 账号与密码修改（原有逻辑，只微调使用 api.updateSecurity + broadcastLogout）
// ====================================================================
function PasswordSection() {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [shake, setShake] = useState(false);

  const triggerShake = (msg: string) => {
    setError(msg);
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!currentPassword) {
      return triggerShake(t('securitySettings.currentPasswordRequired'));
    }
    if (!newPassword && !newUsername) {
      return triggerShake(t('securitySettings.noChanges'));
    }
    if (newPassword && newPassword.length < 6) {
      return triggerShake(t('securitySettings.passwordTooShort'));
    }
    if (newPassword && newPassword !== confirmPassword) {
      return triggerShake(t('securitySettings.passwordNotMatch'));
    }

    setIsLoading(true);
    try {
      // api.updateSecurity 会自动把新 token 写回 localStorage（后端改密会 bump tokenVersion）
      await api.updateSecurity({
        currentPassword,
        newUsername: newUsername || undefined,
        newPassword: newPassword || undefined,
      });
      setSuccess(true);
      setTimeout(() => {
        // L10: 改密成功 → 广播其他 tab 一起下线
        broadcastLogout("password_changed");
        window.location.reload();
      }, 2000);
    } catch (err: any) {
      triggerShake(err?.message || t('securitySettings.updateFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <Shield className="w-4 h-4 text-indigo-500" />
        <h3 className="text-lg font-bold text-tx-primary">{t('securitySettings.title')}</h3>
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">{t('securitySettings.description')}</p>

      <motion.form
        onSubmit={handleSubmit}
        className="space-y-4 max-w-md"
        animate={shake ? { x: [0, -8, 8, -6, 6, -3, 3, 0] } : { x: 0 }}
        transition={shake ? { duration: 0.5 } : {}}
      >
        {/* 当前密码 */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('securitySettings.currentPassword')} <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Key className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
            </div>
            <input
              type={showCurrentPassword ? "text" : "password"}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={`block w-full pl-10 pr-10 py-2.5 border rounded-xl bg-zinc-50/50 dark:bg-zinc-800/50 text-tx-primary placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 dark:focus:border-indigo-500 transition-all text-sm ${
                error && !currentPassword ? "border-red-500/50 dark:border-red-500/50" : "border-zinc-200 dark:border-zinc-700"
              }`}
              placeholder={t('securitySettings.currentPasswordPlaceholder')}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              onClick={() => setShowCurrentPassword(!showCurrentPassword)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
            >
              {showCurrentPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        <div className="h-px w-full bg-zinc-200 dark:bg-zinc-800" />

        {/* 新用户名 */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('securitySettings.newUsername')}</label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <User className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
            </div>
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              className="block w-full pl-10 pr-3 py-2.5 border border-zinc-200 dark:border-zinc-700 rounded-xl bg-zinc-50/50 dark:bg-zinc-800/50 text-tx-primary placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 dark:focus:border-indigo-500 transition-all text-sm"
              placeholder={t('securitySettings.newUsernamePlaceholder')}
              autoComplete="username"
            />
          </div>
        </div>

        {/* 新密码 */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('securitySettings.newPassword')}</label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Key className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
            </div>
            <input
              type={showNewPassword ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="block w-full pl-10 pr-10 py-2.5 border border-zinc-200 dark:border-zinc-700 rounded-xl bg-zinc-50/50 dark:bg-zinc-800/50 text-tx-primary placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 dark:focus:border-indigo-500 transition-all text-sm"
              placeholder={t('securitySettings.newPasswordPlaceholder')}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowNewPassword(!showNewPassword)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
            >
              {showNewPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {newPassword && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="space-y-1.5 overflow-hidden"
            >
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('securitySettings.confirmPassword')}</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Key className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
                </div>
                <input
                  type={showNewPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`block w-full pl-10 pr-3 py-2.5 border rounded-xl bg-zinc-50/50 dark:bg-zinc-800/50 text-tx-primary placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 dark:focus:border-indigo-500 transition-all text-sm ${
                    confirmPassword && newPassword !== confirmPassword ? "border-red-500/50 dark:border-red-500/50" : "border-zinc-200 dark:border-zinc-700"
                  }`}
                  placeholder={t('securitySettings.confirmPasswordPlaceholder')}
                  autoComplete="new-password"
                  required={!!newPassword}
                />
              </div>
              {confirmPassword && newPassword !== confirmPassword && (
                <p className="text-xs text-red-500 dark:text-red-400">{t('securitySettings.passwordMismatch')}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          type="submit"
          disabled={isLoading || success}
          className={`w-full flex items-center justify-center py-2.5 px-4 rounded-xl text-sm font-medium text-white transition-all shadow-sm hover:shadow-md ${
            success
              ? "bg-green-500"
              : "bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-500"
          } disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-zinc-900`}
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : success ? (
            <>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              {t('securitySettings.successMessage')}
            </>
          ) : (
            <>
              <Key className="w-4 h-4 mr-2" />
              {t('securitySettings.saveButton')}
            </>
          )}
        </button>
      </motion.form>
    </section>
  );
}

// ====================================================================
// 两步验证 (2FA)
// ====================================================================
//
// 三态状态机：
//   idle            刚进入，显示 enable / disable 按钮
//   setup           已调用 /auth/2fa/setup，显示 otpauth URI + 输入框
//   showRecovery    activate 成功，展示恢复码
//   disabling       显示关闭 2FA 的 code 输入框
function TwoFactorSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<{ enabled: boolean; enabledAt: string | null; recoveryCodesRemaining: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [ui, setUi] = useState<
    | { mode: "idle" }
    | { mode: "setup"; secret: string; otpauthUri: string; pending: string; code: string; error: string; busy: boolean }
    | { mode: "showRecovery"; codes: string[] }
    | { mode: "disabling"; code: string; error: string; busy: boolean }
  >({ mode: "idle" });
  const [sudoToken, setSudoToken] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api.getTwoFactorStatus();
      setStatus(s);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2000);
  };

  const startSetup = async () => {
    try {
      const { secret, otpauthUri, pending } = await api.setupTwoFactor();
      setUi({ mode: "setup", secret, otpauthUri, pending, code: "", error: "", busy: false });
    } catch (err: any) {
      showToast(err?.message || "setup failed");
    }
  };

  const activate = async () => {
    if (ui.mode !== "setup") return;
    setUi({ ...ui, busy: true, error: "" });
    try {
      const { recoveryCodes } = await api.activateTwoFactor(ui.pending, ui.code.trim());
      setUi({ mode: "showRecovery", codes: recoveryCodes });
      await refresh();
    } catch (err: any) {
      setUi({ ...ui, busy: false, error: err?.message || t("securitySettings.twoFactor.codeInvalid") });
    }
  };

  const disable = async () => {
    if (ui.mode !== "disabling") return;
    setUi({ ...ui, busy: true, error: "" });
    try {
      const ran = await withSudo(
        (tk) => api.disableTwoFactor(ui.code.trim(), tk),
        () =>
          promptDialog({
            title: t("securitySettings.twoFactor.disableHint"),
            type: "password",
            placeholder: t("securitySettings.currentPasswordPlaceholder"),
          }),
        sudoToken,
      );
      if (!ran) {
        setUi({ ...ui, busy: false });
        return;
      }
      setSudoToken(ran.sudoToken);
      setUi({ mode: "idle" });
      await refresh();
      showToast(t("securitySettings.twoFactor.disableSuccess"));
    } catch (err: any) {
      setUi({ ...ui, busy: false, error: err?.message || t("securitySettings.twoFactor.codeInvalid") });
    }
  };

  const regenerate = async () => {
    try {
      const ran = await withSudo(
        (tk) => api.regenerateRecoveryCodes(tk),
        () =>
          promptDialog({
            title: t("securitySettings.twoFactor.regenerateHint"),
            description: t("securitySettings.currentPasswordPlaceholder"),
            type: "password",
            placeholder: t("securitySettings.currentPasswordPlaceholder"),
          }),
        sudoToken,
      );
      if (!ran) return;
      setSudoToken(ran.sudoToken);
      setUi({ mode: "showRecovery", codes: ran.result.recoveryCodes });
      await refresh();
    } catch (err: any) {
      showToast(err?.message || "regenerate failed");
    }
  };

  const copyCodes = async (codes: string[]) => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      showToast(t("securitySettings.twoFactor.copied"));
    } catch {
      /* ignore */
    }
  };

  const downloadCodes = (codes: string[]) => {
    const blob = new Blob([codes.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "super-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <Smartphone className="w-4 h-4 text-indigo-500" />
        <h3 className="text-lg font-bold text-tx-primary">{t("securitySettings.twoFactor.title")}</h3>
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
        {status?.enabled
          ? t("securitySettings.twoFactor.descriptionEnabled")
          : t("securitySettings.twoFactor.descriptionDisabled")}
      </p>

      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
      ) : (
        <div className="max-w-md space-y-4">
          {/* 状态区 */}
          <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/50">
            <div className="text-sm">
              <div className="font-medium text-tx-primary">
                {status?.enabled
                  ? t("securitySettings.twoFactor.enabledAt", { date: status.enabledAt ? new Date(status.enabledAt).toLocaleString() : "-" })
                  : t("securitySettings.twoFactor.descriptionDisabled")}
              </div>
              {status?.enabled && (
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {t("securitySettings.twoFactor.recoveryRemaining", { count: status.recoveryCodesRemaining })}
                </div>
              )}
            </div>
            {status?.enabled ? (
              <button
                type="button"
                onClick={() => setUi({ mode: "disabling", code: "", error: "", busy: false })}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 border border-red-200 dark:border-red-500/30"
              >
                {t("securitySettings.twoFactor.disableButton")}
              </button>
            ) : (
              <button
                type="button"
                onClick={startSetup}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700"
              >
                {t("securitySettings.twoFactor.enableButton")}
              </button>
            )}
          </div>

          {/* 已启用：重新生成恢复码 */}
          {status?.enabled && ui.mode === "idle" && (
            <button
              type="button"
              onClick={regenerate}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              {t("securitySettings.twoFactor.regenerateCodes")}
            </button>
          )}

          {/* setup 状态：展示 otpauth URI + 输入 6 位码 */}
          {ui.mode === "setup" && (
            <div className="space-y-3 p-4 rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50/50 dark:bg-indigo-500/5">
              <div className="text-sm font-medium text-tx-primary">
                {t("securitySettings.twoFactor.setupTitle")}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {t("securitySettings.twoFactor.setupHint")}
              </div>
              <QRCodeCanvas text={ui.otpauthUri} />
              {/* otpauth URI（用户可点开自己用在线二维码生成器，或复制到密码管理器） */}
              <div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">{t("securitySettings.twoFactor.otpauthUri")}</div>
                <input
                  readOnly
                  value={ui.otpauthUri}
                  className="w-full px-2 py-1.5 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-700 dark:text-zinc-300"
                  onFocus={(e) => e.currentTarget.select()}
                />
              </div>
              {/* 纯密钥 */}
              <div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">{t("securitySettings.twoFactor.manualSecret")}</div>
                <code className="block px-2 py-1.5 text-sm font-mono bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg tracking-widest text-zinc-700 dark:text-zinc-300">
                  {ui.secret}
                </code>
              </div>
              {/* 输入 6 位码 */}
              <div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">{t("securitySettings.twoFactor.activateLabel")}</div>
                <input
                  value={ui.code}
                  onChange={(e) => setUi({ ...ui, code: e.target.value })}
                  placeholder="123456"
                  inputMode="numeric"
                  maxLength={6}
                  className="w-full px-3 py-2 text-center tracking-[0.4em] font-mono bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-tx-primary"
                />
                {ui.error && <p className="text-xs text-red-500 mt-1">{ui.error}</p>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={activate}
                  disabled={ui.busy || !/^\d{6}$/.test(ui.code.trim())}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                >
                  {ui.busy ? <Loader2 className="w-3 h-3 animate-spin" /> : t("securitySettings.twoFactor.activateButton")}
                </button>
                <button
                  type="button"
                  onClick={() => setUi({ mode: "idle" })}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {t("securitySettings.twoFactor.cancelButton")}
                </button>
              </div>
            </div>
          )}

          {/* disabling：请求输入 code */}
          {ui.mode === "disabling" && (
            <div className="space-y-3 p-4 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5">
              <div className="text-sm font-medium text-tx-primary">{t("securitySettings.twoFactor.disableTitle")}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{t("securitySettings.twoFactor.disableHint")}</div>
              <input
                value={ui.code}
                onChange={(e) => setUi({ ...ui, code: e.target.value })}
                placeholder="123456"
                className="w-full px-3 py-2 text-center tracking-[0.3em] font-mono bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-tx-primary"
              />
              {ui.error && <p className="text-xs text-red-500">{ui.error}</p>}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={disable}
                  disabled={ui.busy || !ui.code.trim()}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                >
                  {ui.busy ? <Loader2 className="w-3 h-3 animate-spin" /> : t("securitySettings.twoFactor.disableButton")}
                </button>
                <button
                  type="button"
                  onClick={() => setUi({ mode: "idle" })}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {t("securitySettings.twoFactor.cancelButton")}
                </button>
              </div>
            </div>
          )}

          {/* 展示恢复码（仅一次） */}
          {ui.mode === "showRecovery" && (
            <div className="space-y-3 p-4 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/5">
              <div className="text-sm font-medium text-tx-primary">
                {t("securitySettings.twoFactor.recoveryCodesTitle")}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {t("securitySettings.twoFactor.recoveryCodesHint")}
              </div>
              <div className="grid grid-cols-2 gap-2 p-3 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 font-mono text-sm text-zinc-800 dark:text-zinc-200">
                {ui.codes.map((c) => (
                  <code key={c}>{c}</code>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => copyCodes(ui.codes)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  {t("securitySettings.twoFactor.copyCodes")}
                </button>
                <button
                  type="button"
                  onClick={() => downloadCodes(ui.codes)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-1"
                >
                  <Download className="w-3 h-3" />
                  {t("securitySettings.twoFactor.downloadCodes")}
                </button>
                <button
                  type="button"
                  onClick={() => setUi({ mode: "idle" })}
                  className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  {t("securitySettings.twoFactor.cancelButton")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {toast && (
        <div className="fixed bottom-4 right-4 px-3 py-2 rounded-lg text-sm bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-lg z-50">
          {toast}
        </div>
      )}
    </section>
  );
}

// ====================================================================
// 会话管理
// ====================================================================
function SessionsSection() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<Array<{
    id: string;
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string | null;
    ip: string;
    userAgent: string;
    deviceLabel: string | null;
    current: boolean;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listSessions();
      setSessions(data.sessions);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const revokeOne = async (id: string) => {
    setRevoking(id);
    try {
      await api.revokeSession(id);
      await refresh();
    } finally {
      setRevoking(null);
    }
  };

  const revokeOthers = async () => {
    const others = sessions.filter((s) => !s.current).length;
    if (others === 0) return;
    const ok = await confirmDialog({
      title: t("securitySettings.sessions.revokeOthersConfirm", { count: others }),
      danger: true,
    });
    if (!ok) return;
    await api.revokeOtherSessions(true);
    await refresh();
  };

  const formatUa = (ua: string) => {
    if (!ua) return t("securitySettings.sessions.unknownUa");
    // 粗略提取浏览器+OS，足够识别场景
    const os = /Windows/.test(ua) ? "Windows"
      : /Mac OS/.test(ua) ? "macOS"
      : /Android/.test(ua) ? "Android"
      : /iPhone|iPad/.test(ua) ? "iOS"
      : /Linux/.test(ua) ? "Linux"
      : "";
    const br = /Edg\//.test(ua) ? "Edge"
      : /OPR\//.test(ua) ? "Opera"
      : /Chrome\//.test(ua) ? "Chrome"
      : /Firefox\//.test(ua) ? "Firefox"
      : /Safari\//.test(ua) ? "Safari"
      : "";
    return [br, os].filter(Boolean).join(" · ") || ua.slice(0, 60);
  };

  const others = sessions.filter((s) => !s.current);

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <LogOut className="w-4 h-4 text-indigo-500" />
        <h3 className="text-lg font-bold text-tx-primary">{t("securitySettings.sessions.title")}</h3>
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">{t("securitySettings.sessions.description")}</p>

      <div className="max-w-2xl space-y-2">
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
        ) : sessions.length === 0 ? (
          <p className="text-sm text-zinc-400">{t("securitySettings.sessions.empty")}</p>
        ) : (
          <>
            {sessions.map((s) => (
              <div
                key={s.id}
                className={`flex items-center gap-3 p-3 rounded-xl border ${
                  s.current
                    ? "border-indigo-200 dark:border-indigo-500/30 bg-indigo-50/40 dark:bg-indigo-500/5"
                    : "border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-800/30"
                }`}
              >
                <Monitor className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-tx-primary flex items-center gap-2">
                    <span className="truncate">{formatUa(s.userAgent)}</span>
                    {s.current && (
                      <span className="px-1.5 py-0.5 text-[10px] rounded bg-indigo-600 text-white flex-shrink-0">
                        {t("securitySettings.sessions.current")}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    {t("securitySettings.sessions.from", { ip: s.ip || "-" })}
                    {" · "}
                    {t("securitySettings.sessions.lastSeen", {
                      time: new Date(s.lastSeenAt).toLocaleString(),
                    })}
                  </div>
                </div>
                {!s.current && (
                  <button
                    type="button"
                    onClick={() => revokeOne(s.id)}
                    disabled={revoking === s.id}
                    className="px-3 py-1 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 border border-red-200 dark:border-red-500/30 disabled:opacity-50"
                  >
                    {revoking === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : t("securitySettings.sessions.revokeButton")}
                  </button>
                )}
              </div>
            ))}
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={refresh}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                {t("securitySettings.sessions.refresh")}
              </button>
              {others.length > 0 && (
                <button
                  type="button"
                  onClick={revokeOthers}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 border border-red-200 dark:border-red-500/30"
                >
                  {t("securitySettings.sessions.revokeOthers")}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
