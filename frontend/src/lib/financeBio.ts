/**
 * 账本生物识别快速解锁
 * - bioToken 存 SecureStorage（仅原生 Capacitor）
 * - 解锁流程：系统生物识别成功 → POST unlock-bio → 短期 unlockToken
 */
import { Capacitor } from "@capacitor/core";
import { api } from "@/lib/api";

type SecureStorageModule = typeof import("@aparajita/capacitor-secure-storage");
type BiometricModule = typeof import("@aparajita/capacitor-biometric-auth");

let ssPromise: Promise<SecureStorageModule | null> | null = null;
let bioPromise: Promise<BiometricModule | null> | null = null;

function isNative() {
  try {
    return !!Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

async function loadSS(): Promise<SecureStorageModule | null> {
  if (!isNative()) return null;
  if (ssPromise) return ssPromise;
  ssPromise = (async () => {
    try {
      const mod = await import("@aparajita/capacitor-secure-storage");
      await mod.SecureStorage.setKeyPrefix("super_");
      return mod;
    } catch {
      return null;
    }
  })();
  return ssPromise;
}

async function loadBio(): Promise<BiometricModule | null> {
  if (!isNative()) return null;
  if (bioPromise) return bioPromise;
  bioPromise = (async () => {
    try {
      return await import("@aparajita/capacitor-biometric-auth");
    } catch {
      return null;
    }
  })();
  return bioPromise;
}

function bioKey(ledgerId: string) {
  return `finance.bio.${ledgerId}`;
}

export function isFinanceBioPlatformSupported(): boolean {
  return isNative();
}

export async function isFinanceBioAvailable(): Promise<boolean> {
  const bio = await loadBio();
  if (!bio) return false;
  try {
    const r = await bio.BiometricAuth.checkBiometry();
    return !!(r.isAvailable || r.deviceIsSecure);
  } catch {
    return false;
  }
}

export async function hasLocalFinanceBioToken(ledgerId: string): Promise<boolean> {
  const ss = await loadSS();
  if (!ss) return false;
  try {
    const v = await ss.SecureStorage.get(bioKey(ledgerId));
    return typeof v === "string" && v.length > 0;
  } catch {
    return false;
  }
}

export async function enableFinanceBio(
  ledgerId: string,
  unlockToken: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!isNative()) return { ok: false, error: "当前环境不支持" };
  const bio = await loadBio();
  const ss = await loadSS();
  if (!bio || !ss) return { ok: false, error: "生物识别组件不可用" };

  try {
    await bio.BiometricAuth.authenticate({
      reason: "启用账本指纹/面容解锁",
      cancelTitle: "取消",
      androidTitle: "启用账本解锁",
      androidSubtitle: "验证后可快速打开账本",
      androidConfirmationRequired: false,
      allowDeviceCredential: true,
    });
  } catch (e: any) {
    return { ok: false, error: e?.message || "已取消" };
  }

  try {
    const res = await api.finance.enableBio(ledgerId, unlockToken);
    if (!res.bioToken) return { ok: false, error: "服务器未返回凭证" };
    await ss.SecureStorage.set(bioKey(ledgerId), res.bioToken);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "启用失败" };
  }
}

export async function disableFinanceBio(ledgerId: string): Promise<void> {
  try {
    await api.finance.disableBio(ledgerId);
  } catch {
    /* ignore server */
  }
  const ss = await loadSS();
  if (!ss) return;
  try {
    await ss.SecureStorage.remove(bioKey(ledgerId));
  } catch {
    /* ignore */
  }
}

/**
 * 生物识别解锁账本：成功返回 unlockToken
 */
export async function unlockFinanceWithBio(
  ledgerId: string,
): Promise<{ ok: true; unlockToken: string } | { ok: false; error: string }> {
  if (!isNative()) return { ok: false, error: "不支持" };
  const bio = await loadBio();
  const ss = await loadSS();
  if (!bio || !ss) return { ok: false, error: "生物识别不可用" };

  let bioToken: string | null = null;
  try {
    const v = await ss.SecureStorage.get(bioKey(ledgerId));
    bioToken = typeof v === "string" ? v : null;
  } catch {
    bioToken = null;
  }
  if (!bioToken) return { ok: false, error: "未启用生物识别解锁" };

  try {
    await bio.BiometricAuth.authenticate({
      reason: "解锁账本",
      cancelTitle: "取消",
      androidTitle: "解锁账本",
      androidSubtitle: "使用指纹 / 面容 / 锁屏密码",
      androidConfirmationRequired: false,
      allowDeviceCredential: true,
    });
  } catch (e: any) {
    return { ok: false, error: e?.message || "已取消" };
  }

  try {
    const res = await api.finance.unlockLedgerBio(ledgerId, bioToken);
    if (!res.unlockToken) return { ok: false, error: "解锁失败" };
    return { ok: true, unlockToken: res.unlockToken };
  } catch (e: any) {
    // 凭证失效：清本地
    try {
      await ss.SecureStorage.remove(bioKey(ledgerId));
    } catch {
      /* ignore */
    }
    return { ok: false, error: e?.message || "凭证已失效，请用密码解锁后重新启用" };
  }
}
