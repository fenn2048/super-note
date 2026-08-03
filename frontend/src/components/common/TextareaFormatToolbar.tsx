import React, { useState, useEffect, useRef } from "react";
import {
  Bold,
  Italic,
  Code,
  Palette,
  ChevronDown,
  Heading1,
  Heading2,
  Heading3,
  Type,
  List,
  Minus,
  ListOrdered,
  Quote,
  CheckSquare,
  Check,
  Link,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { COLOR_PRESETS } from "@/components/FontSizeExtension";

interface TextareaFormatToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (val: string) => void;
  className?: string;
}

export default function TextareaFormatToolbar({
  textareaRef,
  value,
  onChange,
  className,
}: TextareaFormatToolbarProps) {
  const { t } = useTranslation();
  const [isFormatOpen, setIsFormatOpen] = useState(false);
  const [isColorOpen, setIsColorOpen] = useState(false);
  
  const formatMenuRef = useRef<HTMLDivElement>(null);
  const colorMenuRef = useRef<HTMLDivElement>(null);

  // Click outside to close menus
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (formatMenuRef.current && !formatMenuRef.current.contains(target)) {
        setIsFormatOpen(false);
      }
      if (colorMenuRef.current && !colorMenuRef.current.contains(target)) {
        setIsColorOpen(false);
      }
    };
    
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick, { passive: true });
    
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, []);

  const focusTextarea = (selStart: number, selEnd: number) => {
    setTimeout(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(selStart, selEnd);
      }
    }, 10);
  };

  // 1. Bold Formatting
  const handleBold = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.substring(start, end);
    
    let newValue = "";
    let newStart = start;
    let newEnd = end;
    
    if (selected.startsWith("**") && selected.endsWith("**")) {
      const unwrapped = selected.substring(2, selected.length - 2);
      newValue = value.substring(0, start) + unwrapped + value.substring(end);
      newEnd = start + unwrapped.length;
    } else {
      newValue = value.substring(0, start) + `**${selected}**` + value.substring(end);
      newStart = start + 2;
      newEnd = end + 2;
    }
    
    onChange(newValue);
    focusTextarea(newStart, newEnd);
  };

  // 2. Italic Formatting
  const handleItalic = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.substring(start, end);
    
    let newValue = "";
    let newStart = start;
    let newEnd = end;
    
    if (selected.startsWith("*") && selected.endsWith("*") && !selected.startsWith("**")) {
      const unwrapped = selected.substring(1, selected.length - 1);
      newValue = value.substring(0, start) + unwrapped + value.substring(end);
      newEnd = start + unwrapped.length;
    } else {
      newValue = value.substring(0, start) + `*${selected}*` + value.substring(end);
      newStart = start + 1;
      newEnd = end + 1;
    }
    
    onChange(newValue);
    focusTextarea(newStart, newEnd);
  };

  // 3. Monospace Formatting
  const handleMonospace = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.substring(start, end);
    
    let newValue = "";
    let newStart = start;
    let newEnd = end;
    
    if (selected.startsWith("`") && selected.endsWith("`")) {
      const unwrapped = selected.substring(1, selected.length - 1);
      newValue = value.substring(0, start) + unwrapped + value.substring(end);
      newEnd = start + unwrapped.length;
    } else {
      newValue = value.substring(0, start) + `\`${selected}\`` + value.substring(end);
      newStart = start + 1;
      newEnd = end + 1;
    }
    
    onChange(newValue);
    focusTextarea(newStart, newEnd);
  };

  // Link Formatting
  const handleLink = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.substring(start, end);

    let linkText = selected;
    if (!linkText) {
      const promptedText = window.prompt(t("format.enterLinkText", "输入链接文本"), "");
      if (promptedText === null) return;
      linkText = promptedText || t("format.linkDefaultText", "链接");
    }

    const url = window.prompt(t("format.enterLinkUrl", "输入链接地址 (URL)"), "https://");
    if (url === null) return;

    const formatted = `[${linkText}](${url})`;
    const newValue = value.substring(0, start) + formatted + value.substring(end);
    
    onChange(newValue);
    focusTextarea(start + 1, start + 1 + linkText.length);
  };

  // 4. Color Formatting
  const handleColor = (color: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.substring(start, end);
    
    const tagOpen = `<span style="color: ${color}">`;
    const tagClose = "</span>";
    
    const newValue = value.substring(0, start) + tagOpen + selected + tagClose + value.substring(end);
    const newStart = start + tagOpen.length;
    const newEnd = newStart + selected.length;
    
    onChange(newValue);
    setIsColorOpen(false);
    focusTextarea(newStart, newEnd);
  };

  const handleClearColor = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.substring(start, end);
    
    const spanMatch = selected.match(/^<span style="color:\s*[^"]+">(.*)<\/span>$/s);
    if (spanMatch) {
      const unwrapped = spanMatch[1];
      const newValue = value.substring(0, start) + unwrapped + value.substring(end);
      onChange(newValue);
      setIsColorOpen(false);
      focusTextarea(start, start + unwrapped.length);
    }
  };

  // 5. Line/Block level Formatting
  const handleBlockFormat = (
    type: "h1" | "h2" | "h3" | "body" | "bullet" | "dash" | "ordered" | "quote" | "checklist" | "checked"
  ) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    
    // Find the full line boundary containing the selection
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = value.indexOf("\n", end);
    if (lineEnd === -1) lineEnd = value.length;
    
    const before = value.substring(0, lineStart);
    const after = value.substring(lineEnd);
    const targetText = value.substring(lineStart, lineEnd);
    
    const lines = targetText.split("\n");
    const formattedLines = lines.map((line, idx) => {
      let cleanLine = line;
      // Strip any existing block indicators at the beginning of the line
      const headingMatch = line.match(/^(#{1,6})\s+/);
      const checklistMatch = line.match(/^(-\s+\[[ xX]\])\s+/);
      const bulletMatch = line.match(/^([\*\-\+])\s+/);
      const numberedMatch = line.match(/^(\d+\.)\s+/);
      const quoteMatch = line.match(/^(>)\s+/);
      
      if (headingMatch) cleanLine = line.substring(headingMatch[0].length);
      else if (checklistMatch) cleanLine = line.substring(checklistMatch[0].length);
      else if (bulletMatch) cleanLine = line.substring(bulletMatch[0].length);
      else if (numberedMatch) cleanLine = line.substring(numberedMatch[0].length);
      else if (quoteMatch) cleanLine = line.substring(quoteMatch[0].length);
      
      switch (type) {
        case "h1":
          return `### ${cleanLine}`; // 标题
        case "h2":
          return `#### ${cleanLine}`; // 小标题
        case "h3":
          return `##### ${cleanLine}`; // 副标题
        case "body":
          return cleanLine; // 正文
        case "bullet":
          return `* ${cleanLine}`; // 项目符号列表
        case "dash":
          return `- ${cleanLine}`; // 短划线列表
        case "ordered":
          return `${idx + 1}. ${cleanLine}`; // 编号列表
        case "quote":
          return `> ${cleanLine}`; // 块引用
        case "checklist":
          return `- [ ] ${cleanLine}`; // 核对清单
        case "checked":
          return `- [x] ${cleanLine}`; // 标记为已勾选
        default:
          return line;
      }
    });
    
    const newTargetText = formattedLines.join("\n");
    const newValue = before + newTargetText + after;
    
    onChange(newValue);
    setIsFormatOpen(false);
    
    const diff = newTargetText.length - targetText.length;
    focusTextarea(start, end + diff);
  };

  const blockMenuItems = [
    { type: "h1", label: t("format.h1", "标题"), icon: <Heading1 size={14} /> },
    { type: "h2", label: t("format.h2", "小标题"), icon: <Heading2 size={14} /> },
    { type: "h3", label: t("format.h3", "副标题"), icon: <Heading3 size={14} /> },
    { type: "body", label: t("format.body", "正文"), icon: <Type size={14} /> },
    { type: "bullet", label: t("format.bulletList", "项目符号列表"), icon: <List size={14} /> },
    { type: "dash", label: t("format.dashList", "短划线列表"), icon: <Minus size={14} /> },
    { type: "ordered", label: t("format.orderedList", "编号列表"), icon: <ListOrdered size={14} /> },
    { type: "quote", label: t("format.blockquote", "块引用"), icon: <Quote size={14} /> },
    { type: "checklist", label: t("format.checklist", "核对清单"), icon: <CheckSquare size={14} /> },
    { type: "checked", label: t("format.checkedList", "标记为已勾选"), icon: <Check size={14} /> },
  ] as const;

  return (
    <div className={cn("flex items-center gap-1.5 p-1 bg-app-elevated border border-app-border rounded-lg select-none relative w-fit mb-1.5", className)}>
      
      {/* Block Format Dropdown */}
      <div ref={formatMenuRef} className="relative">
        <button
          type="button"
          onClick={() => {
            setIsFormatOpen(!isFormatOpen);
            setIsColorOpen(false);
          }}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-md text-tx-secondary hover:text-tx-primary hover:bg-app-hover transition-colors"
          title={t("format.blockDropdown", "段落格式")}
        >
          <Type size={14} />
          <ChevronDown size={12} className={cn("transition-transform", isFormatOpen && "rotate-180")} />
        </button>

        {isFormatOpen && (
          <div className="absolute top-full left-0 mt-1.5 z-[150] w-[160px] p-1 bg-app-elevated border border-app-border rounded-lg shadow-xl animate-in fade-in slide-in-from-top-1 duration-100">
            {blockMenuItems.map((item) => (
              <button
                key={item.type}
                type="button"
                onClick={() => handleBlockFormat(item.type)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-tx-primary hover:bg-app-hover rounded transition-colors text-left"
              >
                <span className="text-tx-secondary shrink-0">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="w-[1px] h-4 bg-app-border" />

      {/* Bold */}
      <button
        type="button"
        onClick={handleBold}
        className="p-1 rounded-md text-tx-secondary hover:text-tx-primary hover:bg-app-hover transition-colors"
        title={t("format.bold", "加粗")}
      >
        <Bold size={14} />
      </button>

      {/* Italic */}
      <button
        type="button"
        onClick={handleItalic}
        className="p-1 rounded-md text-tx-secondary hover:text-tx-primary hover:bg-app-hover transition-colors"
        title={t("format.italic", "斜体")}
      >
        <Italic size={14} />
      </button>

      {/* Monospace (等宽样式) */}
      <button
        type="button"
        onClick={handleMonospace}
        className="p-1 rounded-md text-tx-secondary hover:text-tx-primary hover:bg-app-hover transition-colors"
        title={t("format.monospace", "等宽样式")}
      >
        <Code size={14} />
      </button>

      {/* Link (超链接) */}
      <button
        type="button"
        onClick={handleLink}
        className="p-1 rounded-md text-tx-secondary hover:text-tx-primary hover:bg-app-hover transition-colors"
        title={t("format.link", "插入超链接")}
      >
        <Link size={14} />
      </button>

      {/* Color Picker Popover */}
      <div ref={colorMenuRef} className="relative">
        <button
          type="button"
          onClick={() => {
            setIsColorOpen(!isColorOpen);
            setIsFormatOpen(false);
          }}
          className="p-1 rounded-md text-tx-secondary hover:text-tx-primary hover:bg-app-hover transition-colors"
          title={t("format.color", "字体颜色")}
        >
          <Palette size={14} />
        </button>

        {isColorOpen && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-[150] w-[160px] p-2 bg-app-elevated border border-app-border rounded-lg shadow-xl animate-in fade-in slide-in-from-top-1 duration-100">
            <p className="text-[10px] text-tx-tertiary mb-1.5 px-0.5 truncate">
              {t("format.selectColor", "选择字体颜色")}
            </p>
            <div className="grid grid-cols-4 gap-1.5 mb-2">
              {COLOR_PRESETS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => handleColor(color)}
                  style={{ backgroundColor: color }}
                  className="w-5 h-5 rounded-full [@media(hover:hover)_and_(pointer:fine)]:hover:scale-110 active:scale-95 shadow-sm border border-black/10 transition-transform"
                  title={color}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={handleClearColor}
              className="w-full text-center py-1 text-[10px] text-tx-secondary hover:text-tx-primary hover:bg-app-hover rounded border border-app-border transition-colors font-medium"
            >
              {t("format.clearColor", "清除颜色")}
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
