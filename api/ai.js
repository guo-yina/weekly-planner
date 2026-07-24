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

  const systemPrompt = `你是「周周搞事情」时间管理工具的 AI 助手。用户会用自然语言描述本周想做的事，你需要把它拆成一个个独立任务，返回 JSON 数组。

每个任务对象格式：
{
  "title": "简短任务标题（10字以内最佳）",
  "day": 数字 0-6 表示周一到周日，如果判断不出哪天就填 -1,
  "time": "HH:MM 格式，没有具体时间就填空字符串",
  "q": 四象限优先级 1-4（1=重要且紧急，2=重要不紧急，3=紧急不重要，4=不重要不紧急），
  "cat": 分类，只能是 "work"/"study"/"fitness"/"life"/"play" 之一,
  "desc": "一句话描述或备注（可选，没有就空字符串）"
}

本周日历：${weekDays || "周一到周日"}

规则：
- 一段话里可能包含多个任务，要拆开
- 提到具体星期几/日期/今天明天的，设置对应 day
- 没提到时间的任务 day 填 -1（进任务池）
- 判断四象限时：工作核心产出=2，有deadline/催促=1或3，学习健身=2，杂事=4
- 只返回 JSON 数组，不要任何其他文字`;

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
