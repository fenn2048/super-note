import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, getToken } from "@/lib/api";
import { getModulePack, setModulePack, type ModulePackId } from "@/lib/modulePack";
import {
  clampBackgroundResumeMinutes,
  DEFAULT_BACKGROUND_RESUME_MINUTES,
} from "@/lib/appResume";

/**
 * 用户级 UI 偏好
 * - 本机 localStorage 即时可用
 * - 登录后与 GET/PUT /api/users/me/preferences 合并同步（跨设备）
 */

const STORAGE_KEY = "super.user-prefs.v1";

export type ReadingDensity = "cozy" | "compact";
/** 笔记列表密度 */
export type NoteListDensity = "cozy" | "compact";
export type StartupLanding = "last" | "home" | "notes" | "tasks";

export interface UserPreferences {
  noteTitleAsAppTitle: boolean;
  outlineDefaultOpen: boolean;
  lockOnOpen: boolean;
  readingDensity: ReadingDensity;
  /** 笔记列表行间距（与 readingDensity 独立） */
  noteListDensity: NoteListDensity;
  healthReminderEnabled: boolean;
  reminderInterval: number;
  startupLanding: StartupLanding;
  /**
   * 退后台超过该分钟数再回前台：展示闪屏 + 指纹锁屏（与 appResume 共用）。
   * 默认 5 分钟。
   */
  backgroundResumeMinutes: number;
}

const DEFAULT_PREFS: UserPreferences = {
  noteTitleAsAppTitle: false,
  outlineDefaultOpen: false,
  lockOnOpen: false,
  readingDensity: "cozy",
  noteListDensity: "cozy",
  healthReminderEnabled: false,
  reminderInterval: 30,
  startupLanding: "last",
  backgroundResumeMinutes: DEFAULT_BACKGROUND_RESUME_MINUTES,
};

function normalizePrefs(parsed: Partial<UserPreferences> & Record<string, unknown>): UserPreferences {
  return {
    noteTitleAsAppTitle:
      typeof parsed.noteTitleAsAppTitle === "boolean"
        ? parsed.noteTitleAsAppTitle
        : DEFAULT_PREFS.noteTitleAsAppTitle,
    outlineDefaultOpen:
      typeof parsed.outlineDefaultOpen === "boolean"
        ? parsed.outlineDefaultOpen
        : DEFAULT_PREFS.outlineDefaultOpen,
    lockOnOpen:
      typeof parsed.lockOnOpen === "boolean"
        ? parsed.lockOnOpen
        : DEFAULT_PREFS.lockOnOpen,
    readingDensity:
      parsed.readingDensity === "compact" || parsed.readingDensity === "cozy"
        ? parsed.readingDensity
        : DEFAULT_PREFS.readingDensity,
    noteListDensity:
      parsed.noteListDensity === "compact" || parsed.noteListDensity === "cozy"
        ? parsed.noteListDensity
        : DEFAULT_PREFS.noteListDensity,
    healthReminderEnabled:
      typeof parsed.healthReminderEnabled === "boolean"
        ? parsed.healthReminderEnabled
        : DEFAULT_PREFS.healthReminderEnabled,
    reminderInterval:
      typeof parsed.reminderInterval === "number"
        ? parsed.reminderInterval
        : DEFAULT_PREFS.reminderInterval,
    startupLanding:
      parsed.startupLanding === "last" ||
      parsed.startupLanding === "home" ||
      parsed.startupLanding === "notes" ||
      parsed.startupLanding === "tasks"
        ? parsed.startupLanding
        : DEFAULT_PREFS.startupLanding,
    backgroundResumeMinutes:
      parsed.backgroundResumeMinutes != null
        ? clampBackgroundResumeMinutes(parsed.backgroundResumeMinutes)
        : DEFAULT_PREFS.backgroundResumeMinutes,
  };
}

function readFromStorage(): UserPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    return normalizePrefs(JSON.parse(raw) as Partial<UserPreferences>);
  } catch {
    return DEFAULT_PREFS;
  }
}

function writeToStorage(prefs: UserPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

interface UserPreferencesContextValue {
  prefs: UserPreferences;
  setPref: <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K],
  ) => void;
  /** 服务端是否已拉取过 */
  cloudSynced: boolean;
}

const UserPreferencesContext = createContext<UserPreferencesContextValue>({
  prefs: DEFAULT_PREFS,
  setPref: () => {},
  cloudSynced: false,
});

export function UserPreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [prefs, setPrefs] = useState<UserPreferences>(() => readFromStorage());
  const [cloudSynced, setCloudSynced] = useState(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const cls = "density-compact";
    if (prefs.readingDensity === "compact") {
      document.body.classList.add(cls);
    } else {
      document.body.classList.remove(cls);
    }
  }, [prefs.readingDensity]);

  useEffect(() => {
    const cls = "note-list-density-compact";
    if (prefs.noteListDensity === "compact") {
      document.body.classList.add(cls);
    } else {
      document.body.classList.remove(cls);
    }
  }, [prefs.noteListDensity]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setPrefs(readFromStorage());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // 登录后拉取云端偏好并与本地合并（云端覆盖同名字段）
  useEffect(() => {
    if (!getToken()) {
      setCloudSynced(false);
      return;
    }
    let cancelled = false;
    api
      .getUserPreferences()
      .then((res) => {
        if (cancelled) return;
        const remote = res.prefs || {};
        const merged = normalizePrefs({
          ...readFromStorage(),
          ...remote,
        } as Partial<UserPreferences>);
        setPrefs(merged);
        writeToStorage(merged);
        // 模块包：云端有则写回 localStorage
        if (
          remote.modulePack === "minimal" ||
          remote.modulePack === "family" ||
          remote.modulePack === "creator" ||
          remote.modulePack === "full"
        ) {
          setModulePack(remote.modulePack as ModulePackId);
        }
        setCloudSynced(true);
      })
      .catch(() => {
        if (!cancelled) setCloudSynced(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pushCloud = useCallback((next: UserPreferences) => {
    if (!getToken()) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      const pack = getModulePack();
      void api
        .updateUserPreferences({
          ...next,
          modulePack: pack,
        })
        .catch(() => {
          /* 离线时保留本地 */
        });
    }, 400);
  }, []);

  // 模块包变更时同步云端
  useEffect(() => {
    const onPack = () => {
      if (!getToken()) return;
      void api
        .updateUserPreferences({
          ...readFromStorage(),
          modulePack: getModulePack(),
        })
        .catch(() => {});
    };
    window.addEventListener("super:module-pack-changed", onPack);
    return () => window.removeEventListener("super:module-pack-changed", onPack);
  }, []);

  const setPref = useCallback(
    <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
      setPrefs((prev) => {
        if (prev[key] === value) return prev;
        const next = { ...prev, [key]: value };
        writeToStorage(next);
        pushCloud(next);
        return next;
      });
    },
    [pushCloud],
  );

  const value = useMemo(
    () => ({ prefs, setPref, cloudSynced }),
    [prefs, setPref, cloudSynced],
  );

  return (
    <UserPreferencesContext.Provider value={value}>
      {children}
    </UserPreferencesContext.Provider>
  );
}

export function useUserPreferences(): UserPreferencesContextValue {
  return useContext(UserPreferencesContext);
}
