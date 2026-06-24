import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { EMOJI_LIST, IMAGE_EMOJI_TABS } from "@/lib/emoji";

interface EmojiPickerProps {
  onSelectTextEmoji: (emoji: string) => void;
  onSelectImageEmoji: (imageUrl: string) => void;
  className?: string;
}

export function EmojiPicker({ onSelectTextEmoji, onSelectImageEmoji, className }: EmojiPickerProps) {
  const [activeTab, setActiveTab] = useState(IMAGE_EMOJI_TABS[0].id);

  const currentTab = IMAGE_EMOJI_TABS.find(t => t.id === activeTab) || IMAGE_EMOJI_TABS[0];

  return (
    <div className={cn("flex flex-col bg-app-elevated border border-app-border shadow-lg rounded-xl overflow-hidden pointer-events-auto", className)}>
      {/* 选项卡内容区域 */}
      <div className="p-2 h-48 overflow-y-auto w-72 scroll-smooth">
        {currentTab.type === "text" ? (
          <div className="grid grid-cols-8 gap-1">
            {EMOJI_LIST.map((emoji, i) => (
              <button
                key={i}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelectTextEmoji(emoji);
                }}
                className="w-8 h-8 hover:bg-app-hover rounded flex items-center justify-center text-xl transition-transform active:scale-90"
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {currentTab.images?.map((url, idx) => (
              <button
                key={idx}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelectImageEmoji(url);
                }}
                className="w-14 h-14 hover:bg-app-hover rounded p-1 transition-transform active:scale-95"
              >
                <img src={url} alt="emoji" className="w-full h-full object-contain" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 底部选项卡切换 */}
      <div className="flex items-center gap-2 p-2 bg-app-surface border-t border-app-border overflow-x-auto hide-scrollbar shrink-0">
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
              "w-8 h-8 rounded shrink-0 flex items-center justify-center transition-colors",
              activeTab === tab.id ? "bg-app-active/50 ring-1 ring-accent-primary" : "hover:bg-app-hover"
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
      </div>
    </div>
  );
}
