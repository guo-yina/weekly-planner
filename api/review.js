// Vercel Serverless Function: 本周复盘教练点评
// 读取本周真实统计数据，调用 DashScope（通义千问 qwen-max）生成一段温和、具体的点评。
// 返回 { text }。前端拿不到 text 时会用本地兜底文案。

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) { res.status(500).json({ error: "AI service not configured" }); return; }

  const { stats, week } = req.body || {};
  if (!stats || typeof stats !== "object") { res.status(400).json({ error: "stats is required" }); return; }

  const systemPrompt = `你是「周周搞事情」时间管理工具里一位犀利、敢说真话的 AI 时间教练。用户是职场人，会拿到自己这一周的真实数据。你的任务不是安慰她，而是像一个资深教练那样，一针见血地点破这周最值得警惕的问题。

要求：
1. 只输出一段中文，3-4 句话，直给、不绕弯，不要分点、不要标题、不要 markdown、不要 emoji。
2. 开门见山：第一句就用数字点破这周最大的问题，绝不用"你做得很好，不过……"这种客套开场。
3. 把问题讲透——不要只说"会议多"，要指出它意味着什么、代价是什么（例如"这周你几乎在给别人的日程打工"）。
4. 最后给一条明确、具体、下周就能执行的动作，要有决断感，不要"不妨试试"这类软话。
5. 可以犀利，但对事不对人：不给用户贴负面标签、不制造焦虑、不说教。用「你」称呼。
6. 如果数据确实不错，别硬找茬——直接说她这周稳在哪、下一步该往哪儿拔高。控制在 130 字以内。
7. 【非常重要】"完成件数"和"投入时长"是两回事。用户可能完成了很多重要的事，却忘了给每件事点「加时间」记录耗时，导致所有"小时/时长/深度工作"指标都是 0。这种情况下绝对不能说她"没投入、没做事、浪费了一周、连深度工作都没有"——这是错怪她。要先肯定她完成了几件重要的事，再温和提醒她下周做完随手记一下耗时，这样复盘才能看清时间分配。只有当"完成件数"本身也很低或重要事项完成很少时，才谈重心跑偏的问题。
8. 除了周日程，也要把用户的「目标打卡」一起纳入点评：达成的目标要点名表扬（说到做到），一次没打卡或明显落后的目标要点破并给一句下周怎么补的建议。把它自然揉进同一段话里，不要单独分段、不要罗列，控制好总字数。如果没有目标数据就不提。

四象限含义：重要且紧急=被 deadline 追着做的救火；重要不紧急=真正长期有价值的事；紧急不重要=别人塞来的杂事；不重要不紧急=纯耗时间的琐事。`;

  const hasTime = stats.hasTime !== false && (stats.effectiveH || 0) > 0;

  // 目标打卡摘要（和周日程一起给模型点评）
  let goalLine = "";
  const gs = stats.goals;
  if (gs && Array.isArray(gs.items) && gs.items.length > 0) {
    const detail = gs.items.map(function (it) {
      return `${it.title} ${it.cur}/${it.tgt}${it.unit || ""}（${it.pct}%${it.reached ? "，已达成" : ""}）`;
    }).join("；");
    goalLine = `\n本周目标打卡：共 ${gs.total} 个，达成 ${gs.reached} 个，一次没打卡 ${gs.untouched} 个，整体约 ${gs.avgPct}%。明细：${detail}。请把目标打卡也一起点评（达成的表扬、没动或落后的点破并给下周建议），揉进同一段话。`;
  }

  let userContent;
  if (!hasTime) {
    userContent = `这是${week || "本周"}的数据。注意：用户完成了任务，但这周一件都没点「加时间」记录实际耗时，所以下面所有"小时/时长/深度工作"指标都是 0——这只代表没记录，不代表她没做事，千万不要据此说她没投入或浪费了一周：
- 完成任务 ${stats.done} 件，其中「重要」的事（重要且紧急+重要不紧急）${stats.importantDone || 0} 件，活跃 ${stats.activeDays} 天
- 会议 ${stats.meetCount} 场
请基于"完成件数"写点评：先肯定她完成了 ${stats.importantDone || 0} 件重要的事、方向对不对，再用一句话温和提醒她下周做完随手点「加时间」记录耗时，这样复盘就能看出时间分配和深度工作。${goalLine}`;
  } else {
    userContent = `这是${week || "本周"}的数据：
- 完成任务 ${stats.done} 件（其中「重要」的事 ${stats.importantDone || 0} 件），活跃 ${stats.activeDays} 天
- 重心分类：${stats.topCat || "暂无"}（投入 ${stats.topCatH || 0} 小时）
- 重要的事（重要且紧急+重要不紧急）时间占比：${stats.importantPct}%
- 其中「重要且紧急」占 ${stats.q1Pct}%，「不重要不紧急」占 ${stats.q4Pct}%
- 深度工作 ${stats.deepH} 小时
- 会议 ${stats.meetCount} 场、共 ${stats.meetH} 小时，约占有效投入的 ${stats.meetPct}%

请基于这些数字，给我写一段本周点评。${goalLine}`;
  }

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
          { role: "user", content: userContent }
        ],
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const err = await response.text();
      res.status(502).json({ error: "AI service error", detail: err });
      return;
    }

    const data = await response.json();
    const text = (data.choices?.[0]?.message?.content || "").trim();
    res.status(200).json({ text });
  } catch (err) {
    res.status(500).json({ error: "Internal error", detail: err.message });
  }
};
