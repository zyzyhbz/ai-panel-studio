import type { Intent, Polarity } from "@ai-panel/shared";

/** Colors that avoid the four semantic hues (consensus green / divergence red /
 *  open-question purple / accent gold) so expert identity never collides with state. */
export const SHA_SAFE_COLORS = [
  "#5B8DEF",
  "#3FA796",
  "#A9744F",
  "#6B7A99",
  "#8A9A5B",
  "#C0778B",
] as const;

export const HOST_COLOR = "#D9D9D9";

export const EXPERT_NAME_POOL = [
  "周明",
  "许澜",
  "陈默",
  "陆嘉",
  "沈知远",
  "顾清",
  "唐棠",
  "罗一鸣",
  "叶秋",
  "苏牧",
] as const;

export const HOST_NAMES = ["林致远", "何守正", "程静"] as const;

export const PROFESSION_POOL: readonly {
  profession: string;
  title: string;
  focusArea: string;
  stance: string;
  stanceAxis: string;
  polarity: Polarity;
}[] = [
  {
    profession: "软件工程师",
    title: "技术负责人",
    focusArea: "工程实践与岗位结构",
    stance: "AI 会重构初级岗位的职责，而不是简单消灭它",
    stanceAxis: "岗位替代 vs 岗位重构",
    polarity: "support",
  },
  {
    profession: "组织心理学研究者",
    title: "副教授",
    focusArea: "人的适应与职业认同",
    stance: "被替代的是任务，不是人；但人的适应速度被高估了",
    stanceAxis: "岗位替代 vs 岗位重构",
    polarity: "oppose",
  },
  {
    profession: "劳动经济学家",
    title: "研究员",
    focusArea: "再培训成本与劳动力供给",
    stance: "企业是否愿意为再培训买单，决定了岗位是升级还是压缩",
    stanceAxis: "效率优先 vs 分配优先",
    polarity: "neutral",
  },
  {
    profession: "创业者",
    title: "CEO",
    focusArea: "组织成本与人效",
    stance: "小团队加 AI 会替代一整个初级层级",
    stanceAxis: "效率优先 vs 分配优先",
    polarity: "strong_support",
  },
  {
    profession: "职业教育从业者",
    title: "教研总监",
    focusArea: "培养路径与课程",
    stance: "教育系统的更新速度跟不上工具迭代",
    stanceAxis: "个体努力 vs 结构约束",
    polarity: "strong_oppose",
  },
  {
    profession: "科技记者",
    title: "资深主笔",
    focusArea: "公共叙事与预期管理",
    stance: "这轮讨论被恐慌叙事带偏了",
    stanceAxis: "个体努力 vs 结构约束",
    polarity: "neutral",
  },
];

export const INTENT_POOL: readonly Intent[] = [
  "rebut",
  "support",
  "extend",
  "clarify",
  "probe",
];
