import type { ColorKey } from "../core/types";
import type { Intent, Polarity } from "@ai-panel/shared";

/**
 * 5 个评测议题的 fixture。
 *
 * 用途：
 * - `MockLLMClient` 的确定性数据源（阵容、发言、共识）；
 * - `evals/` 的行为基线；
 * - 单测里构造"像真的一场讨论"的最短路径。
 *
 * 每个议题只需要提供"人设 + 每人 2 句台词 + 3 条洞察素材"，
 * 主持人台词由 mock 用模板生成（不写死，便于跨议题复用）。
 */

export interface FixtureExpert {
  name: string;
  profession: string;
  title: string;
  stance: string;
  stanceAxis: string;
  polarity: Polarity;
  focusArea: string;
  colorKey: ColorKey;
  /** 每人 2–3 句，按 intent 匹配；找不到匹配时用第一句 */
  lines: Array<{ intent: Intent; text: string }>;
}

export interface TopicFixture {
  id: string;
  topic: string;
  expertCount: number;
  host: {
    name: string;
    profession: string;
    title: string;
    stance: string;
    stanceAxis: string;
    focusArea: string;
  };
  experts: FixtureExpert[];
  insights: {
    consensus: string;
    divergence: string;
    open: string;
  };
}

const HOST = {
  profession: "科技主持人",
  title: "资深圆桌主持",
  stance: "中立，负责追问、串联与收尾",
  stanceAxis: "节奏与交锋",
  focusArea: "开场与节奏",
};

export const TOPIC_FIXTURES: TopicFixture[] = [
  {
    id: "E1",
    topic: "AI 编程助手会让初级程序员失业吗？",
    expertCount: 4,
    host: { name: "林致远", ...HOST },
    experts: [
      {
        name: "周明",
        profession: "软件工程师",
        title: "技术负责人",
        stance: "AI 重构初级岗位的职责，而不是整体消灭它",
        stanceAxis: "岗位替代 vs 岗位重构",
        polarity: "support",
        focusArea: "工程实践与岗位结构",
        colorKey: "ocean",
        lines: [
          { intent: "rebut", text: "说「消灭」太省事了。被替掉的是写样板代码的任务，不是这个人。" },
          { intent: "extend", text: "真正的变化是入门岗少了练手的机会，三年后谁来当中坚，这才是要命的。" },
          { intent: "support", text: "对，而且现在一个初级工程师带两个助手，产出顶过去三个人。" },
        ],
      },
      {
        name: "许澜",
        profession: "组织心理学研究者",
        title: "副教授",
        stance: "被替代的是任务不是人，但人的适应速度被高估了",
        stanceAxis: "岗位替代 vs 岗位重构",
        polarity: "oppose",
        focusArea: "人的适应与职业认同",
        colorKey: "cyan",
        lines: [
          { intent: "rebut", text: "你们算的是产出，我算的是人。一个岗位消失，背后是一个人要重新找身份。" },
          { intent: "extend", text: "企业愿不愿意为再培训买单，决定了这是升级还是淘汰。" },
          { intent: "clarify", text: "我不是说技术没用，我是说转型期的时间成本没人愿意付。" },
        ],
      },
      {
        name: "陈默",
        profession: "劳动经济学研究者",
        title: "研究员",
        stance: "先看劳动力供需曲线，再谈失不失业",
        stanceAxis: "效率优先 vs 分配优先",
        polarity: "neutral",
        focusArea: "再培训成本与劳动力供给",
        colorKey: "steel",
        lines: [
          { intent: "extend", text: "历史上每次工具升级，短期都有一批人被挤出去，长期总量不一定减少。" },
          { intent: "rebut", text: "你说「顶三个人」，这个说法要有数据支撑，否则只是感觉。" },          { intent: "support", text: "供需两侧都在动，单看岗位数量会得出相反结论。" },
        ],
      },
      {
        name: "顾行舟",
        profession: "创业公司 CEO",
        title: "创始人",
        stance: "小团队加 AI 会替代一整个初级层级",
        stanceAxis: "效率优先 vs 分配优先",
        polarity: "strong_support",
        focusArea: "组织成本与人数",
        colorKey: "bronze",
        lines: [
          { intent: "support", text: "我今年没招初级，两个资深加助手，把活干完了，这就是现实。" },
          { intent: "rebut", text: "说「再培训」的人，先告诉我这笔钱谁出、出多久。" },
          { intent: "extend", text: "真正被压缩的不是岗位数量，是通往资深的梯子。" },
        ],
      },
    ],
    insights: {
      consensus: "双方都承认初级岗位的职责会被重组，而不是原样保留",
      divergence: "分歧在于这是「升级」还是「压缩」，以及再培训成本由谁承担",
      open: "企业是否愿意为初级岗位的再培训买单",
    },
  },
  {
    id: "E2",
    topic: "远程办公应该成为知识型公司的默认工作方式吗？",
    expertCount: 4,
    host: { name: "江照", ...HOST },
    experts: [
      {
        name: "沈亦然",
        profession: "组织发展顾问",
        title: "合伙人",
        stance: "默认远程会削弱组织的隐性知识传递",
        stanceAxis: "效率 vs 组织粘性",
        polarity: "oppose",
        focusArea: "协作密度与隐性知识",
        colorKey: "steel",
        lines: [
          { intent: "rebut", text: "会议能搬上线，走廊里的那三句话搬不上去，而那三句往往最值钱。" },
          { intent: "extend", text: "新人前六个月最吃亏，他们连该问谁都不知道。" },
        ],
      },
      {
        name: "陆嘉",
        profession: "远程团队管理者",
        title: "运营总监",
        stance: "远程是筛选机制，留下的都是能自我管理的人",
        stanceAxis: "效率 vs 组织粘性",
        polarity: "support",
        focusArea: "异步协作与管理成本",
        colorKey: "ocean",
        lines: [
          { intent: "support", text: "我们远程三年，交付没掉，离职率还降了，因为不用装忙。" },
          { intent: "rebut", text: "「隐性知识」很多时候只是没写下来的流程，写下来就不隐了。" },
        ],
      },
      {
        name: "苏牧",
        profession: "劳动法研究者",
        title: "副教授",
        stance: "默认远程会把成本转嫁给员工",
        stanceAxis: "企业成本 vs 员工成本",
        polarity: "strong_oppose",
        focusArea: "工时边界与成本转移",
        colorKey: "bronze",
        lines: [
          { intent: "extend", text: "家里的工位、电费、网费，最后都是员工自己掏，这笔账没人算。" },
          { intent: "clarify", text: "我不反对远程，我反对「默认」——默认意味着员工没有拒绝的权利。" },
        ],
      },
      {
        name: "唐棠",
        profession: "产品经理",
        title: "产品负责人",
        stance: "关键看工作是不是可拆分，不能一刀切",
        stanceAxis: "岗位差异 vs 统一政策",
        polarity: "neutral",
        focusArea: "工作可拆分性",
        colorKey: "sand",
        lines: [
          { intent: "extend", text: "写代码和做创意可以异步，谈合同和带新人不行，得按工作类型分。" },
          { intent: "rebut", text: "「默认」这个词最危险，制度一旦默认，个案就被抹平了。" },
        ],
      },
    ],
    insights: {
      consensus: "双方都同意远程与否要看工作类型，不能对整个公司一刀切",
      divergence: "分歧在于「默认远程」是赋权还是把成本转嫁给员工",
      open: "远程办公省下的通勤时间，是否真的变成了员工的自由时间",
    },
  },
  {
    id: "E3",
    topic: "一线城市应该全面禁售燃油车吗？",
    expertCount: 4,
    host: { name: "温言", ...HOST },
    experts: [
      {
        name: "罗一鸣",
        profession: "交通规划师",
        title: "城市交通研究员",
        stance: "禁售只是手段，拥堵和充电才是瓶颈",
        stanceAxis: "禁售优先 vs 配套优先",
        polarity: "oppose",
        focusArea: "充电网络与路网承载",
        colorKey: "mist",
        lines: [
          { intent: "rebut", text: "车换了，路没变。老小区连充电桩都装不下，禁售之后车停哪儿？" },
          { intent: "extend", text: "先把充电和公交补齐，禁售才不是把问题推给下一环。" },
        ],
      },
      {
        name: "叶秋",
        profession: "环境经济学家",
        title: "研究员",
        stance: "从外部性看，越早禁售越省钱",
        stanceAxis: "禁售优先 vs 配套优先",
        polarity: "strong_support",
        focusArea: "空气治理与长期成本",
        colorKey: "cyan",
        lines: [
          { intent: "support", text: "尾气带来的健康成本是实打实的，晚一年禁售就多付一年。" },
          { intent: "rebut", text: "配套是钱的问题，污染是命的问题，优先级不该一样。" },
        ],
      },
      {
        name: "韩序",
        profession: "汽车产业分析师",
        title: "首席分析师",
        stance: "禁售时点要跟产业链节奏对齐",
        stanceAxis: "政策节奏 vs 产业节奏",
        polarity: "neutral",
        focusArea: "供应链与就业",
        colorKey: "navy",
        lines: [
          { intent: "extend", text: "发动机产线不是开关，一刀切下去，先受伤的是零部件厂的人。" },
          { intent: "clarify", text: "我不是反对禁售，我是反对没有过渡期的禁售。" },
        ],
      },
      {
        name: "宋亦白",
        profession: "消费者权益律师",
        title: "合伙人",
        stance: "禁售不能变成对存量车主的惩罚",
        stanceAxis: "增量管控 vs 存量权益",
        polarity: "oppose",
        focusArea: "存量车主与公平性",
        colorKey: "bronze",
        lines: [
          { intent: "rebut", text: "刚买三年车的人怎么办？政策成本不能只让最后一批买家扛。" },
          { intent: "extend", text: "限行、年检、保险，任何一条都能把存量车主逼到墙角。" },
        ],
      },
    ],
    insights: {
      consensus: "双方都认为禁售必须配充电与公交的过渡安排",
      divergence: "分歧在于禁售时点：先补配套还是先定时点倒逼产业",
      open: "存量燃油车主的权益如何补偿",
    },
  },
  {
    id: "E4",
    topic: "AI 原生应用应该先做 To C 还是先做 To B？",
    expertCount: 4,
    host: { name: "谢临", ...HOST },
    experts: [
      {
        name: "周明",
        profession: "创业者",
        title: "连续创业者",
        stance: "先 To C，因为只有 C 端能验证真实需求",
        stanceAxis: "先 C 端 vs 先 B 端",
        polarity: "support",
        focusArea: "需求验证速度",
        colorKey: "ocean",
        lines: [
          { intent: "support", text: "B 端客户会告诉你他很需要，然后不付钱；C 端不付钱就是不需要。" },
          { intent: "rebut", text: "说 B 端现金流稳的人，忘了获客周期能拖死小团队。" },
        ],
      },
      {
        name: "许澜",
        profession: "企业服务投资人",
        title: "合伙人",
        stance: "先 To B，因为付费意愿和留存都可测",
        stanceAxis: "先 C 端 vs 先 B 端",
        polarity: "strong_oppose",
        focusArea: "付费意愿与留存",
        colorKey: "cyan",
        lines: [
          { intent: "rebut", text: "C 端验证的是热度，不是需求；热度退潮比融资断档还快。" },
          { intent: "extend", text: "B 端一单能养活团队，C 端一百万 DAU 还在找商业模式。" },
        ],
      },
      {
        name: "陈默",
        profession: "产品顾问",
        title: "产品战略顾问",
        stance: "先看模型能力落在哪个环节，而不是先分 C 和 B",
        stanceAxis: "场景优先 vs 客群优先",
        polarity: "neutral",
        focusArea: "模型能力与场景匹配",
        colorKey: "steel",
        lines: [
          { intent: "extend", text: "真正的问题是这条链路里模型是不是必需，不是客户是公司还是个人。" },
          { intent: "clarify", text: "我不是说客群不重要，我是说先定客群会把场景想窄。" },
        ],
      },
      {
        name: "顾行舟",
        profession: "增长负责人",
        title: "增长VP",
        stance: "先 To C 拿数据，再 To B 收钱",
        stanceAxis: "单点突破 vs 双线并行",
        polarity: "support",
        focusArea: "增长路径与数据资产",
        colorKey: "bronze",
        lines: [
          { intent: "support", text: "C 端跑出来的交互数据，反过来就是 B 端最值钱的卖点。" },
          { intent: "extend", text: "两条线不是先后，是同一批数据喂两个市场。" },
        ],
      },
    ],
    insights: {
      consensus: "双方都认为要先验证真实付费意愿，而不是先看热度",
      divergence: "分歧在于验证路径：C 端用规模验证，还是 B 端用客单价验证",
      open: "同一个模型能力，能否同时支撑 C 端体验与 B 端交付",
    },
  },
  {
    id: "E5",
    topic: "职场中，努力和选择哪个更重要？",
    expertCount: 6,
    host: { name: "林致远", ...HOST },
    experts: [
      {
        name: "沈亦然",
        profession: "职业规划师",
        title: "资深顾问",
        stance: "选择决定上限，努力决定下限",
        stanceAxis: "选择决定论 vs 努力决定论",
        polarity: "support",
        focusArea: "路径与机会成本",
        colorKey: "ocean",
        lines: [
          { intent: "support", text: "在错误的赛道上努力，只是把沉没成本做得更精致。" },
          { intent: "extend", text: "但选择本身也是努力换来的信息量，没做过的人选不准。" },
        ],
      },
      {
        name: "陆嘉",
        profession: "一线管理者",
        title: "研发总监",
        stance: "大多数人的问题不是选错，是努力不够",
        stanceAxis: "选择决定论 vs 努力决定论",
        polarity: "oppose",
        focusArea: "执行与积累",
        colorKey: "cyan",
        lines: [
          { intent: "rebut", text: "把一切都归给选择，是最省力的自我安慰。" },
          { intent: "extend", text: "同一个岗位，做三年和做一年的人，选择权完全不一样。" },
        ],
      },
      {
        name: "苏牧",
        profession: "社会学研究者",
        title: "副教授",
        stance: "这题的问法忽略了结构约束",
        stanceAxis: "个体努力 vs 结构约束",
        polarity: "neutral",
        focusArea: "阶层与机会结构",
        colorKey: "steel",
        lines: [
          { intent: "extend", text: "有的人的可选项只有两个，讨论「选择更重要」对他是奢侈的。" },
          { intent: "clarify", text: "我不是否认努力，我是说努力的前提是先有得选。" },
        ],
      },
      {
        name: "唐棠",
        profession: "HRBP",
        title: "人力资源负责人",
        stance: "努力要被看见，才有选择权",
        stanceAxis: "能力 vs 可见度",
        polarity: "support",
        focusArea: "评价机制与可见度",
        colorKey: "sand",
        lines: [
          { intent: "support", text: "同样的活，会汇报的人先拿到机会，这就是现实。" },
          { intent: "rebut", text: "只谈努力不谈评价机制，等于让老实人吃亏。" },
        ],
      },
      {
        name: "韩序",
        profession: "创业者",
        title: "创始人",
        stance: "选择是杠杆，努力是本金",
        stanceAxis: "杠杆 vs 本金",
        polarity: "strong_support",
        focusArea: "杠杆与时机",
        colorKey: "navy",
        lines: [
          { intent: "extend", text: "同样的努力，放在上行行业和下行行业，结果差十倍。" },
          { intent: "support", text: "本金决定你能不能上牌桌，杠杆决定你赢多少。" },
        ],
      },
      {
        name: "宋亦白",
        profession: "职业教练",
        title: "独立顾问",
        stance: "两者是循环，不是二选一",
        stanceAxis: "二元对立 vs 循环",
        polarity: "oppose",
        focusArea: "反馈循环",
        colorKey: "bronze",
        lines: [
          { intent: "rebut", text: "非要排个先后，是把动态过程切成静态切片。" },
          { intent: "clarify", text: "我要说的不是「都重要」，而是努力会改变下一次选择的质量。" },
        ],
      },
    ],
    insights: {
      consensus: "双方都承认努力会影响下一次选择的质量",
      divergence: "分歧在于：选择是前置条件，还是努力的结果",
      open: "在机会结构受限的情况下，个人努力的上限在哪里",
    },
  },
];

export const FIXTURE_BY_ID = new Map(TOPIC_FIXTURES.map((f) => [f.id, f]));

export function fixtureById(id: string): TopicFixture | undefined {
  return FIXTURE_BY_ID.get(id);
}

/** 取第一个专家数与要求一致的 fixture；没有就返回第一个。 */
export function fixtureForExpertCount(expertCount: number): TopicFixture {
  return (
    TOPIC_FIXTURES.find((f) => f.expertCount === expertCount) ?? TOPIC_FIXTURES[0]!
  );
}

/** 把 fixture 渲染成 P-ROSTER 的 JSON（mock 用；同时是 schema 的黄金样本）。 */
export function fixtureRosterJson(fixture: TopicFixture): string {
  return JSON.stringify({
    host: {
      name: fixture.host.name,
      profession: fixture.host.profession,
      title: fixture.host.title,
      stance: fixture.host.stance,
      stanceAxis: fixture.host.stanceAxis,
      polarity: "neutral",
      focusArea: fixture.host.focusArea,
      color: "#D9D9D9",
    },
    experts: fixture.experts.slice(0, fixture.expertCount).map((e) => ({
      name: e.name,
      profession: e.profession,
      title: e.title,
      stance: e.stance,
      stanceAxis: e.stanceAxis,
      polarity: e.polarity,
      focusArea: e.focusArea,
      colorKey: e.colorKey,
    })),
  });
}
