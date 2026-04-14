// api/claude.js — Vercel serverless function (CommonJS)
// Proxies requests to the Anthropic API with server-side auth.
// Required env var: ANTHROPIC_API_KEY

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

module.exports = async function handler(req, res) {
  // CORS headers for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: { type: "method_error", message: "Only POST allowed" } });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[api/claude] ANTHROPIC_API_KEY not set");
    return res.status(500).json({
      error: { type: "config_error", message: "ANTHROPIC_API_KEY is not configured on the server." }
    });
  }

  const body = req.body;
  if (!body || !body.model || !body.messages) {
    return res.status(400).json({
      error: { type: "invalid_request", message: "Missing model or messages in request body." }
    });
  }

  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: body.model,
        max_tokens: body.max_tokens || 4096,
        system: body.system || "",
        messages: body.messages,
      }),
    });

    const ct = upstream.headers.get("content-type") || "";
    if (!ct.includes("json")) {
      const txt = await upstream.text();
      console.error("[api/claude] Non-JSON from Anthropic:", txt.substring(0, 200));
      return res.status(502).json({
        error: { type: "upstream_error", message: "Anthropic returned non-JSON response." }
      });
    }

    const data = await upstream.json();
    return res.status(upstream.status).json(data);

  } catch (err) {
    console.error("[api/claude] Proxy error:", err.message);
    return res.status(502).json({
      error: { type: "proxy_error", message: "Could not reach Anthropic: " + err.message }
    });
  }
};
