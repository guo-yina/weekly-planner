// Vercel Serverless Function: 生成「桌面小组件」专属链接
// 校验浏览器里的 Supabase 登录态，通过后签发一个 HMAC 签名 token。
// token 只包含签名后的用户 ID（不含密码/会话凭证），可以放心贴在桌面壁纸里。

const crypto = require("crypto");

const SUPABASE_URL = "https://exhxxaruksmvpekxhhwf.supabase.co";
const SUPABASE_ANON = "sb_publishable_MrnovuebKNOHygoAvabtBg_Ee1wLt_f";

function b64url(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const secret = process.env.WIDGET_SECRET;
  if (!secret) { res.status(500).json({ error: "not-configured" }); return; }

  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) { res.status(401).json({ error: "no-session" }); return; }

  try {
    // 用 Supabase 官方接口校验前端传来的 access token，并拿到用户 ID
    const r = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: {
        "apikey": SUPABASE_ANON,
        "Authorization": "Bearer " + m[1]
      }
    });
    if (!r.ok) { res.status(401).json({ error: "bad-session" }); return; }
    const user = await r.json();
    const uid = user && user.id;
    if (!uid) { res.status(401).json({ error: "bad-session" }); return; }

    const sig = crypto.createHmac("sha256", secret).update(uid).digest();
    const token = b64url(uid) + "." + b64url(sig);
    res.status(200).json({ ok: true, token: token });
  } catch (e) {
    res.status(500).json({ error: "internal", detail: e.message });
  }
};
