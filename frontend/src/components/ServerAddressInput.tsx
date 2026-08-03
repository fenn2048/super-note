import React from "react";
import { Globe, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  parseServerUrl,
  type ServerAddressParts,
  type ServerScheme,
} from "@/lib/serverUrl";

/**
 * 判定一段文本是否"看起来是一整段 URL"——只要命中其一就尝试自动拆分：
 *   1) 显式带 scheme：     http://...   https://...
 *   2) host 后跟 :port：   39.106.81.133:666 / example.com:8080
 *   3) host 后跟 /path：   example.com/api
 * 单纯写 IP 或域名（没有冒号、没有斜杠）不命中，避免用户正常逐字符输入
 * 主机名时被误识别成 URL 反复拆分。
 *
 * 注意：IPv6 字面地址（含多个冒号）暂不在此判定，因为 Host 输入框约定不收
 * IPv6（serverUrl.ts 也明说）。如果以后要支持，需要在这里区分 ":\d+$" 与
 * IPv6 形式（含括号或多冒号）。
 */
function looksLikeFullUrl(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  // 域名/IP 后紧跟 :端口
  if (/^[^\s:/]+:\d+(\/|$)/.test(s)) return true;
  // 域名/IP 后紧跟 /
  if (/^[^\s:/]+\//.test(s)) return true;
  return false;
}

/**
 * 登录 / 服务器连接页共用的地址输入组件。
 *
 * 桌面横向：
 *   [ http ▾ ] [ :// ] [        host 输入框        ] [  : port  ]
 *
 * 移动端（两行）：
 *   [ http ▾ ……………………………… 状态 ]
 *   [ :// host ………………… ] [ : port ]
 */

export interface ServerAddressInputProps {
  value: ServerAddressParts;
  onChange: (next: ServerAddressParts) => void;
  /** host blur 时触发——LoginPage 用它做"失焦自动测连接" */
  onHostBlur?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
  /** 右侧额外图标（连接状态） */
  rightSlot?: React.ReactNode;
  /** 主色调：emerald | indigo（两个调用页的配色不同） */
  accent?: "emerald" | "indigo";
}

const ACCENT_CLASS: Record<NonNullable<ServerAddressInputProps["accent"]>, string> = {
  emerald:
    "focus-within:ring-2 focus-within:ring-emerald-500/40 focus-within:border-emerald-500 dark:focus-within:border-emerald-500",
  indigo:
    "focus-within:ring-2 focus-within:ring-accent-primary/40 focus-within:border-accent-primary dark:focus-within:border-accent-primary",
};

export default function ServerAddressInput({
  value,
  onChange,
  onHostBlur,
  autoFocus,
  disabled,
  rightSlot,
  accent = "indigo",
}: ServerAddressInputProps) {
  const { t } = useTranslation();
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  const update = (patch: Partial<ServerAddressParts>) => onChange({ ...value, ...patch });

  /**
   * 用户在 host 输入框里粘贴 / 输入了一整段 URL 时，自动拆成 protocol + host + port
   * 三段并整体替换。这是为了解决"用户从浏览器复制 http://x.x.x.x:666/ 这种带尾斜杠
   * 的整段 URL 时，按字段输入要拆三次"的痛点。
   *
   * 触发时机：
   *   - onPaste：监听粘贴事件最稳定，preventDefault 后我们自己把数据写回去。
   *   - onChange（host 字段）：用户也可能直接键盘输入一段（例如手机上长按复制的
   *     URL 通过键盘候选词整段贴入），所以 onChange 里 也要做一次"看着像 URL 就
   *     拆"的兜底。注意只在"明显像 URL"时拆，避免用户正常逐字符输入主机名时
   *     被反复拆分（参见 looksLikeFullUrl 的注释）。
   *
   * 拆分使用 serverUrl.ts 的 parseServerUrl，它已经处理了：
   *   - 缺 scheme 时默认 http
   *   - 末尾斜杠 / path / query
   *   - 解析失败兜底返回空地址（这种情况我们就不替换，按用户原始输入处理）
   */
  const tryAutoSplit = (raw: string): boolean => {
    if (!looksLikeFullUrl(raw)) return false;
    const parsed = parseServerUrl(raw);
    if (!parsed.host) return false;
    onChange(parsed);
    return true;
  };

  const handleHostChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (tryAutoSplit(raw)) return;
    update({ host: raw });
  };

  const handleHostPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text) return;
    if (tryAutoSplit(text)) {
      // 自己已经把三段都填好了；阻止浏览器把整段塞进 host 字段
      e.preventDefault();
    }
  };

  const handlePortPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    // 粘贴到 port 框时，如果对方也是一整段 URL，同样应该拆分（用户行为预期）
    const text = e.clipboardData.getData("text");
    if (!text) return;
    if (tryAutoSplit(text)) {
      e.preventDefault();
    }
  };

  return (
    <div
      className={
        "relative flex flex-col md:flex-row md:items-stretch w-full " +
        "border border-app-border rounded-xl " +
        "bg-app-surface/80 transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out overflow-hidden " +
        ACCENT_CLASS[accent]
      }
    >
      {/* Protocol select — 移动端单独一行，桌面侧栏 */}
      <div className="relative flex items-center pl-3 pr-1 border-b md:border-b-0 md:border-r border-app-border w-full md:w-auto min-h-[48px] md:min-h-0">
        <Globe className="h-4 w-4 text-tx-tertiary mr-1.5 shrink-0" />
        <select
          value={value.protocol}
          disabled={disabled}
          onChange={(e) => update({ protocol: e.target.value as ServerScheme })}
          aria-label={t("server.protocolLabel")}
          className={
            "appearance-none bg-transparent text-base md:text-sm text-tx-primary " +
            "focus:outline-none pr-5 py-3 md:py-2.5 cursor-pointer disabled:cursor-not-allowed w-full md:w-auto"
          }
        >
          <option value="http">http</option>
          <option value="https">https</option>
        </select>
        <ChevronDown className="h-3.5 w-3.5 text-tx-tertiary absolute right-4 md:right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
        {/* 移动端：状态图标挂在协议行右侧 */}
        {rightSlot && (
          <div className="md:hidden ml-auto pr-3 flex items-center">{rightSlot}</div>
        )}
      </div>

      {/* Host + Port 同一行（移动 host 优先宽，port 短） */}
      <div className="flex items-stretch flex-1 min-w-0">
        <div className="flex items-center flex-1 min-w-0">
          <span className="select-none flex items-center pl-3 pr-1.5 text-xs text-tx-tertiary">
            ://
          </span>
          <input
            type="text"
            value={value.host}
            onChange={handleHostChange}
            onPaste={handleHostPaste}
            onBlur={onHostBlur}
            placeholder={isMobile ? "主机域名或 IP" : t("server.hostPlaceholder")}
            autoFocus={autoFocus}
            disabled={disabled}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
            className={
              "flex-1 min-w-0 bg-transparent py-3 md:py-2.5 pr-2 text-base md:text-sm " +
              "text-tx-primary placeholder:text-tx-tertiary " +
              "focus:outline-none disabled:cursor-not-allowed"
            }
          />
        </div>

        <div className="flex items-center border-l border-app-border w-[88px] md:w-[120px] shrink-0">
          <span className="select-none flex items-center pl-2 pr-0.5 text-base md:text-sm text-tx-tertiary">
            :
          </span>
          <input
            type="text"
            value={value.port}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 5);
              update({ port: v });
            }}
            onPaste={handlePortPaste}
            placeholder={t("server.portPlaceholder")}
            disabled={disabled}
            inputMode="numeric"
            pattern="\d*"
            maxLength={5}
            aria-label={t("server.portLabel")}
            className={
              "flex-1 bg-transparent py-3 md:py-2.5 pr-2 text-base md:text-sm text-left md:text-center " +
              "text-tx-primary placeholder:text-tx-tertiary " +
              "focus:outline-none disabled:cursor-not-allowed"
            }
          />
        </div>

        {/* 桌面：状态槽 */}
        {rightSlot && (
          <div className="hidden md:flex items-center pr-3 pl-1">{rightSlot}</div>
        )}
      </div>
    </div>
  );
}
