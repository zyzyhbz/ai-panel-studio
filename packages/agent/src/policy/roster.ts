import type { Polarity } from "@ai-panel/shared";
import {
  COLOR_KEYS,
  COLOR_PALETTE,
  HOST_COLOR,
  type ColorKey,
  type ExpertPersona,
  type PersonaDraft,
  type RosterDraft,
  type RosterResult,
} from "../core/types";

/**
 * 阵容规范化（AR-01）。
 *
 * 生成后不整份重来：先做局部修复（姓名/颜色/阵营），修不动再交给 backend 重试或模板兜底。
 * 这里只做"结构性"校验；"互补"的语义判断交给 eval 与人工抽查。
 */

export const FORBIDDEN_NAMES = new Set([
  "马云",
  "马斯克",
  "任正非",
  "雷军",
  "马化腾",
  "李彦宏",
  "张一鸣",
  "刘强东",
  "董明珠",
  "罗永浩",
  "俞敏洪",
  "特朗普",
  "拜登",
  "普京",
]);

const NAME_POOL = [
  "周明",
  "许澜",
  "陈默",
  "沈亦然",
  "顾行舟",
  "林见微",
  "陆知远",
  "苏澈",
  "唐若川",
  "叶清和",
  "宋亦白",
  "韩序",
];

/** 与"中立主持"配套的主持人名池，避免与专家重名。 */
const HOST_NAME_POOL = ["林致远", "江照", "温言", "谢临"];

export interface NormalizeRosterOptions {
  expertCount: number;
  /** 重生成时避开已有姓名 */
  avoidNames?: string[];
}

export function normalizeRoster(
  draft: RosterDraft,
  options: NormalizeRosterOptions,
): RosterResult {
  const warnings: string[] = [];
  let repaired = false;
  let degraded = false;

  const usedNames = new Set<string>(options.avoidNames ?? []);
  const hostName = uniqueName(draft.host.name, HOST_NAME_POOL, usedNames, () => {
    repaired = true;
  });
  usedNames.add(hostName);

  let expertDrafts = [...draft.experts];
  if (expertDrafts.length > options.expertCount) {
    warnings.push(`专家数 ${expertDrafts.length} 超过要求 ${options.expertCount}，已截断`);
    expertDrafts = expertDrafts.slice(0, options.expertCount);
    repaired = true;
  }
  while (expertDrafts.length < options.expertCount) {
    const template = TEMPLATE_EXPERTS[expertDrafts.length % TEMPLATE_EXPERTS.length];
    expertDrafts.push(template);
    warnings.push("专家数不足，已用模板位补齐");
    degraded = true;
  }

  const usedColors = new Set<ColorKey>();
  const experts: ExpertPersona[] = expertDrafts.map((personaDraft, index) => {
    const name = uniqueName(personaDraft.name, NAME_POOL, usedNames, () => {
      repaired = true;
    });
    usedNames.add(name);

    let colorKey = personaDraft.colorKey;
    if (usedColors.has(colorKey)) {
      const next = nextFreeColor(usedColors);
      warnings.push(`${name} 的颜色 ${colorKey} 重复，已改为 ${next}`);
      colorKey = next;
      repaired = true;
    }
    usedColors.add(colorKey);

    return {
      id: `e_${index + 1}`,
      role: "expert",
      name,
      profession: personaDraft.profession,
      title: personaDraft.title,
      stance: personaDraft.stance,
      stanceAxis: personaDraft.stanceAxis,
      polarity: personaDraft.polarity,
      focusArea: personaDraft.focusArea,
      color: COLOR_PALETTE[colorKey].hex,
    };
  });

  const host: ExpertPersona = {
    id: "e_host",
    role: "host",
    name: hostName,
    profession: draft.host.profession,
    title: draft.host.title,
    stance: draft.host.stance,
    stanceAxis: draft.host.stanceAxis,
    polarity: "neutral",
    focusArea: draft.host.focusArea,
    color: HOST_COLOR,
  };

  const diversity = checkDiversity(host, experts);
  warnings.push(...diversity.warnings);
  if (diversity.repaired) repaired = true;

  return {
    host,
    experts,
    warnings,
    repaired,
    degraded,
    needsRetry: diversity.needsRetry,
  };
}

export interface DiversityCheck {
  warnings: string[];
  repaired: boolean;
  /** 语义层面无法局部修复（缺反对侧），建议 backend 重试一次 */
  needsRetry: boolean;
}

export function checkDiversity(host: ExpertPersona, experts: ExpertPersona[]): DiversityCheck {
  const warnings: string[] = [];
  let repaired = false;
  let needsRetry = false;

  const axes = new Set(experts.map((e) => normalizeAxis(e.stanceAxis)));
  if (axes.size < 2 && experts.length >= 3) {
    warnings.push("所有专家共用同一立场轴，互补性不足");
    needsRetry = true;
  }
  const maxPerAxis = Math.ceil(experts.length / 2);
  for (const axis of axes) {
    const count = experts.filter((e) => normalizeAxis(e.stanceAxis) === axis).length;
    if (count > maxPerAxis) {
      warnings.push(`立场轴「${axis}」上有 ${count} 人，超过一半`);
      needsRetry = true;
    }
  }

  const polarities = new Set(experts.map((e) => e.polarity));
  if (polarities.size < 3 && experts.length >= 3) {
    warnings.push(`立场极性只有 ${polarities.size} 种，至少需要 3 种`);
    needsRetry = true;
  }
  const hasOppose = experts.some(
    (e) => e.polarity === "oppose" || e.polarity === "strong_oppose",
  );
  const hasSupport = experts.some(
    (e) => e.polarity === "support" || e.polarity === "strong_support",
  );
  if (!hasOppose && !hasSupport) {
    warnings.push("缺少明确表态的一方（全中立）");
    needsRetry = true;
  }
  if (!hasOppose) {
    warnings.push("缺少反对侧专家");
    needsRetry = true;
  }

  const names = new Set([host.name, ...experts.map((e) => e.name)]);
  if (names.size !== experts.length + 1) {
    warnings.push("姓名重复");
    repaired = true;
  }
  const colors = new Set([host.color, ...experts.map((e) => e.color)]);
  if (colors.size !== experts.length + 1) {
    warnings.push("颜色重复");
    repaired = true;
  }

  if (host.polarity !== "neutral") {
    warnings.push("主持人立场被强制为 neutral");
    repaired = true;
  }

  return { warnings, repaired, needsRetry };
}

function normalizeAxis(axis: string): string {
  return axis.replace(/\s+/gu, "").toLowerCase();
}

function uniqueName(
  candidate: string,
  pool: string[],
  used: Set<string>,
  onRepair: () => void,
): string {
  const name = candidate.trim();
  const invalid = name.length < 2 || name.length > 6 || FORBIDDEN_NAMES.has(name) || used.has(name);
  if (!invalid) return name;
  onRepair();
  for (const fallback of pool) {
    if (!used.has(fallback)) return fallback;
  }
  // 池子耗尽时加序号，仍然保证唯一
  let index = 2;
  let generated = `${pool[0]}${index}`;
  while (used.has(generated)) {
    index += 1;
    generated = `${pool[0]}${index}`;
  }
  return generated;
}

function nextFreeColor(used: Set<ColorKey>): ColorKey {
  for (const key of COLOR_KEYS) {
    if (!used.has(key)) return key;
  }
  return COLOR_KEYS[0];
}

/** 模型完全不可用时的兜底阵容（degraded=true）。 */
export const TEMPLATE_EXPERTS: PersonaDraft[] = [
  {
    name: "周明",
    profession: "一线工程师",
    title: "技术负责人",
    stance: "这件事的成败取决于工程落地，而不是口号",
    stanceAxis: "落地可行性 vs 理想方案",
    polarity: "support",
    focusArea: "工程实践与成本",
    colorKey: "ocean",
  },
  {
    name: "许澜",
    profession: "经济学研究者",
    title: "产业研究员",
    stance: "先算清代价和收益，再谈要不要做",
    stanceAxis: "成本约束 vs 目标优先",
    polarity: "oppose",
    focusArea: "激励与成本结构",
    colorKey: "cyan",
  },
  {
    name: "陈默",
    profession: "组织与人力顾问",
    title: "组织发展顾问",
    stance: "真正的阻力来自组织习惯，不是技术",
    stanceAxis: "技术驱动 vs 组织驱动",
    polarity: "neutral",
    focusArea: "组织与人的变化",
    colorKey: "steel",
  },
  {
    name: "顾行舟",
    profession: "政策与伦理研究者",
    title: "公共政策学者",
    stance: "要设边界，否则代价会转移给最弱的一方",
    stanceAxis: "效率优先 vs 公平优先",
    polarity: "strong_oppose",
    focusArea: "外部性与责任",
    colorKey: "bronze",
  },
  {
    name: "苏澈",
    profession: "产品经理",
    title: "资深产品负责人",
    stance: "用户是否真的需要，比能不能做更重要",
    stanceAxis: "技术可能 vs 真实需求",
    polarity: "support",
    focusArea: "用户价值与场景",
    colorKey: "sand",
  },
  {
    name: "叶清和",
    profession: "投资人",
    title: "早期基金合伙人",
    stance: "看不懂回报模型的事，热闹也不会持续",
    stanceAxis: "长期价值 vs 短期热度",
    polarity: "oppose",
    focusArea: "商业模式与周期",
    colorKey: "navy",
  },
];

/** 供 prompt 展示的极性中文标签。 */
export const POLARITY_LABEL: Record<Polarity, string> = {
  strong_oppose: "强烈反对",
  oppose: "反对",
  neutral: "中立",
  support: "支持",
  strong_support: "强烈支持",
};
