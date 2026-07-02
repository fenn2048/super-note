import React, { useState, useEffect, useCallback } from "react";
import { Bot, Sparkles, HelpCircle, Archive, Cpu, History, FileText, ChevronDown, ChevronRight, RefreshCw, Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface PromptItem {
  key: string;
  name: string;
  desc?: string;
  placeholder: string;
}

interface Category {
  id: string;
  title: string;
  description: string;
  items: PromptItem[];
}

const DEFAULT_PROMPTS = {
  ai_prompt_writing_system: "你是一个专业的写作助手，帮助用户优化笔记内容。请直接输出结果，不要添加额外的解释或前缀。",
  ai_prompt_writing_continue: "请根据上下文，自然流畅地续写以下内容。不要重复已有内容，直接输出续写部分：",
  ai_prompt_writing_rewrite: "请用不同的表达方式改写以下内容，保持原意不变：",
  ai_prompt_writing_polish: "请对以下内容进行润色，使其更加专业流畅，保持原意：",
  ai_prompt_writing_shorten: "请将以下内容精简压缩，保留核心要点，去除冗余：",
  ai_prompt_writing_expand: "请对以下内容进行扩展，增加更多细节和解释，使其更充实：",
  ai_prompt_writing_translate_en: "请将以下内容翻译为英文，保持原意和风格：",
  ai_prompt_writing_translate_zh: "请将以下内容翻译为中文，保持原意和风格：",
  ai_prompt_writing_summarize: "请为以下内容生成一个简洁的摘要（100字以内）：",
  ai_prompt_writing_explain: "请用通俗易懂的语言解释以下内容：",
  ai_prompt_writing_fix_grammar: "请修正以下内容中的语法和拼写错误，只返回修正后的文本：",
  ai_prompt_writing_format_markdown: "请将以下内容按照规范的 Markdown 格式重新排版，合理使用标题、列表、代码块、表格、加粗、引用等格式元素，保持原意不变，使内容结构更清晰：",
  ai_prompt_writing_format_code: "请识别以下内容中的代码部分，用正确的编程语言标记包裹在代码块中（如 ```python），保持代码缩进和格式正确。如果内容本身就是纯代码，直接用代码块包裹并标注语言：",
  ai_prompt_writing_title: "请根据以下笔记内容，生成一个简洁准确的标题（10字以内），只返回标题文本，不要加引号或其他标点：",
  ai_prompt_writing_tags: "请根据以下笔记内容，推荐3-5个标签关键词。每个标签用逗号分隔，只返回标签文本，不要加#号：",

  ai_prompt_rag_with_notes: "你是一个智能知识库助手。请基于用户的知识库笔记内容来回答问题。如果笔记中包含相关信息，请引用并标明来源笔记标题。如果笔记中没有相关信息，可以基于你的知识回答，但请说明这不是来自知识库的内容。\n\n以下是与问题相关的笔记内容：\n\n${contextBlock}",
  ai_prompt_rag_without_notes: "你是一个智能知识库助手。用户的知识库中暂未找到与问题相关的内容。请基于你的知识回答问题，并告知用户这些信息不是来自其知识库。",

  ai_prompt_clipper_organize_zh: "你是一位资深的网页剪藏助手，专门帮用户把杂乱的网页正文整理成可读、可检索、可归档的笔记素材。\n\n请严格按用户要求的字段输出**纯 JSON**（不要包裹在 markdown 代码块里，不要任何前后缀解释）。\n\n输出 JSON 的字段要求：\n{\n${schemaFields}\n}\n\n通用规则：\n1. 字段值用简体中文。\n2. 摘要保持客观，不复制原文连续大段，不臆造信息。\n3. 标签用名词短语（如\"前端工程\"、\"产品设计\"），不要用句子，不要带 # 号。\n4. 大纲要反映原文真实结构，不是凭空想象的目录。\n5. 如果原文质量太低（广告/导航文本/乱码）以致无法完成任务，对应字段输出空字符串或空数组，但 JSON 结构保持完整。\n6. 不要输出 JSON 之外的任何字符。",
  ai_prompt_clipper_organize_en: "You are a web clipper assistant. Output strict JSON (no markdown code fences, no explanation) with the following fields:\n\n{\n${schemaFields}\n}\n\nRules: be concise, neutral, faithful to source. If source is unusable, return empty string/array for that field but keep JSON structure intact.",

  ai_prompt_url_import_note: "请将以下文档内容整理为结构化的笔记格式（Markdown），合理使用标题层级、列表、表格、代码块等元素，保留原始信息不丢失，使内容清晰易读：",
  ai_prompt_url_import_text: "请将以下文档内容转换为规范的 Markdown 格式，保持原始结构和内容不变，合理使用标题、列表、表格、代码块、引用等格式元素：",
  ai_prompt_url_import_system: "你是一个专业的文档格式化助手。请直接输出格式化后的 Markdown 内容，不要添加额外的解释、前缀或总结。",

  ai_prompt_format_file_attachment_system: "你是一个专业的文档格式化助手。请将内容转换为规范的 Markdown 格式，合理使用标题层级、列表、表格、代码块、引用等元素。保持原始图片链接（![...](...)）不变。保持代码块的语言标记正确。保持内嵌表格格式完整。直接输出结果，不要添加额外解释。",
  ai_prompt_format_text_attachment_system: "你是一个文档格式化助手。请将文档内容整理为结构清晰的 Markdown 笔记格式，保留原始信息。直接输出结果。",

  ai_prompt_format_diary: "你是一个说说写作和内容整理助手。请对用户输入的“说说”进行排版、梳理和优化整理，要求：\n1. 语言条理清晰，层次分明，逻辑连贯。\n2. 保持用户表达的原意，不要大幅删改事实内容。\n3. 优化错别字、标点符号，并适当使用段落、换行或列表以增加可读性。\n4. 不要返回任何前言、后记或解释旁白，必须直接返回整理优化后的内容主体。",

  ai_prompt_suggest_notebook: "你是一个专业的笔记归类助手。用户会提供一条笔记的标题与摘要，以及可选的目标笔记本列表。\n\n任务：根据笔记标题和摘要，从候选笔记本列表中推荐 1-3 个最相关的笔记本。按照相关性从高到低排序，以 JSON 格式输出建议，不需要任何解释前缀或后缀。输出格式必须是一个 JSON 对象，包含 \"suggestions\" 字段，字段值是一个数组，每个元素包含 \"notebookId\"（字符串）和 \"confidence\"（0-1 之间的浮点数，代表推荐信心度）。\n\n规则：\n1) 仅从提供的“候选笔记本列表”中选择 ID。不可捏造不存在的 ID；\n2) 如果候选列表为空，或者没有一个笔记本适合此笔记，返回空列表 {\"suggestions\":[]}；\n3) 按 confidence 从高到低排序；\n4) 如果没有任何合适的笔记本，返回 {\"suggestions\":[]}。",

  ai_prompt_diary_worker_post: "你是一位知识渊博的专家助手，基于用户的笔记、说说和项目信息回答问题。请给出简明扼要、专业的回答，不要超过 500 字。直接回答用户问题，不要添加无关信息。",
  ai_prompt_diary_worker_comment: "你是一位专业分析助手，基于当前说说及其评论内容回答问题。请给出简明扼要、有洞察力的分析。不要超过 500 字。",
};

export default function AIPromptPanel() {
  const { t } = useTranslation();
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    writing: true,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const loadSettings = useCallback(async () => {
    try {
      const data = await api.getAISettings();
      const loaded: Record<string, string> = {};
      for (const key of Object.keys(DEFAULT_PROMPTS)) {
        loaded[key] = data[key] !== undefined ? data[key] : "";
      }
      setPrompts(loaded);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const toggleCategory = (catId: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [catId]: !prev[catId],
    }));
  };

  const handlePromptChange = (key: string, value: string) => {
    setPrompts(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleResetItem = (key: string) => {
    setPrompts(prev => ({
      ...prev,
      [key]: "",
    }));
  };

  const handleResetAll = () => {
    if (window.confirm("确定要将所有提示词恢复为默认值吗？此操作在保存前不会写入数据库。")) {
      const reset: Record<string, string> = {};
      for (const key of Object.keys(DEFAULT_PROMPTS)) {
        reset[key] = "";
      }
      setPrompts(reset);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMsg("");
    try {
      const payload: Record<string, string> = {};
      for (const key of Object.keys(prompts)) {
        payload[key] = prompts[key];
      }
      await api.updateAISettings(payload);
      setSaveMsg("保存成功！已更新全局自定义提示词。");
      setTimeout(() => setSaveMsg(""), 3000);
    } catch (err: any) {
      setSaveMsg(err.message || "保存失败");
    } finally {
      setIsSaving(false);
    }
  };

  const categories: Category[] = [
    {
      id: "writing",
      title: "写作助手 (Writing Assistant)",
      description: "配置编辑器中 AI 写作功能（如润色、续写、翻译等）的系统 Prompt 和各动作的指令内容。",
      items: [
        {
          key: "ai_prompt_writing_system",
          name: "全局系统角色定义 (System Prompt)",
          desc: "写作助手的全局设定。告诉 AI 他是什么角色，如何进行输出。",
          placeholder: DEFAULT_PROMPTS.ai_prompt_writing_system,
        },
        {
          key: "ai_prompt_writing_continue",
          name: "动作：续写 (Continue)",
          placeholder: DEFAULT_PROMPTS.ai_prompt_writing_continue,
        },
        {
          key: "ai_prompt_writing_rewrite",
          name: "动作：改写 (Rewrite)",
          placeholder: DEFAULT_PROMPTS.ai_prompt_writing_rewrite,
        },
        {
          key: "ai_prompt_writing_polish",
          name: "动作：润色 (Polish)",
          placeholder: DEFAULT_PROMPTS.ai_prompt_writing_polish,
        },
        {
          key: "ai_prompt_writing_shorten",
          name: "动作：精简 (Shorten)",
          placeholder: DEFAULT_PROMPTS.ai_prompt_writing_shorten,
        },
        {
          key: "ai_prompt_writing_expand",
          name: "动作：扩展 (Expand)",
          placeholder: DEFAULT_PROMPTS.ai_prompt_writing_expand,
        },
        {
          key: "ai_prompt_writing_translate_en",
          name: "动作：翻译为英文 (Translate to English)",
          placeholder: DEFAULT_PROMPTS.ai_prompt_writing_translate_en,
        },
        {
          key: "ai_prompt_writing_translate_zh",
          name: "动作：翻译为中文 (Translate to Chinese)",
          placeholder: DEFAULT_PROMPTS.ai_prompt_writing_translate_zh,
        },
        {
          key: "ai_prompt_writing_summarize",
          name: "动作：生成摘要 (Summarize)",
          placeholder: DEFAULT_PROMPTS.ai_prompt_writing_summarize,
        },
        {
          key: "ai_prompt_writing_explain",
          name: "动作：解释内容 (Explain)",
          placeholder: DEFAULT_PROMPTS.ai_prompt_writing_explain,
        },
        {
          key: "ai_prompt_writing_fix_grammar",
          name: "动作：修正语法 (Fix Grammar)",
          placeholder: DEFAULT_PROMPTS.ai_prompt_writing_fix_grammar,
        },
        {
          key: "ai_prompt_writing_format_markdown",
          name: "动作：排版为 Markdown (Format Markdown)",
          placeholder: DEFAULT_PROMPTS.ai_prompt_writing_format_markdown,
        },
        {
          key: "ai_prompt_writing_format_code",
          name: "动作：格式化代码 (Format Code)",
          placeholder: DEFAULT_PROMPTS.ai_prompt_writing_format_code,
        },
        {
          key: "ai_prompt_writing_title",
          name: "动作：生成标题 (Generate Title)",
          placeholder: DEFAULT_PROMPTS.ai_prompt_writing_title,
        },
        {
          key: "ai_prompt_writing_tags",
          name: "动作：生成标签 (Generate Tags)",
          placeholder: DEFAULT_PROMPTS.ai_prompt_writing_tags,
        },
      ],
    },
    {
      id: "rag",
      title: "知识库问答 (Knowledge Base Chat)",
      description: "配置与 AI 聊天时，知识库检索后的上下文拼装与问答 Prompt 指令。",
      items: [
        {
          key: "ai_prompt_rag_with_notes",
          name: "检索到笔记时的系统 Prompt",
          desc: "支持 ${contextBlock} 变量占位符，用来插入相关的笔记块上下文。",
          placeholder: DEFAULT_PROMPTS.ai_prompt_rag_with_notes,
        },
        {
          key: "ai_prompt_rag_without_notes",
          name: "未检索到笔记时的系统 Prompt",
          desc: "当用户的知识库中没有与问题相关的信息时使用。",
          placeholder: DEFAULT_PROMPTS.ai_prompt_rag_without_notes,
        },
      ],
    },
    {
      id: "clipper",
      title: "网页剪藏助手 (Web Clipper)",
      description: "配置网页剪藏插件读取网页内容后，提取标题、摘要、大纲和标签时的分类器 Prompt 模版。",
      items: [
        {
          key: "ai_prompt_clipper_organize_zh",
          name: "网页剪藏助手系统 Prompt (中文)",
          desc: "中文网页或指定输出为中文时的提示词。支持 ${schemaFields} 占位符。",
          placeholder: DEFAULT_PROMPTS.ai_prompt_clipper_organize_zh,
        },
        {
          key: "ai_prompt_clipper_organize_en",
          name: "网页剪藏助手系统 Prompt (英文)",
          desc: "英文网页或指定输出为英文时的提示词。支持 ${schemaFields} 占位符。",
          placeholder: DEFAULT_PROMPTS.ai_prompt_clipper_organize_en,
        },
      ],
    },
    {
      id: "diary",
      title: "说说排版与分类 (Diary & Notebooks)",
      description: "对日常说说（说说说说）的排版整理，以及自动为新建笔记推荐适合的笔记本。",
      items: [
        {
          key: "ai_prompt_format_diary",
          name: "说说优化排版指令",
          desc: "说说中心顶部「AI 整理」触发时使用的排版优化提示词。",
          placeholder: DEFAULT_PROMPTS.ai_prompt_format_diary,
        },
        {
          key: "ai_prompt_suggest_notebook",
          name: "笔记本推荐系统 Prompt",
          desc: "输入笔记标题与大纲，让 AI 输出笔记本推荐的 JSON 数据结构规范。",
          placeholder: DEFAULT_PROMPTS.ai_prompt_suggest_notebook,
        },
      ],
    },
    {
      id: "document",
      title: "文档导入与格式化 (Document Formatting)",
      description: "配置文件附件导入、URL 解析以及批量 Markdown 格式化动作的 AI 处理模版。",
      items: [
        {
          key: "ai_prompt_url_import_system",
          name: "URL 导入格式化系统 Prompt",
          desc: "通过 URL 解析内容后，AI 系统格式化角色的指令。",
          placeholder: DEFAULT_PROMPTS.ai_prompt_url_import_system,
        },
        {
          key: "ai_prompt_url_import_note",
          name: "URL 导入整理为结构化笔记指令",
          placeholder: DEFAULT_PROMPTS.ai_prompt_url_import_note,
        },
        {
          key: "ai_prompt_url_import_text",
          name: "URL 导入整理为规范 Markdown 指令",
          placeholder: DEFAULT_PROMPTS.ai_prompt_url_import_text,
        },
        {
          key: "ai_prompt_format_file_attachment_system",
          name: "批量文件附件格式化系统 Prompt",
          desc: "如 Word/Docx 格式导入为笔记时运行的 Markdown 重塑规则。",
          placeholder: DEFAULT_PROMPTS.ai_prompt_format_file_attachment_system,
        },
        {
          key: "ai_prompt_format_text_attachment_system",
          name: "批量文本附件格式化系统 Prompt",
          desc: "TXT 导入优化为清晰层级的 Markdown 规则。",
          placeholder: DEFAULT_PROMPTS.ai_prompt_format_text_attachment_system,
        },
      ],
    },
    {
      id: "worker",
      title: "说说 AI 助手 (Background AI Worker)",
      description: "在后台队列中运行的说说智能助手 Prompt。用于 @AI 触发自动新建说说或追加回复。",
      items: [
        {
          key: "ai_prompt_diary_worker_post",
          name: "助手自动发布说说系统 Prompt",
          desc: "背景 AI 助手根据现有知识库笔记和项目上下文，回答用户提问并自动发布说说时的设定。",
          placeholder: DEFAULT_PROMPTS.ai_prompt_diary_worker_post,
        },
        {
          key: "ai_prompt_diary_worker_comment",
          name: "助手自动追加评论系统 Prompt",
          desc: "背景 AI 助手对当前说说的已有讨论进行梳理，自动生成总结或追加回复评论时的设定。",
          placeholder: DEFAULT_PROMPTS.ai_prompt_diary_worker_comment,
        },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-tx-primary mb-1">AI 提示词配置</h3>
          <p className="text-sm text-tx-secondary">
            在此处自定义各类 AI 功能底座所使用的 Prompt 提示词模板。留空时将自动回退到系统的默认模板。
          </p>
        </div>
      </div>

      {/* Categories Accordion */}
      <div className="space-y-4">
        {categories.map((category) => {
          const isExpanded = expandedCategories[category.id];
          return (
            <div
              key={category.id}
              className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900/40 shadow-sm"
            >
              {/* Category Header */}
              <button
                onClick={() => toggleCategory(category.id)}
                className="w-full flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors text-left"
              >
                <div className="flex-1 min-w-0 pr-4">
                  <span className="text-sm font-semibold text-tx-primary flex items-center gap-1.5">
                    {category.title}
                  </span>
                  <p className="text-[11px] text-tx-tertiary mt-0.5 truncate">
                    {category.description}
                  </p>
                </div>
                {isExpanded ? (
                  <ChevronDown size={16} className="text-tx-tertiary shrink-0" />
                ) : (
                  <ChevronRight size={16} className="text-tx-tertiary shrink-0" />
                )}
              </button>

              {/* Category Items */}
              {isExpanded && (
                <div className="p-4 space-y-5 border-t border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800/50">
                  {category.items.map((item, idx) => {
                    const value = prompts[item.key] || "";
                    const isCustomized = value.trim() !== "";
                    return (
                      <div key={item.key} className={cn("space-y-2", idx > 0 ? "pt-4" : "")}>
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-semibold text-tx-secondary flex items-center gap-1.5">
                            {item.name}
                            {isCustomized && (
                              <span className="px-1.5 py-0.5 text-[9px] bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 font-medium rounded-full">
                                已修改
                              </span>
                            )}
                          </label>
                          {isCustomized && (
                            <button
                              onClick={() => handleResetItem(item.key)}
                              className="text-[10px] text-zinc-400 hover:text-red-500 transition-colors flex items-center gap-1"
                              title="重置为空以使用默认模板"
                            >
                              <RefreshCw size={10} />
                              使用系统默认值
                            </button>
                          )}
                        </div>

                        {item.desc && (
                          <p className="text-[11px] text-tx-tertiary leading-relaxed mt-0.5">
                            {item.desc}
                          </p>
                        )}

                        <textarea
                          value={value}
                          onChange={(e) => handlePromptChange(item.key, e.target.value)}
                          placeholder={`使用系统默认提示词:\n\n${item.placeholder}`}
                          rows={Math.min(Math.max(item.placeholder.split("\n").length + 1, 3), 10)}
                          className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-base md:text-sm text-tx-primary font-mono focus:ring-2 focus:ring-accent-primary/40 focus:border-accent-primary outline-none transition-all placeholder:text-zinc-400/80"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Floating/Bottom Action Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-4 border-t border-zinc-200 dark:border-zinc-800">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center justify-center gap-1.5 px-4 py-2.5 md:py-1.5 bg-accent-primary hover:bg-accent-primary/90 text-white rounded-lg text-sm md:text-xs font-medium transition-all disabled:opacity-40"
        >
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          保存所有提示词配置
        </button>

        <button
          onClick={handleResetAll}
          className="flex items-center justify-center gap-1.5 px-4 py-2.5 md:py-1.5 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm md:text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:border-red-500 hover:text-red-500 transition-all bg-white dark:bg-zinc-900"
        >
          <History size={14} />
          全部恢复默认
        </button>

        {saveMsg && (
          <span className={cn("text-xs text-center sm:text-left font-medium", saveMsg.includes("成功") ? "text-emerald-500" : "text-red-500")}>
            {saveMsg}
          </span>
        )}
      </div>
    </div>
  );
}
