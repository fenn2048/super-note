import React, { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { EMOJI_LIST, IMAGE_EMOJI_TABS } from "@/lib/emoji";
import { resolveAttachmentUrl } from "@/lib/api";

export type CustomStickerItem = { id: string; url: string };

const HIDDEN_KEY = "super-hidden-bundled-stickers";
const STICKER_GRID =
  "grid w-full gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(3.5rem,1fr))]";

function readHiddenBundled(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeHiddenBundled(urls: string[]) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(urls));
  } catch {
    /* ignore quota */
  }
}

interface EmojiPickerProps {
  onSelectTextEmoji: (emoji: string) => void;
  onSelectImageEmoji: (imageUrl: string) => void;
  className?: string;
  customStickers?: CustomStickerItem[];
  onSelectCustom?: (sticker: CustomStickerItem) => void;
  onAddCustom?: () => void;
  onDeleteCustom?: (id: string) => void;
  /** 打开时默认 tab：默认 emoji；聊天自定义表情用 mine */
  initialTab?: string;
}

export function EmojiPicker({
  onSelectTextEmoji,
  onSelectImageEmoji,
  className,
  customStickers,
  onSelectCustom,
  onAddCustom,
  onDeleteCustom,
  initialTab,
}: EmojiPickerProps) {
  const showMine = Boolean(customStickers || onAddCustom);
  const [activeTab, setActiveTab] = useState(
    initialTab || (showMine ? "mine" : IMAGE_EMOJI_TABS[0].id),
  );
  const [bundled, setBundled] = useState<string[]>([]);
  const [hiddenBundled, setHiddenBundled] = useState<string[]>(readHiddenBundled);
  const [editing, setEditing] = useState(false);
  const currentTab = IMAGE_EMOJI_TABS.find((t) => t.id === activeTab) || IMAGE_EMOJI_TABS[0];
  const mineActive = activeTab === "mine";
  const visibleBundled = bundled.filter((url) => !hiddenBundled.includes(url));

  useEffect(() => {
    if (!showMine) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(resolveAttachmentUrl("/emojis/pack/manifest.json"));
        if (!res.ok) return;
        const data = (await res.json()) as { items?: string[] };
        const items = (data.items || []).filter((name) =>
          /^[a-zA-Z0-9._-]+\.(png|gif|webp|jpe?g)$/i.test(name),
        );
        if (!cancelled) {
          setBundled(items.map((name) => `/emojis/pack/${name}`));
        }
      } catch {
        /* 后端未部署表情包时静默 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showMine]);

  useEffect(() => {
    if (!mineActive) setEditing(false);
  }, [mineActive]);

  const hideBundled = (url: string) => {
    setHiddenBundled((prev) => {
      if (prev.includes(url)) return prev;
      const next = [...prev, url];
      writeHiddenBundled(next);
      return next;
    });
  };

  const restoreBundled = () => {
    setHiddenBundled([]);
    writeHiddenBundled([]);
  };

  return (
    <div
      className={cn(
        "flex flex-col bg-app-elevated border border-app-border shadow-lg rounded-xl overflow-hidden pointer-events-auto w-full min-w-0",
        className,
      )}
    >
      <div className="p-2 h-64 overflow-y-auto overflow-x-hidden w-full min-w-0 scroll-smooth">
        {mineActive ? (
          <div className={STICKER_GRID}>
            {onAddCustom && !editing && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onAddCustom();
                }}
                className="min-h-11 aspect-square hover:bg-app-hover rounded-button border border-dashed border-app-border flex items-center justify-center text-tx-tertiary"
                aria-label="添加自定义表情"
              >
                <Plus size={20} />
              </button>
            )}
            {visibleBundled.map((url) => (
              <StickerCell
                key={url}
                src={resolveAttachmentUrl(url)}
                editing={editing}
                onSend={() => onSelectImageEmoji(url)}
                onRemove={() => hideBundled(url)}
              />
            ))}
            {(customStickers || []).map((s) => (
              <StickerCell
                key={s.id}
                src={s.url}
                editing={editing}
                onSend={() => onSelectCustom?.(s)}
                onRemove={onDeleteCustom ? () => onDeleteCustom(s.id) : undefined}
              />
            ))}
          </div>
        ) : currentTab.type === "text" ? (
          <div className="grid w-full gap-1 [grid-template-columns:repeat(auto-fill,minmax(2.25rem,1fr))]">
            {EMOJI_LIST.map((emoji, i) => (
              <button
                key={i}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelectTextEmoji(emoji);
                }}
                className="min-h-11 aspect-square hover:bg-app-hover rounded flex items-center justify-center text-xl"
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : (
          <div className={STICKER_GRID}>
            {currentTab.images?.map((url, idx) => (
              <button
                key={idx}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelectImageEmoji(url);
                }}
                className="min-h-11 aspect-square hover:bg-app-hover rounded-button p-1"
              >
                <img src={url} alt="emoji" className="w-full h-full object-contain" draggable={false} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 p-2 bg-app-surface border-t border-app-border overflow-x-auto hide-scrollbar shrink-0">
        {showMine && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setActiveTab("mine");
            }}
            className={cn(
              "w-8 h-8 rounded shrink-0 flex items-center justify-center text-sm",
              mineActive ? "bg-app-active/50 ring-1 ring-accent-primary" : "hover:bg-app-hover",
            )}
            title="我的表情"
          >
            ☆
          </button>
        )}
        {IMAGE_EMOJI_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setActiveTab(tab.id);
            }}
            className={cn(
              "w-8 h-8 rounded shrink-0 flex items-center justify-center",
              activeTab === tab.id ? "bg-app-active/50 ring-1 ring-accent-primary" : "hover:bg-app-hover",
            )}
            title={tab.id}
          >
            {tab.icon.startsWith("/") ? (
              <img src={tab.icon} alt={tab.id} className="w-5 h-5 object-contain" />
            ) : (
              <span className="text-lg">{tab.icon}</span>
            )}
          </button>
        ))}
        {mineActive && showMine && (
          <div className="ml-auto flex items-center gap-1 shrink-0">
            {editing && hiddenBundled.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  restoreBundled();
                }}
                className="min-h-11 px-2 text-xs font-medium text-tx-tertiary hover:text-tx-primary"
              >
                恢复默认
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setEditing((v) => !v);
              }}
              className={cn(
                "min-h-11 px-2.5 text-xs font-medium rounded-button",
                editing ? "text-accent-primary bg-accent-primary/12" : "text-tx-secondary hover:bg-app-hover",
              )}
            >
              {editing ? "完成" : "整理"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StickerCell({
  src,
  editing,
  onSend,
  onRemove,
}: {
  src: string;
  editing: boolean;
  onSend: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="relative aspect-square min-h-11">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (editing) {
            onRemove?.();
            return;
          }
          onSend();
        }}
        className="w-full h-full min-h-11 hover:bg-app-hover rounded-button p-0.5"
        aria-label={editing ? "删除表情" : "发送表情"}
      >
        <img
          src={src}
          alt=""
          className="w-full h-full object-contain"
          loading="lazy"
          draggable={false}
        />
      </button>
      {editing && onRemove && (
        <span
          className="absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full bg-accent-danger text-white flex items-center justify-center pointer-events-none shadow-xs"
          aria-hidden
        >
          <X size={11} strokeWidth={2.5} />
        </span>
      )}
    </div>
  );
}
