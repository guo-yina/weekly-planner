// Vercel Serverless Function: AI 梳理成任务
// 调用 DashScope（通义千问）解析用户输入，返回结构化任务列表

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) { res.status(500).json({ error: "AI service not configured" }); return; }

  const { text, weekDays, todayWd, todayOffset } = req.body || {};
  if (!text) { res.status(400).json({ error: "text is required" }); return; }

  const hasToday = (typeof todayOffset === "number" && todayOffset >= 0 && todayOffset <= 6);
  const todayLine = hasToday
    ? `\n\n**重要：今天是 ${todayWd || ""}，也就是本周第 ${todayOffset} 天（0=周一 ... 6=周日）。** 相对日期一律以此为准：今天 = day ${todayOffset}；明天 = day ${todayOffset + 1}；后天 = day ${todayOffset + 2}。若算出来的 day 大于 6，说明落到下周，按 7=下周一 ... 13=下周日 处理。不要凭空猜今天是周几。`
    : "";

  const systemPrompt = `你是「周周搞事情」时间管理工具的 AI 助手。用户会用口语化的方式描述本周想做的事——可能是一大段话、可能有废话、可能逻辑混乱。你的工作是：

**像一个贴心助理一样，帮用户归纳、提炼、整理成清晰可执行的任务清单。**

核心原则：
1. 提炼而非复制——用你自己的话重新组织，写出干净的任务标题。绝对不要直接照搬用户的原话当标题。
2. 标题要是「动词+对象」结构，像行动清单一样一看就知道该干嘛。例：「写 PRD 初稿」「约设计评审」「跑步 30 分钟」
3. 合并重复/相关的事，拆分混在一起的不同事。
4. 如果用户描述了背景/原因/心情，把有用信息放到 desc 里，不要堆到 title。

每个任务对象格式：
{
  "title": "简短动作标题（3-10字，动词开头）",
  "day": 数字 0-6 表示周一到周日，判断不出就填 -1,
  "time": "HH:MM 格式，没有具体时间就填空字符串",
  "q": 四象限 1-4（1=重要且紧急，2=重要不紧急，3=紧急不重要，4=不重要不紧急），
  "cat": 分类 "work"/"study"/"fitness"/"life"/"play" 之一,
  "desc": "一句话备注：保留用户提到的关键细节（可选）",
  "checkin": 打卡目标次数（整数）。这是「每周要重复做 N 次的习惯」时才填，比如"这周健身3次"填 3；普通一次性任务不要填这个字段（省略或填 0）。,
  "goalTgt": 进度目标的「总量」（整数）。当用户描述的是「累计做到某个总量的目标」时才填，比如读一本 300 页的书填 300、要学 20 小时填 20。不是这类目标就省略或填 0。,
  "goalCur": 进度目标的「当前已完成量」（整数）。比如"现在读到第 30 页"填 30；没提就填 0。,
  "goalUnit": 进度目标的单位，只在 goalTgt 有值时填，取 "页" / "h" / "次" 之一（读书=页，时长=h，计次=次）。
}

本周日历：${weekDays || "周一到周日"}${todayLine}

判断规则：
- "这周X"或只说"周X" → day = 对应 0-6（0=周一，6=周日）
- "下周X" → day = 7 + 对应值（7=下周一，8=下周二 ... 13=下周日）
- "今天""明天""后天""大后天" → 严格按上面给出的「今天」锚点推算，不要自己猜。今天没有给锚点时才填 -1。
- 没提具体哪天 → day 填 -1（进任务池让用户自己拖）
- 四象限判断：核心工作产出/目标相关=Q2，有截止日催促=Q1，别人找你的杂事=Q3，无所谓的=Q4
- 学习/健身/成长类默认=Q2，聚餐/娱乐/购物=play
- 如果用户只写了一句很短的话（比如"开会"），也要给出合理的完整任务

打卡习惯规则（重要）：
- 当用户表达"这周/每周要重复做某事 N 次"这类可累计的习惯时，就是打卡任务：设置 "checkin" = N（1-7 的整数），"day" 一律填 -1（打卡卡不排到具体某天），"time" 填空字符串。
- 典型例子："这周健身3次""每周跑步四次""本周想读书两次""一周打卡5次早起" → checkin 分别填 3、4、2、5。
- title 要干净，不要带次数和"打卡"字样：例"这周健身三次" → {"title":"健身","checkin":3,"day":-1,"cat":"fitness","q":2}。
- checkin 的 cat 按内容归类：健身/跑步/运动=fitness，读书/学习=study，早起/喝水/冥想=life。q 默认 2。
- 只做一次的事（"周三去健身"）不是打卡，不要填 checkin，正常按 day 排。


进度目标规则（重要）：
- 当用户描述的是「要累计做到某个总量」的目标——尤其是读一本书（按页数）、学习/练习累计多少小时——并希望「加到目标打卡」时，不要用 checkin（那是每周 N 次的习惯），而要用 goalTgt / goalCur / goalUnit。
- 读书按页：goalUnit 填 "页"，goalTgt = 全书总页数，goalCur = 当前读到第几页；title 写成干净的「读《书名》」，没有书名就写「读书」。day 填 -1，time 填空字符串，cat 填 "study"。
- 时长类：goalUnit 填 "h"，goalTgt = 目标总小时数，goalCur = 已完成小时数。
- 一本有页数的书**不是** checkin（次）目标，绝对不要输出 "读书" + checkin:1 这种。
- 例："我正在看一本 ADHD 的书，一共 300 页，现在读到第 30 页，帮我加到目标打卡" → {"tasks":[{"title":"读《ADHD》","day":-1,"time":"","q":2,"cat":"study","goalTgt":300,"goalCur":30,"goalUnit":"页"}]}
- 例："这门课一共 20 小时，我已经学了 5 小时" → {"tasks":[{"title":"学完课程","day":-1,"time":"","q":2,"cat":"study","goalTgt":20,"goalCur":5,"goalUnit":"h"}]}


时间提取规则（重要）：
- 只要用户提到了具体时间点，就必须把它填进 time 字段，用 24 小时制 HH:MM 格式，前面补零。
- 中文口语要正确换算：早上/上午 = 上午原点；中午12点 → 12:00；下午/晚上/傍晚要 +12（下午3点 → 15:00，晚上8点 → 20:00，晚上8点半 → 20:30）；早上9点 → 09:00；半 = 30 分。
- 已经是"18:00""9:30"这类的直接规范成 HH:MM。
- 只说了模糊时间段（"上午""晚点""有空的时候"）而没有具体钟点 → time 填空字符串。
- 完全没提时间 → time 填空字符串，不要自己编一个。
- 例："周六下午6点打网球" → {"title":"打网球","day":5,"time":"18:00",...}；"明早9点开周会" → time 填 "09:00"。

删除指令规则（重要）：
- 如果用户这句话是要「删除 / 删掉 / 清空 / 移除」已有的日程（而不是新增），不要当成新任务，而是返回一个删除对象：
  {"action":"delete","delete":{"days":[数字数组，0=周一...6=周日],"allWeek":布尔,"part":"am"或"pm"或空字符串,"keyword":"要删的事项关键词或空字符串"}}
- days：点名了哪几天就填哪几天（可多个）；"今天/明天/后天"按上面的今天锚点换算成 0-6；没点名具体某天就填空数组 []。
- allWeek：说"清空这周/本周全部/整周都删"这类整周删除时填 true，否则 false。
- part：只删上午填 "am"，只删下午/晚上填 "pm"，没区分就填空字符串。
- keyword：要删某个具体事项时填它的关键词（如"删掉设计评审"→"设计评审"）；按天/整周删就填空字符串。
- 例："删掉周日的所有日程" → {"action":"delete","delete":{"days":[6],"allWeek":false,"part":"","keyword":""}}
- 例："清空这周" → {"action":"delete","delete":{"days":[],"allWeek":true,"part":"","keyword":""}}
- 例："把周三下午的会删了" → {"action":"delete","delete":{"days":[2],"allWeek":false,"part":"pm","keyword":"会"}}
- 例："删掉设计评审" → {"action":"delete","delete":{"days":[],"allWeek":false,"part":"","keyword":"设计评审"}}

返回格式：
- 正常整理任务时，返回 {"tasks":[任务对象数组]}（或直接返回任务对象数组）。
- 是删除指令时，返回上面的 {"action":"delete","delete":{...}} 对象。
- 只返回 JSON，不要有任何其他文字。`;

  try {
    const response = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "qwen-max",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text }
        ],
        temperature: 0.3,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const err = await response.text();
      res.status(502).json({ error: "AI service error", detail: err });
      return;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "[]";

    // 尝试解析 JSON
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      // 如果不是纯 JSON，尝试提取对象或数组
      const objMatch = content.match(/\{[\s\S]*\}/);
      const arrMatch = content.match(/\[[\s\S]*\]/);
      try { parsed = objMatch ? JSON.parse(objMatch[0]) : (arrMatch ? JSON.parse(arrMatch[0]) : []); }
      catch (_) { parsed = []; }
    }

    // 删除指令：原样透传给前端处理（前端会再弹确认）
    if (parsed && !Array.isArray(parsed) && parsed.action === "delete") {
      res.status(200).json({ action: "delete", delete: parsed.delete || {} });
      return;
    }

    const tasks = Array.isArray(parsed) ? parsed : (parsed.tasks || []);
    res.status(200).json({ tasks });
  } catch (err) {
    res.status(500).json({ error: "Internal error", detail: err.message });
  }
};
