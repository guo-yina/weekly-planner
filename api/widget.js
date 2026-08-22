// Vercel Serverless Function: 桌面小组件数据接口（只读）
// 校验 HMAC 签名链接 (?k=...)，用服务端密钥读取该用户本周日程。
// 返回 7 天任务数组，小组件页面自己负责展示。

const crypto = require("crypto");

const SUPABASE_URL = "https://exhxxaruksmvpekxhhwf.supabase.co";

function fromB64url(s) {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  const secret = process.env.WIDGET_SECRET;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !serviceKey) { res.status(500).json({ ok: false, error: "not-configured" }); return; }

  // ---- 校验签名 token ----
  const k = String(req.query.k || "");
  const parts = k.split(".");
  if (parts.length !== 2) { res.status(401).json({ ok: false, error: "invalid-link" }); return; }

  let uid;
  try { uid = fromB64url(parts[0]).toString("utf8"); }
  catch (e) { res.status(401).json({ ok: false, error: "invalid-link" }); return; }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid)) {
    res.status(401).json({ ok: false, error: "invalid-link" }); return;
  }

  const expectSig = crypto.createHmac("sha256", secret).update(uid).digest();
  let gotSig;
  try { gotSig = fromB64url(parts[1]); }
  catch (e) { res.status(401).json({ ok: false, error: "invalid-link" }); return; }
  if (gotSig.length !== expectSig.length || !crypto.timingSafeEqual(gotSig, expectSig)) {
    res.status(401).json({ ok: false, error: "invalid-link" }); return;
  }

  // ---- 确定要取哪一周：优先前端传来的周一日期 (?ws=YYYY-MM-DD)，缺省按北京时间算 ----
  let ws = String(req.query.ws || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ws)) {
    const now = new Date(Date.now() + 8 * 3600 * 1000); // UTC+8
    const dow = now.getUTCDay() || 7; // 1=周一 ... 7=周日
    now.setUTCDate(now.getUTCDate() - (dow - 1));
    ws = now.toISOString().slice(0, 10);
  }

  try {
    const url = SUPABASE_URL + "/rest/v1/weekly_data?select=user_id,week_start,tasks,updated_at"
      + "&user_id=eq." + encodeURIComponent(uid)
      + "&week_start=eq." + encodeURIComponent(ws);
    const r = await fetch(url, {
      headers: {
        "apikey": serviceKey,
        "Authorization": "Bearer " + serviceKey
      }
    });
    if (!r.ok) {
      const t = await r.text();
      res.status(502).json({ ok: false, error: "db-error", detail: t.slice(0, 200) });
      return;
    }
    const rows = await r.json();
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;
    res.status(200).json({
      ok: true,
      weekStart: ws,
      tasks: row ? (row.tasks || []) : [],
      updatedAt: row ? (row.updated_at || null) : null
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "internal", detail: e.message });
  }
};
