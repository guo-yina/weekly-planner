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

  const { text, weekDays } = req.body || {};
  if (!text) { res.status(400).json({ error: "text is required" }); return; }

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
  "desc": "一句话备注：保留用户提到的关键细节（可选）"
}

本周日历：${weekDays || "周一到周日"}

判断规则：
- 提到星期几/日期/今天明天 → 设对应 day
- 没提时间 → day 填 -1（进任务池让用户自己拖）
- 四象限判断：核心工作产出/目标相关=Q2，有截止日催促=Q1，别人找你的杂事=Q3，无所谓的=Q4
- 学习/健身/成长类默认=Q2，聚餐/娱乐/购物=play
- 如果用户只写了一句很短的话（比如"开会"），也要给出合理的完整任务

只返回 JSON 数组，不要有任何其他文字。`;

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
    let tasks;
    try {
      const parsed = JSON.parse(content);
      tasks = Array.isArray(parsed) ? parsed : (parsed.tasks || []);
    } catch (e) {
      // 如果不是纯 JSON，尝试提取 JSON 数组
      const match = content.match(/\[[\s\S]*\]/);
      tasks = match ? JSON.parse(match[0]) : [];
    }

    res.status(200).json({ tasks });
  } catch (err) {
    res.status(500).json({ error: "Internal error", detail: err.message });
  }
};
