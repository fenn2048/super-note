import React, { useState } from "react";
import { BookOpen, Sparkles, Users, Key, Database, Smile, Rocket, HelpCircle, Shield, ArrowRight, Globe } from "lucide-react";

type SectionId = "quickstart" | "workspace" | "editor" | "data" | "health" | "clipper";

export default function ManualPanel() {
  const [activeSection, setActiveSection] = useState<SectionId>("quickstart");

  const menuItems = [
    { id: "quickstart" as const, label: "🚀 快速上手", desc: "创建笔记与基础操作" },
    { id: "workspace" as const, label: "🏠 家庭空间与协作", desc: "多用户共享与邀请" },
    { id: "editor" as const, label: "✍️ 智能排版与快捷键", desc: "编辑技巧与阅读密度" },
    { id: "clipper" as const, label: "🌐 浏览器剪藏插件", desc: "网页内容一键剪藏" },
    { id: "data" as const, label: "🔒 数据管理与安全", desc: "自动备份与恢复" },
    { id: "health" as const, label: "🛸 健康关怀提醒", desc: "太空飞船休息提醒" },
  ];

  return (
    <div className="flex flex-col lg:flex-row gap-6 min-h-[500px]">
      {/* 左侧微型导航 */}
      <div className="lg:w-48 shrink-0 flex flex-row lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-3 lg:pb-0 border-b lg:border-b-0 lg:border-r border-zinc-100 dark:border-zinc-800 lg:pr-3">
        {menuItems.map((item) => {
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={`flex-1 lg:flex-none text-left px-3 py-2 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
                isActive
                  ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/30 hover:text-zinc-900 dark:hover:text-zinc-200"
              }`}
            >
              <div className="text-xs">{item.label}</div>
              <div className="hidden lg:block text-[9px] text-zinc-400 dark:text-zinc-500 font-normal mt-0.5 truncate">
                {item.desc}
              </div>
            </button>
          );
        })}
      </div>

      {/* 右侧手册正文 */}
      <div className="flex-grow overflow-y-auto max-h-[60vh] pr-2 text-zinc-800 dark:text-zinc-200">
        {activeSection === "quickstart" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2 mb-2 text-zinc-950 dark:text-zinc-50">
                <Sparkles className="w-5 h-5 text-indigo-500" />
                欢迎使用 星空笔记
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                星空笔记（原 super-note）是一款专为个人记录与家庭/团队协作设计的现代笔记应用。支持富文本、说说 timeline、共享待办等模块，提供全方位的云同步与极致离线支持。
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-100 dark:border-zinc-800/60">
              <h3 className="text-sm font-semibold mb-2.5 text-zinc-900 dark:text-zinc-100">📌 核心功能一览</h3>
              <ul className="space-y-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                <li className="flex items-start gap-1.5">
                  <ArrowRight className="w-3.5 h-3.5 mt-0.5 shrink-0 text-indigo-500" />
                  <span><strong>多端实时同步</strong>：无论是网页端、桌面客户端，还是移动设备，您记录的每一行文字都通过 WebSocket 实时推送到所有设备。</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <ArrowRight className="w-3.5 h-3.5 mt-0.5 shrink-0 text-indigo-500" />
                  <span><strong>极致离线体验</strong>：当网络断开时，系统会自动将您的写操作加入安全离线队列，保存在本地。重新连接网络后，所有离线修改将在后台自动无缝合并，不影响任何操作。</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <ArrowRight className="w-3.5 h-3.5 mt-0.5 shrink-0 text-indigo-500" />
                  <span><strong>说说日记 timeline</strong>：点击“说说”选项卡，可快速记录碎片化的想法、随想、心情，并可附带图片与语音。</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <ArrowRight className="w-3.5 h-3.5 mt-0.5 shrink-0 text-indigo-500" />
                  <span><strong>共享待办清单</strong>：集成待办事项（Tasks）管理，可配置截止日期与提醒，实时追踪日常事务进度。</span>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2 text-zinc-900 dark:text-zinc-100">📝 创建您的第一篇笔记</h3>
              <ol className="list-decimal pl-4 space-y-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                <li>在左侧边栏顶部的<strong>笔记本区域</strong>，点击“+”号按钮创建一个笔记本。</li>
                <li>在左下角点击<strong>“新建笔记”</strong>按钮，或直接使用快捷键快捷新建。</li>
                <li>在编辑器中开始写作。您可以在顶部工具栏中使用标题、加粗、代码块、任务列表等丰富的排版功能。</li>
                <li>输入的内容会自动在后台同步。当您返回主页时，可以在“最近修改”区域中快速找回。</li>
              </ol>
            </div>
          </div>
        )}

        {activeSection === "workspace" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2 mb-2 text-zinc-950 dark:text-zinc-50">
                <Users className="w-5 h-5 text-indigo-500" />
                家庭空间与多用户协作
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                星空笔记 设计了直观的“工作区”（Workspace）概念，支持个人空间与协作空间双轨运行，方便您与家人、伙伴进行实时协作。
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-indigo-50/30 dark:bg-indigo-950/10 border border-indigo-100/40 dark:border-indigo-900/20">
              <h3 className="text-sm font-semibold mb-2 text-indigo-950 dark:text-indigo-400">💡 个人空间与共享空间</h3>
              <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                默认进入的<strong>个人空间</strong>属于您自己，其数据完全私密。而当您创建或加入了一个<strong>共享协作空间</strong>（例如“家庭空间”），该空间下的笔记、说说 timeline 以及待办事项都会对该空间内的所有成员公开，实现实时协作与信息互通。
              </p>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2 text-zinc-900 dark:text-zinc-100">🔗 邀请家人加入</h3>
              <ul className="list-disc pl-4 space-y-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                <li><strong>创建空间</strong>：在左侧导航栏下方的<strong>工作区选择器</strong>中，点击“创建空间”或“一键创建家庭空间”。</li>
                <li><strong>获取邀请码</strong>：点击工作区卡片旁的<strong>“管理成员”</strong>或<strong>“查看邀请码”</strong>，您可以获得一条分享链接以及一个 6 位字母数字的专属邀请码。</li>
                <li><strong>加入空间</strong>：家人收到链接或邀请码后，可在其客户端的工作区选择器中点击<strong>“使用邀请码加入”</strong>，输入邀请码后即可成功入驻。</li>
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2 text-zinc-900 dark:text-zinc-100">👤 角色与权限划分</h3>
              <table className="w-full text-[11px] border-collapse border border-zinc-200 dark:border-zinc-800 text-left text-zinc-600 dark:text-zinc-300">
                <thead>
                  <tr className="bg-zinc-50 dark:bg-zinc-900/60 font-semibold text-zinc-800 dark:text-zinc-200">
                    <th className="p-2 border border-zinc-200 dark:border-zinc-800">角色</th>
                    <th className="p-2 border border-zinc-200 dark:border-zinc-800">权限描述</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  <tr>
                    <td className="p-2 border border-zinc-200 dark:border-zinc-800 font-medium text-zinc-800 dark:text-zinc-100">所有者 (Owner)</td>
                    <td className="p-2 border border-zinc-200 dark:border-zinc-800">空间的创建者，拥有绝对权限，可编辑空间名、管理成员、删除空间。</td>
                  </tr>
                  <tr>
                    <td className="p-2 border border-zinc-200 dark:border-zinc-800 font-medium text-zinc-800 dark:text-zinc-100">管理员 (Admin)</td>
                    <td className="p-2 border border-zinc-200 dark:border-zinc-800">可生成邀请码、添加/移除普通成员、查看和管理空间内的所有内容。</td>
                  </tr>
                  <tr>
                    <td className="p-2 border border-zinc-200 dark:border-zinc-800 font-medium text-zinc-800 dark:text-zinc-100">编辑者 (Editor)</td>
                    <td className="p-2 border border-zinc-200 dark:border-zinc-800">普通家庭成员。可创建、修改和删除笔记、说说、待办，但无管理和删除空间的权限。</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeSection === "editor" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2 mb-2 text-zinc-950 dark:text-zinc-50">
                <Key className="w-5 h-5 text-indigo-500" />
                排版密度与快捷操作
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                星空笔记 配备了功能强大的富文本编辑器，同时支持调整界面的排版密度以适应不同的屏幕和浏览习惯。
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-100 dark:border-zinc-800/60">
                <h4 className="text-xs font-bold mb-1.5 text-zinc-800 dark:text-zinc-200">✨ Cozy（默认模式）</h4>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  拥有经典、宽松的文字行间距，适合日常细致阅读与长文推敲，段落呼吸感更强。
                </p>
              </div>
              <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-100 dark:border-zinc-800/60">
                <h4 className="text-xs font-bold mb-1.5 text-zinc-800 dark:text-zinc-200">⚡ Compact（紧凑模式）</h4>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  压缩编辑器段落与列表项的上下行距（减少约30%），单屏容纳更多代码与要点信息，适合大屏查阅。您可在设置中随时切换。
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2 text-zinc-900 dark:text-zinc-100">⌨️ 快捷键速查表</h3>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-2.5">
                使用快捷键可以成倍提高笔记管理效率，本应用支持以下核心快捷键组合：
              </p>
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs py-1 border-b border-zinc-100 dark:border-zinc-800">
                  <span className="text-zinc-600 dark:text-zinc-400">唤醒全局命令面板</span>
                  <span className="font-mono text-[10px] bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700">Cmd / Ctrl + K</span>
                </div>
                <div className="flex justify-between items-center text-xs py-1 border-b border-zinc-100 dark:border-zinc-800">
                  <span className="text-zinc-600 dark:text-zinc-400">新建笔记</span>
                  <span className="font-mono text-[10px] bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700">Cmd / Ctrl + N</span>
                </div>
                <div className="flex justify-between items-center text-xs py-1 border-b border-zinc-100 dark:border-zinc-800">
                  <span className="text-zinc-600 dark:text-zinc-400">打开设置</span>
                  <span className="font-mono text-[10px] bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700">Cmd / Ctrl + ,</span>
                </div>
                <div className="flex justify-between items-center text-xs py-1 border-b border-zinc-100 dark:border-zinc-800">
                  <span className="text-zinc-600 dark:text-zinc-400">聚焦搜索框</span>
                  <span className="font-mono text-[10px] bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700">Cmd / Ctrl + F</span>
                </div>
                <div className="flex justify-between items-center text-xs py-1 border-b border-zinc-100 dark:border-zinc-800">
                  <span className="text-zinc-600 dark:text-zinc-400">切换侧边栏展开/折叠</span>
                  <span className="font-mono text-[10px] bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700">Cmd / Ctrl + \</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection === "clipper" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2 mb-2 text-zinc-950 dark:text-zinc-50">
                <Globe className="w-5 h-5 text-indigo-500" />
                浏览器剪藏插件安装与使用
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                通过浏览器剪藏插件，您可以在浏览任意网页时一键将正文智能解析并永久保存至您的星空笔记中。
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-100 dark:border-zinc-800/60 space-y-4">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">📦 1. 插件安装方法</h3>
              <div className="space-y-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                <div>
                  <strong className="text-zinc-800 dark:text-zinc-200">第一步：获取插件包</strong>
                  <p className="mt-0.5">前往星空笔记的“设置 &rarr; 关于星空笔记”界面，在底部的“下载扩展与客户端”区域中，根据您使用的浏览器点击下载对应的 ZIP 插件压缩包，并解压到本地文件夹中。</p>
                </div>
                <div>
                  <strong className="text-zinc-800 dark:text-zinc-200">第二步：开启浏览器开发者模式</strong>
                  <ul className="list-disc pl-4 mt-1 space-y-1">
                    <li><strong className="text-zinc-700 dark:text-zinc-300">Chrome 浏览器</strong>：在地址栏输入 <code>chrome://extensions</code> 回车，然后开启右上角的“开发者模式”开关。</li>
                    <li><strong className="text-zinc-700 dark:text-zinc-300">Edge 浏览器</strong>：在地址栏输入 <code>edge://extensions</code> 回车，然后开启左侧或下方的“开发人员模式”开关。</li>
                    <li><strong className="text-zinc-700 dark:text-zinc-300">Firefox 浏览器</strong>：在地址栏输入 <code>about:debugging</code>，点击“此 Firefox”并点击“临时载入附加组件”选择解压出来的 manifest.json 载入，或通过签名包安装。</li>
                  </ul>
                </div>
                <div>
                  <strong className="text-zinc-800 dark:text-zinc-200">第三步：载入已解压的扩展程序</strong>
                  <p className="mt-0.5">在 Chrome 或 Edge 的扩展管理页面，点击左上角的“<strong className="text-zinc-700 dark:text-zinc-300">加载已解压的扩展程序</strong>” (Load unpacked) 按钮，选择您刚刚解压的插件文件夹。载入成功后，建议点击浏览器工具栏的拼图图标将“星空笔记网页剪藏”插件固定在工具栏。</p>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-indigo-50/30 dark:bg-indigo-950/10 border border-indigo-100/40 dark:border-indigo-900/20 space-y-4">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">⚙️ 2. 配置与连接</h3>
              <div className="space-y-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                <div>
                  <strong className="text-zinc-800 dark:text-zinc-200">第一步：填写服务器地址</strong>
                  <p className="mt-0.5">点击浏览器工具栏的星空笔记剪藏插件图标。在配置弹窗中，输入您部署的星空笔记服务器的完整 URL（例如：<code>http://192.168.1.100:3001</code>）。</p>
                </div>
                <div>
                  <strong className="text-zinc-800 dark:text-zinc-200">第二步：创建并填写访问令牌 (Token)</strong>
                  <p className="mt-0.5">
                    为了保障数据安全，插件需要使用个人访问令牌连接。请前往星空笔记网页端或客户端，打开“设置 → 访问令牌”界面，点击“创建令牌”，输入名称并勾选权限后创建。复制生成的令牌密钥，粘贴到剪藏插件的“Access Token”输入框中，点击保存连接。
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2 text-zinc-900 dark:text-zinc-100">🚀 3. 开始一键剪藏网页</h3>
              <ol className="list-decimal pl-4 space-y-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                <li>浏览任意网页时，点击浏览器右上角的星空笔记剪藏插件图标，或者在页面空白处点击右键，选择“剪藏到星空笔记”。</li>
                <li>插件会智能过滤广告，自动解析网页的文章正文并将其转为干净排版的 Markdown 格式。</li>
                <li>您可以在弹窗中预览或手动编辑解析后的正文与标题，选择要保存的目标笔记本、添加标签属性。</li>
                <li>点击“保存笔记”按钮，插件即会在后台将文章连同内嵌的图片和格式附件自动拉取保存到您的私有服务器中。</li>
              </ol>
            </div>
          </div>
        )}

        {activeSection === "data" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2 mb-2 text-zinc-950 dark:text-zinc-50">
                <Database className="w-5 h-5 text-indigo-500" />
                数据备份与导出安全
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                您的数据完全掌握在自己手中。我们提供了完善的数据备份机制，确保在硬盘损坏或异地迁移时能迅速救回内容。
              </p>
            </div>

            <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
              <h3 className="text-xs font-bold mb-1 flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <Shield className="w-4 h-4" />
                特别说明：数据库持久化
              </h3>
              <p className="text-[11px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
                虽然系统对外已全部命名为 <strong>Love Write</strong>，为了保证向前兼容性，底层的 SQLite 数据库文件名在服务器中依然保存为 <code>super-note.db</code>。此设计是为了防止已部署老版本的用户在更新版本后因文件名更改而导致数据读取失败或丢失。请勿擅自手动更改该物理数据库文件。
              </p>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2 text-zinc-900 dark:text-zinc-100">📥 备份与恢复方式</h3>
              <ul className="list-disc pl-4 space-y-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                <li><strong>个人数据导出</strong>：您可以在“数据管理”面板中，将个人空间的全部笔记以 <code>.zip</code> 压缩包或 <code>.json</code> 结构文件一键导出。</li>
                <li><strong>系统自动备份（管理员专用）</strong>：系统管理员可在数据面板中启用定时备份任务。备份类型包括“仅数据库 (db-only)”和“全量打包 (full)”两种：
                  <ul className="list-circle pl-4 mt-1 space-y-1 text-zinc-500">
                    <li><code>.bak</code> 纯数据库包：占用空间极小，仅存储文本结构。</li>
                    <li><code>.zip</code> 全量打包：除数据库外，还会将您上传的所有图片、附件以及系统生成的资源一同备份，防御整盘损毁。</li>
                  </ul>
                </li>
                <li><strong>邮件通道（自动灾备）</strong>：在设置的“邮件通道”中配置 SMTP 后，系统支持在自动备份任务成功后将备份文件以邮件附件（25MB限制内）的形式安全投递到您的指定邮箱，实现异地容灾。</li>
                <li><strong>Android 诊断日志导出</strong>：Android 客户端用户在“设置”的“关于”界面可以一键“导出运行日志”，并通过系统分享渠道（微信、邮件等）导出，便于遇到异常时协助排查。</li>
              </ul>
            </div>
          </div>
        )}

        {activeSection === "health" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2 mb-2 text-zinc-950 dark:text-zinc-50">
                <Rocket className="w-5 h-5 text-indigo-500" />
                健康作息关怀提醒
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                沉浸于码字或阅读常常让人忘记时间。Love Write 特别设计了富有趣味性的“太空飞船健康提醒”系统，时刻关注您的身体状态。
              </p>
            </div>

            <div className="p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/20">
              <h3 className="text-xs font-bold mb-1 flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
                <Shield className="w-4 h-4" />
                特别说明：颈椎健康休息室
              </h3>
              <p className="text-[11px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
                休息室中提供的<strong>“收敛下巴，对齐颈椎”</strong>动作校准目前是一个趣味模拟互动，采用手动的“对齐滑块”进行，<strong>并不需要也未实际开启您的摄像头</strong>进行实时图像分析，请放心体验。
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-100 dark:border-zinc-800/60">
              <h3 className="text-sm font-semibold mb-2.5 flex items-center gap-1.5 text-zinc-900 dark:text-zinc-100">
                <Smile className="w-4 h-4 text-indigo-500" />
                提醒触发机制
              </h3>
              <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                当您在浏览器或客户端中<strong>连续浏览/编辑本站内容超过设定时间</strong>（默认 30 分钟）时：
              </p>
              <ol className="list-decimal pl-4 mt-2 space-y-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                <li>一艘闪烁着尾部火焰的<strong>太空飞船</strong>将会平滑地从屏幕左侧飞入，缓缓飞跃整个视口并在右侧消失。此动作会<strong>连续飞跃 3 次</strong>，起到温和的视觉暗示作用。</li>
                <li>随后屏幕中央将弹出一个玻璃磨砂风格的<strong>关怀卡片</strong>，提醒您：<strong>眨眨眼/远眺放松眼睛</strong>、<strong>喝杯水补充水分</strong>、<strong>站立起来伸展肢体活动活动</strong>。</li>
                <li>您可以点击卡片下方的“好的，我会注意的”按钮关闭提醒。此时系统将重新为您安排下一轮浏览计时。</li>
              </ol>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2 text-zinc-900 dark:text-zinc-100">⚙️ 如何修改提醒间隔</h3>
              <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                默认的提醒间隔为 <strong>30 分钟</strong>。若您认为提醒过于频繁或间隔过长，可以按以下步骤修改：
              </p>
              <ol className="list-decimal pl-4 mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-300">
                <li>打开“设置”对话框。</li>
                <li>切换至<strong>“开关偏好” (Switches)</strong> 选项卡。</li>
                <li>在设置列表中找到<strong>“健康休息提醒间隔”</strong>下拉选择框。</li>
                <li>可将间隔值更改为 15 分钟、30 分钟、45 分钟、1 小时、1.5 小时或 2 小时。</li>
                <li>修改将即时生效，无需重启客户端，系统已自动重置并以新间隔重新为您计时。</li>
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
