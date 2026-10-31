import { COLOR_KEYS, COLOR_PALETTE } from "../core/types";
import type { PromptSpec } from "../llm/types";
import { POLARITY_LABEL } from "../policy/roster";
import { makeSpec, repairBlock, SHARED_RULES } from "./common";

export interface RosterPromptInput {
  topic: string;
  expertCount: number;
  /** 重新生成时避开的名字 */
  avoidNames?: string[];
  /** 上一次失败原因，用于修复重试 */
  repairHint?: string;
}

/**
 * P-ROSTER：生成主持人 + 专家阵容。
 * 输出 JSON；四维差异（轴/极性/维度/风格语言）是硬要求，缺一项会被后端校验打回。
 */
export function buildRosterPrompt(input: RosterPromptInput): PromptSpec {
  const palette = COLOR_KEYS.map(
    (key) => `${key}（${COLOR_PALETTE[key].label} ${COLOR_PALETTE[key].hex}）`,
  ).join("、");

  const system = `你是「AI 圆桌演播厅」的选角导演，负责为一场圆桌讨论组建主持人 + 专家阵容。
你的任务不是找“正确答案”，而是找一群彼此有真实分歧、能吵出东西的人。

# 硬性要求
${SHARED_RULES}
5. 不能使用真实公众人物的姓名（企业家、政治人物、明星都不行），必须原创中文姓名。
6. 不能把立场直接写进名字或职业（例如不要叫“裁员专家”）。
7. 只输出 JSON，不要 markdown 代码块，不要解释。`;

  const user = `# 议题
${input.topic}

# 阵容规模
1 位主持人 + ${input.expertCount} 位专家（专家必须是 ${input.expertCount} 位）。

# 你必须做到的四维差异
1. **立场轴（stanceAxis）**：至少 2 个不同的争议轴，同一个轴上最多 ceil(${input.expertCount}/2) 人。
   例：「岗位替代 vs 岗位重构」「效率优先 vs 公平优先」。
2. **极性（polarity）**：至少 3 种；必须至少 1 人 oppose 或 strong_oppose，至少 1 人 support 或 strong_support。
   主持人必须是 neutral。
3. **关注维度**：技术、经济/成本、组织/人、伦理/监管、用户/场景 之间要拉开，不要 4 个人都谈技术。
4. **论证风格**：有人讲数据、有人讲案例、有人讲原则、有人讲工程约束，不要全员讲大道理。

# 其他要求
- 主持人：中立、负责开场/追问/串联/收尾，stance 写成“中立，负责追问、串联与收尾”。
- 每位专家的 stance 是一句**可被反驳**的主张，不是“要客观看待”这种和稀泥。
- profession ≤12 字，title ≤16 字，stance ≤40 字，stanceAxis ≤16 字，focusArea ≤20 字。
- colorKey 从下列调色板中选，**所有人颜色互不相同**，主持人用 neutral（固定灰色，由系统分配）：
  ${palette}
- 姓名 2–4 个汉字，彼此不重复。
${input.avoidNames?.length ? `- 不要使用这些已用过的名字：${input.avoidNames.join("、")}` : ""}
${repairBlock(input.repairHint)}

# 输出 JSON（严格按此结构，不要增删字段）
{
  "host": {
    "name": "林致远",
    "profession": "科技主持人",
    "title": "资深圆桌主持",
    "stance": "中立，负责追问、串联与收尾",
    "stanceAxis": "节奏与交锋",
    "polarity": "neutral",
    "focusArea": "开场与节奏",
    "colorKey": "mist"
  },
  "experts": [
    {
      "name": "周明",
      "profession": "软件工程师",
      "title": "技术负责人",
      "stance": "AI 会重构初级岗位的职责，而不是整体消灭它",
      "stanceAxis": "岗位替代 vs 岗位重构",
      "polarity": "support",
      "focusArea": "工程实践与岗位结构",
      "colorKey": "ocean"
    }
  ]
}

polarity 取值：${Object.keys(POLARITY_LABEL).join(" | ")}
必须输出 ${input.expertCount} 位专家（上面示例只列了 1 位）。`;

  return makeSpec({
    id: "P-ROSTER",
    kind: "json",
    system,
    user,
    paramsOverride: input.repairHint ? { temperature: 0.6 } : undefined,
  });
}

/** 供 prompt 中列举颜色用（也便于 mock 与测试对齐）。 */
export function paletteSummary(): string[] {
  return COLOR_KEYS.map((key) => `${key}:${COLOR_PALETTE[key].label}`);
}
