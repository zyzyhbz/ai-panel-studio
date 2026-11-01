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
你的任务不是找“正确答案”，而是找一群**真的会在这个议题上发生分歧**、能吵出东西的人。

# 先做相关性判断，再选人
不要从“行业角色库”里随便凑人。先在心里回答：
1. 这个议题真正要决定的是什么？是一个技术判断、一次资源分配、一条规则，还是一种价值取舍？
2. 谁有决策权、谁承担代价、谁掌握这个领域的具体知识？
3. 哪 2–3 个**只属于这个议题**的争议轴，能把人分开？

然后对每个候选人做“删题测试”：
- 如果把这个议题删掉，这个职业/头衔放在任何话题里都成立，那它太泛，不要选；
- 如果这个人的主张不能直接回答议题里的一个具体子问题，不要选；
- 不要为了凑“伦理/监管/广告合规”等维度，硬塞与议题无关的角色。

# 硬性要求
${SHARED_RULES}
5. 不能使用真实公众人物的姓名（企业家、政治人物、明星都不行），必须原创中文姓名。
6. 不能把立场直接写进名字或职业（例如不要叫“裁员专家”）。
7. 只输出 JSON，不要 markdown 代码块，不要解释。`;

  const user = `# 议题
${input.topic}

# 阵容规模
1 位主持人 + ${input.expertCount} 位专家（专家必须是 ${input.expertCount} 位）。

# 先做内部判断（不要输出）
1. 本议题真正要决定什么？请用一句具体问题概括。
2. 本议题的 2–3 个**专属争议轴**是什么？必须包含议题中的具体对象/条件，不要只写「效率 vs 公平」这种万能轴。
3. 哪些职业/身份**只在这个议题里**有决策权、专业知识、代价或一手经验？先列 4–6 个候选，再选最互补的。
4. 每个入选者必须能回答：他在议题中的具体主张是什么？他会拿什么证据/经验来支撑？他被谁反驳？

# 相关性测试（不通过就换人）
- 职业/头衔必须和议题直接相关；如果去掉议题后这个职业仍适用于任何话题，说明太泛。
- 不要默认塞「广告合规」「伦理专家」「监管专家」「行业分析师」；只有议题本身涉及广告、伦理、监管或行业分析时才选。
- 每个 focusArea 必须是本议题下的一个具体子问题，不是“技术/成本/伦理”这种分类词。
- stance 必须是可被反驳的具体主张，不能是“要综合考虑”“要客观看待”。

# 你必须做到的四维差异
1. **立场轴（stanceAxis）**：至少 2 个不同的争议轴，同一个轴上最多 ceil(${input.expertCount}/2) 人。
   示例只示意格式，**必须按本议题重写**，不要照抄「岗位替代 vs 岗位重构」。
2. **极性（polarity）**：至少 3 种；必须至少 1 人 oppose 或 strong_oppose，至少 1 人 support 或 strong_support。
   主持人必须是 neutral。
3. **关注维度**：每位专家落在本议题的不同子问题上（技术/成本/使用场景/规则/受影响者等），不要全员谈同一层。
4. **论证风格**：有人讲数据、有人讲案例、有人讲原则、有人讲工程/落地约束，不要全员讲大道理。

# 例子（只示意“按议题重选”，不要照抄）
- 议题「如何美白」：皮肤科医生、护肤品配方师、成分/消费者研究者、品牌渠道；**不要**硬塞广告合规，除非议题涉及广告宣称。
- 议题「AI 是否替代管理者」：一线管理者、组织设计研究者、被管理者、AI 系统负责人；不要塞“伦理专家”凑数。

# 其他要求
- 主持人：中立、负责开场/追问/串联/收尾，stance 写成“中立，负责追问、串联与收尾”；profession 要贴合本议题，不要永远是“科技主持人”。
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
