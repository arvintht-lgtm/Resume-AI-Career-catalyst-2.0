import { useState, useRef, useEffect } from "react";

/* ═══════════════════════════════════════════════════════════
   CAREER CATALYST — AI Resume Intelligence Platform
   Auto-detects environment:
     - Claude artifact → direct Anthropic API (proxy injects auth)
     - Vercel/standalone → /api/claude serverless proxy
   ═══════════════════════════════════════════════════════════ */

// ─── Design Tokens ─────────────────────────────────────────
const T = {
  bg: "#f6f7f9", card: "#ffffff",
  primary: "#0b3d91", primarySoft: "#e4edf8", primaryGhost: "#f3f7fc",
  accent: "#5856d6", accentSoft: "#eeedfc",
  ok: "#0f7b5f", okSoft: "#e5f5ef",
  warn: "#b85c00", warnSoft: "#fff4e5",
  err: "#c62828", errSoft: "#fdeaea",
  text: "#101828", t2: "#475467", t3: "#98a2b3",
  border: "#e4e7ec", borderSoft: "#f2f4f7",
};
const font = `'DM Sans', system-ui, sans-serif`;
const fontD = `'Instrument Serif', Georgia, serif`;

// ─── UI Primitives ─────────────────────────────────────────
const Ic = ({ n, sz = 18, c = T.t3, f = false, s }) => (
  <span className="mso" style={{ fontSize: sz, color: c, fontVariationSettings: f ? "'FILL' 1" : "'FILL' 0", lineHeight: 1, ...s }}>{n}</span>
);

const Pill = ({ children, c = "default" }) => {
  const palette = { default: [T.borderSoft, T.t2], primary: [T.primarySoft, T.primary], ok: [T.okSoft, T.ok], warn: [T.warnSoft, T.warn], err: [T.errSoft, T.err], accent: [T.accentSoft, T.accent] };
  const [bg, fg] = palette[c] || palette.default;
  return <span style={{ background: bg, color: fg, padding: "3px 10px", borderRadius: 6, fontSize: 10.5, fontWeight: 600, whiteSpace: "nowrap" }}>{children}</span>;
};

const Ring = ({ v, sz = 96, sw = 4, c = T.ok }) => {
  const r = (sz - sw) / 2, ci = 2 * Math.PI * r, off = ci - (v / 100) * ci;
  return (
    <div style={{ position: "relative", width: sz, height: sz, flexShrink: 0 }}>
      <svg width={sz} height={sz} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={sz / 2} cy={sz / 2} r={r} fill="none" stroke={T.borderSoft} strokeWidth={sw} />
        <circle cx={sz / 2} cy={sz / 2} r={r} fill="none" stroke={c} strokeWidth={sw} strokeDasharray={ci} strokeDashoffset={off} strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s ease" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: sz * 0.26, fontWeight: 700, color: c, fontFamily: font }}>{v}%</span>
      </div>
    </div>
  );
};

const Card = ({ children, p = 22, s }) => (
  <div style={{ background: T.card, borderRadius: 14, padding: p, border: `1px solid ${T.border}`, ...s }}>{children}</div>
);

const Lbl = ({ children, icon }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
    {icon && <Ic n={icon} sz={14} c={T.primary} />}
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".11em", color: T.t3 }}>{children}</span>
  </div>
);

const Btn = ({ children, onClick, v = "primary", disabled, s, icon }) => {
  const styles = {
    primary: { background: T.primary, color: "#fff", border: "none" },
    ghost: { background: "transparent", color: T.t2, border: `1px solid ${T.border}` },
    ok: { background: T.ok, color: "#fff", border: "none" },
  };
  return (
    <button disabled={disabled} onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 18px",
      borderRadius: 8, fontWeight: 600, fontSize: 12, fontFamily: font,
      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1,
      ...styles[v], ...s
    }}>
      {icon && <Ic n={icon} sz={14} c={v === "primary" || v === "ok" ? "#fff" : T.t2} />}
      {children}
    </button>
  );
};

// ═══════════════════════════════════════════════════════════
//  API LAYER — auto-detects environment
// ═══════════════════════════════════════════════════════════
class RateLimitError extends Error {
  constructor(message, retryAfter) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

const MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
];

// Detect if we're inside a Claude artifact (iframe on claude.ai)
// In that environment, the Anthropic API can be called directly because
// a proxy transparently injects auth headers.
function detectApiUrl() {
  try {
    // Claude artifacts run in iframes — check if we're in one
    const inIframe = window.self !== window.top;
    // Also check referrer/ancestor origin hints
    const onClaudeSite = document.referrer.includes("claude.ai") ||
      window.location.ancestorOrigins?.[0]?.includes("claude.ai");

    if (inIframe || onClaudeSite) {
      console.log("[CC] Detected Claude artifact environment → direct API");
      return "https://api.anthropic.com/v1/messages";
    }
  } catch {
    // Cross-origin iframe access throws — that's actually a signal we ARE in an iframe
    console.log("[CC] Cross-origin iframe detected → direct API");
    return "https://api.anthropic.com/v1/messages";
  }

  // Check if /api/claude is likely available (Vercel/standalone deployment)
  console.log("[CC] Standalone environment → /api/claude proxy");
  return "/api/claude";
}

const API_URL = detectApiUrl();

async function askClaude(systemPrompt, userMessage, modelIndex = 0) {
  const model = MODELS[modelIndex];
  if (!model) throw new RateLimitError("All models rate-limited. Try again later.", null);

  console.log(`[CC] → ${model.id} via ${API_URL}`);

  const payload = {
    model: model.id,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  };

  let res;
  try {
    const headers = { "Content-Type": "application/json" };
    // Add anthropic-version for direct API calls (artifact env)
    if (API_URL.includes("anthropic.com")) {
      headers["anthropic-version"] = "2023-06-01";
    }
    res = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (networkErr) {
    console.error("[CC] Network error:", networkErr);
    throw new Error("Network error — could not reach the AI service. Check your connection and try again.");
  }

  // Check content-type BEFORE trying to parse JSON
  const ct = res.headers?.get("content-type") || "";
  if (!ct.includes("json") && !ct.includes("text/plain")) {
    // Got HTML back — likely a 404 page or CORS redirect
    let preview = "";
    try { preview = (await res.text()).substring(0, 100); } catch { /* ignore */ }
    console.error(`[CC] Non-JSON response (${res.status}): ${preview}`);

    if (API_URL === "/api/claude") {
      throw new Error("API route /api/claude not found. If deploying to Vercel, ensure the api/ folder is included. For local dev, run 'npx vercel dev' instead of 'npm run dev'.");
    }
    throw new Error("AI service returned an unexpected response. Please try again.");
  }

  // Parse JSON
  let body;
  try {
    body = await res.json();
  } catch (parseErr) {
    console.error("[CC] JSON parse failed:", parseErr);
    throw new Error("AI service returned unreadable data. Please try again.");
  }

  console.log(`[CC] ← status=${res.status} type=${body?.type || body?.error?.type || "ok"}`);

  // Rate limit / quota / overload detection
  const isQuota = body?.type === "exceeded_limit" || body?.error?.type === "exceeded_limit";
  const is429 = res.status === 429;
  const is529 = res.status === 529;

  if (isQuota || is429 || is529) {
    const retryAfter = res.headers?.get("retry-after");
    // Try fallback model
    if (modelIndex < MODELS.length - 1) {
      console.log(`[CC] Rate limited on ${model.id}, falling back to ${MODELS[modelIndex + 1].id}`);
      return askClaude(systemPrompt, userMessage, modelIndex + 1);
    }
    const msg = isQuota
      ? "AI quota exceeded. Please wait and try later."
      : is429
        ? "Too many requests. Wait a moment and retry."
        : "AI service overloaded. Try again shortly.";
    throw new RateLimitError(msg, retryAfter ? parseInt(retryAfter, 10) : null);
  }

  // Config error from our Vercel proxy
  if (body?.error?.type === "config_error") {
    throw new Error("Server not configured — ANTHROPIC_API_KEY environment variable is missing.");
  }

  // Auth errors
  if (res.status === 401 || res.status === 403) {
    throw new Error("Authentication failed. If using Vercel, check your ANTHROPIC_API_KEY. If in Claude.ai, try refreshing the page.");
  }

  // Other API errors
  if (!res.ok || body?.error) {
    const msg = body?.error?.message || `AI service error (${res.status})`;
    console.error("[CC] API error:", msg);
    throw new Error(msg);
  }

  // Extract text from response
  const text = (body.content || [])
    .filter(block => block.type === "text")
    .map(block => block.text)
    .join("");

  if (!text) throw new Error("AI returned an empty response. Please try again.");
  console.log(`[CC] Success, response length: ${text.length}`);
  return text;
}

// ─── JSON extraction (handles markdown fences etc) ─────────
function extractJSON(raw) {
  // Direct parse
  try { return JSON.parse(raw.trim()); } catch { /* try next */ }
  // Strip markdown code fences
  const stripped = raw.replace(/^```(?:json)?\s*/gm, "").replace(/```\s*$/gm, "").trim();
  try { return JSON.parse(stripped); } catch { /* try next */ }
  // Extract first JSON object
  const objMatch = stripped.match(/\{[\s\S]*\}/);
  if (objMatch) try { return JSON.parse(objMatch[0]); } catch { /* try next */ }
  // Extract first JSON array
  const arrMatch = stripped.match(/\[[\s\S]*\]/);
  if (arrMatch) try { return JSON.parse(arrMatch[0]); } catch { /* try next */ }
  throw new Error("Could not parse structured data from AI. Please try again.");
}

// ─── AI Tool Functions ─────────────────────────────────────
async function parseResume(text) {
  const sys = `You are an expert resume parser. Return ONLY valid JSON, no markdown fences, no explanation. Schema: {"name":"string","title":"string","location":"string","email":"string","phone":"string","layoutType":"string","sections":[{"name":"string","status":"detected|inferred|extracted|mapped","confidence":90,"heading":"string","note":"string"}],"summary":"string","experience":[{"role":"string","company":"string","period":"string","bullets":["string"]}],"education":[{"degree":"string","school":"string","year":"string"}],"coreSkills":["string"],"transferableSkills":["string"],"domainSkills":["string"],"certifications":["string"]}. Extract ALL skills from bullets too. Infer transferable skills. Confidence 80-99.`;
  return extractJSON(await askClaude(sys, "Parse this resume:\n\n" + text));
}

async function matchJD(resumeData, jdText) {
  const sys = `You are a resume-to-JD matcher. Return ONLY valid JSON, no markdown. Schema: {"matchScore":82,"keywordScore":75,"semanticScore":89,"matchLevel":"Strong Match","semanticMatches":[{"resume":"phrase","jd":"phrase","score":88}],"missingKeywords":["kw"],"suggestions":[{"id":1,"category":"ATS Optimization","icon":"search","original":"text","improved":"text","reason":"text","impact":"High","tags":["ATS"]}],"interviewQuestions":[{"category":"Resume-Based","question":"q","source":"source","confidence":"Strong","followUp":"q","starHint":"hint"}]}. Generate 4-6 suggestions and 4-6 questions using real content from the resume.`;
  return extractJSON(await askClaude(sys, "Resume:\n" + JSON.stringify(resumeData) + "\n\nJob Description:\n" + jdText));
}

// ═══════════════════════════════════════════════════════════
//  REAL JOB SEARCH + AI APPLY
// ═══════════════════════════════════════════════════════════
async function fetchJobs(resumeData) {
  const res = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: resumeData.title || "",
      skills: (resumeData.coreSkills || []).slice(0, 8),
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Job search failed (${res.status})`);
  }
  const { jobs } = await res.json();
  return jobs || [];
}

async function tailorResumeForJob(resumeData, job) {
  const sys = `You are an expert resume consultant. Tailor the resume JSON for the given job posting. Return ONLY valid JSON with the EXACT same schema as the input. Rules:
- Rewrite "summary" (2-3 sentences) to highlight fit for this specific role and company
- Reorder "coreSkills" so the most job-relevant skills appear first
- Do NOT fabricate new experience, companies, dates, or skills that are not in the original
- Keep all other fields (name, experience bullets, education, etc.) unchanged`;
  const msg = `Resume:\n${JSON.stringify(resumeData)}\n\nJob: ${job.title} at ${job.company}\nDescription: ${(job.description || "").substring(0, 1000)}`;
  return extractJSON(await askClaude(sys, msg));
}

async function genCoverLetter(resumeData, job) {
  const sys = `You are a professional cover letter writer. Write a concise, compelling cover letter. Return ONLY valid JSON (no markdown):
{"subject":"string","greeting":"string","paragraphs":["opening paragraph","skills and experience paragraph","closing call-to-action paragraph"],"closing":"string"}
Be specific: reference the company name and role. Avoid clichés. Each paragraph 2-3 sentences.`;
  const skills = [...(resumeData.coreSkills || []), ...(resumeData.domainSkills || [])].slice(0, 6).join(", ");
  const msg = `Candidate: ${resumeData.name || "Candidate"}, ${resumeData.title || ""}\nApplying for: ${job.title} at ${job.company}\nJob description: ${(job.description || "").substring(0, 600)}\nTop skills: ${skills}`;
  return extractJSON(await askClaude(sys, msg));
}

function buildCoverLetterHTML(letter, resumeData, job) {
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cover Letter — ${esc(job.title)}</title>
<style>@page{margin:.8in 1in}*{margin:0;padding:0;box-sizing:border-box}body{font-family:Georgia,'Times New Roman',serif;font-size:11pt;color:#111;line-height:1.75;max-width:6.5in;margin:0 auto;padding:.5in}.nm{font-size:13pt;font-weight:700;margin-bottom:3px}.ct{font-size:9.5pt;color:#555;margin-bottom:22px}.co{font-weight:600;margin-bottom:16px;font-size:10.5pt}.sb{font-weight:700;margin-bottom:14px;font-size:10.5pt}.pg{margin-bottom:13px}.cl{margin-top:24px;margin-bottom:32px}.sg{font-weight:700;font-size:11pt}@media print{body{padding:0}}</style></head><body>
<div class="nm">${esc(resumeData.name || "")}</div>
<div class="ct">${[resumeData.email, resumeData.phone, resumeData.location].filter(Boolean).map(esc).join(" · ")}</div>
<p style="margin-bottom:16px;font-size:10.5pt">${esc(date)}</p>
<div class="co">${esc(job.company)}<br>${esc(job.title)}</div>
<div class="sb">${esc(letter.subject || "Re: " + job.title + " Position")}</div>
<p class="pg">${esc(letter.greeting || "Dear Hiring Manager,")}</p>
${(letter.paragraphs || []).map(p => `<p class="pg">${esc(p)}</p>`).join("")}
<div class="cl">${esc(letter.closing || "Sincerely,")}</div>
<div class="sg">${esc(resumeData.name || "")}</div>
</body></html>`;
}

function downloadCoverLetter(letter, resumeData, job) {
  const html = buildCoverLetterHTML(letter, resumeData, job);
  const name = String(resumeData.name || "Applicant").replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_");
  const printHtml = html.replace("</body>", `<script>window.onload=function(){setTimeout(function(){window.print()},400)};<\/script></body>`);
  const w = window.open("", "_blank");
  if (w) { w.document.open(); w.document.write(printHtml); w.document.close(); }
  else {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name + "_cover_letter.html";
    document.body.appendChild(a); a.click(); setTimeout(() => document.body.removeChild(a), 100);
  }
}

// ═══════════════════════════════════════════════════════════
//  SHARE — localStorage (same-device, explicit in UI)
// ═══════════════════════════════════════════════════════════
function saveShare(state) {
  const id = "cc_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  try {
    localStorage.setItem(id, JSON.stringify({
      resumeData: state.resumeData,
      matchData: state.matchData,
      jobFeed: state.jobFeed,
    }));
    return id;
  } catch (err) {
    if (err && (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED")) {
      throw new Error("Storage full — resume too large to share. Try clearing browser data and retry.");
    }
    throw new Error("Could not save — localStorage unavailable or disabled.");
  }
}

function loadShare(id) {
  try {
    const raw = localStorage.getItem(id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
//  EXPORT ENGINE
// ═══════════════════════════════════════════════════════════
function esc(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const AI_PATTERNS = [
  /^consider\s+(adding|including|mentioning|highlighting)/i,
  /^(add|include|mention|highlight)\s+a\s+['"]?why\s+this/i,
  /cover\s+note\s+or\s+profile\s+addendum/i,
  /directly\s+transferable\s+to\s+client\s+advisory/i,
  /^(tip|note|suggestion|recommendation)\s*:/i,
  /^you\s+(should|could|might|may)\s+(consider|add|include)/i,
  /acknowledging\s+the\s+domain\s+transition/i,
  /insurance\s+broking\s+workflows/i,
];
function isAISuggestion(b) { return AI_PATTERNS.some(p => p.test(b.trim())); }

function matchBullet(bullet, suggestions, appliedIds) {
  const bL = bullet.toLowerCase().trim();
  for (const sg of suggestions) {
    if (!sg.original || !sg.improved) continue;
    const shouldUse = appliedIds.size > 0 ? appliedIds.has(sg.id) : true;
    if (!shouldUse) continue;
    const oL = sg.original.toLowerCase().trim();
    if (bL === oL) return sg;
    if (oL.length > 10 && bL.includes(oL)) return sg;
    if (bL.length > 10 && oL.includes(bL)) return sg;
    const len = Math.min(30, oL.length, bL.length);
    if (len > 10 && bL.substring(0, len) === oL.substring(0, len)) return sg;
  }
  return null;
}

function buildResumeHTML(data, match, mode, appliedIds) {
  const sug = match?.suggestions || [];
  const getBullet = (b) => {
    if (mode === "preserve") return b;
    const found = matchBullet(b, sug, appliedIds);
    return found ? found.improved : b;
  };
  const skills = [...(data.coreSkills || []), ...(data.transferableSkills || []), ...(data.domainSkills || [])];
  const isAts = mode === "ats";
  const isMod = mode === "modern";
  const ff = isAts ? "Arial,Helvetica,sans-serif" : isMod ? "'Segoe UI',Tahoma,sans-serif" : "Georgia,'Times New Roman',serif";
  const ac = isAts ? "#000" : isMod ? "#0b3d91" : "#333";
  const safeName = esc(data.name || "Resume");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeName}</title>
<style>
@page{margin:.6in .75in;size:letter}*{margin:0;padding:0;box-sizing:border-box}
body{font-family:${ff};font-size:${isAts ? "11pt" : "10.5pt"};color:#222;line-height:1.5;max-width:8.5in;margin:0 auto;padding:.4in .6in}
h1{font-size:${isMod ? "22pt" : "18pt"};font-weight:${isMod ? "300" : "700"};color:${ac};text-transform:uppercase;margin-bottom:4px${isMod ? ";border-bottom:2px solid " + ac + ";padding-bottom:6px" : ""}}
.ct{font-size:9.5pt;color:#555;margin-bottom:10px}
.st{font-size:${isAts ? "11pt" : "10pt"};font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:${ac};border-bottom:1px solid ${isAts ? "#000" : "#ccc"};padding-bottom:2px;margin:12px 0 6px}
.jh{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:1px}.jt{font-weight:700;font-size:10.5pt}.jd{font-size:9pt;color:#666}
.jc{font-style:italic;font-size:9.5pt;color:${isMod ? ac : "#444"};margin-bottom:4px}
ul{padding-left:18px;margin:2px 0 8px}li{margin-bottom:3px;font-size:10pt;line-height:1.5}
.sk{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}.st2{${isAts ? "font-size:10pt" : "font-size:9pt;background:#f0f4f8;padding:2px 8px;border-radius:4px;color:" + ac}}
.sum{font-size:10pt;color:#444;line-height:1.6;margin-bottom:4px}
.ed{margin-bottom:4px}.edt{font-weight:600;font-size:10pt}.eds{font-size:9.5pt;color:#555}
@media print{body{padding:0}}
</style></head><body>
<h1>${safeName}</h1>
<div class="ct">${[data.title, data.location, data.email, data.phone].filter(Boolean).map(esc).join(" &middot; ")}</div>
${data.summary ? `<div class="st">Summary</div><p class="sum">${esc(data.summary)}</p>` : ""}
${(data.experience || []).length ? `<div class="st">Experience</div>` + data.experience.map(e => `
<div class="jh"><span class="jt">${esc(e.role)}</span><span class="jd">${esc(e.period || "")}</span></div>
<div class="jc">${esc(e.company)}</div>
<ul>${(e.bullets || []).filter(b => !isAISuggestion(b)).map(b => `<li>${esc(getBullet(b))}</li>`).join("")}</ul>`).join("") : ""}
${(data.education || []).length ? `<div class="st">Education</div>` + data.education.map(e => `<div class="ed"><span class="edt">${esc(e.degree || "")}</span> <span class="eds">&mdash; ${esc(e.school || "")} ${e.year ? `(${esc(e.year)})` : ""}</span></div>`).join("") : ""}
${skills.length ? `<div class="st">Skills</div><div class="sk">${skills.map(s => `<span class="st2">${esc(s)}</span>`).join(isAts ? ", " : "")}</div>` : ""}
${(data.certifications || []).length ? `<div class="st">Certifications</div><div>${data.certifications.map(esc).join(", ")}</div>` : ""}
</body></html>`;
}

function downloadResume(data, match, mode, appliedIds) {
  const html = buildResumeHTML(data, match, mode, appliedIds);
  const name = String(data.name || "Resume").replace(/[^a-zA-Z0-9 ]/g, "");
  const printHtml = html.replace("</body>",
    `<script>window.onload=function(){document.title=${JSON.stringify(name + " - Resume")};setTimeout(function(){window.print()},400)};<\/script></body>`
  );
  const w = window.open("", "_blank");
  if (w) {
    w.document.open();
    w.document.write(printHtml);
    w.document.close();
    return "popup";
  } else {
    // Popup blocked fallback — download HTML file
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name.replace(/\s+/g, "_") + "_resume.html";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); }, 100);
    return "file";
  }
}

// ═══════════════════════════════════════════════════════════
//  RATE LIMIT BANNER
// ═══════════════════════════════════════════════════════════
const RateLimitBanner = ({ onDismiss }) => (
  <div style={{ background: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 12, padding: "16px 20px", margin: "0 0 18px 0", display: "flex", alignItems: "flex-start", gap: 12 }}>
    <Ic n="schedule" sz={22} c="#F57F17" f={true} s={{ marginTop: 1, flexShrink: 0 }} />
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#E65100", marginBottom: 4 }}>AI temporarily unavailable</div>
      <p style={{ fontSize: 12.5, color: "#795548", lineHeight: 1.6, margin: 0 }}>Request could not be processed due to quota, rate limiting, or service overload. Wait a moment and try again.</p>
    </div>
    {onDismiss && <button onClick={onDismiss} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Ic n="close" sz={16} c="#A1887F" /></button>}
  </div>
);

// ═══════════════════════════════════════════════════════════
//  APPLY MODAL — per-job AI application kit
// ═══════════════════════════════════════════════════════════
const ApplyModal = ({ job, resumeData, onClose }) => {
  const [phase, setPhase] = useState("idle"); // idle | generating | done | error
  const [progress, setProgress] = useState("");
  const [tailored, setTailored] = useState(null);
  const [cover, setCover] = useState(null);
  const [err, setErr] = useState(null);
  const [rlimited, setRlimited] = useState(false);

  const runPrep = async () => {
    setPhase("generating");
    setErr(null);
    setRlimited(false);
    try {
      setProgress("Step 1/2 — Tailoring resume to this role…");
      const t = await tailorResumeForJob(resumeData, job);
      setTailored(t);
      setProgress("Step 2/2 — Writing personalised cover letter…");
      const c = await genCoverLetter(resumeData, job);
      setCover(c);
      setPhase("done");
    } catch (e) {
      if (e.name === "RateLimitError") setRlimited(true);
      setErr(e.message);
      setPhase("error");
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,.52)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: T.card, borderRadius: 16, width: "100%", maxWidth: 520, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,.22)", padding: 26 }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div style={{ flex: 1, marginRight: 12 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: T.text, marginBottom: 2 }}>{job.title}</div>
            <div style={{ fontSize: 12, color: T.t2 }}>{job.company} · {job.location}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, flexShrink: 0 }}><Ic n="close" sz={18} c={T.t3} /></button>
        </div>

        <div style={{ display: "flex", gap: 5, marginBottom: 14 }}>
          <Pill c="default">{job.source}</Pill>
          {job.remote && <Pill c="ok">Remote</Pill>}
          {job.salary && <Pill c="accent">{job.salary}</Pill>}
        </div>

        {/* Job description preview */}
        <div style={{ background: T.borderSoft, borderRadius: 9, padding: "10px 14px", marginBottom: 20, maxHeight: 90, overflowY: "auto" }}>
          <div style={{ fontSize: 8.5, fontWeight: 700, color: T.t3, marginBottom: 4 }}>JOB OVERVIEW</div>
          <div style={{ fontSize: 10.5, color: T.t2, lineHeight: 1.6 }}>{(job.description || "").substring(0, 380)}{(job.description || "").length > 380 ? "…" : ""}</div>
        </div>

        {/* ── Idle ── */}
        {phase === "idle" && (<>
          <div style={{ background: T.primaryGhost, borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: T.primary, marginBottom: 10 }}>AI will prepare 2 things</div>
            {[
              ["Tailored resume", `Summary + skills reordered to highlight fit for ${job.title}`],
              ["Cover letter", `3-paragraph letter personalised for ${job.company}`],
            ].map(([title, desc], i) => (
              <div key={i} style={{ display: "flex", gap: 9, marginBottom: i === 0 ? 8 : 0 }}>
                <Ic n="check_circle" sz={15} c={T.ok} f={true} s={{ flexShrink: 0, marginTop: 1 }} />
                <div><div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{title}</div><div style={{ fontSize: 10.5, color: T.t2 }}>{desc}</div></div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Btn onClick={runPrep} icon="auto_awesome" s={{ justifyContent: "center", padding: "11px 0" }}>Prepare Application with AI</Btn>
            <Btn v="ghost" onClick={() => window.open(job.url, "_blank")} icon="open_in_new" s={{ justifyContent: "center", padding: "9px 0", fontSize: 11 }}>Apply directly on {job.source}</Btn>
          </div>
        </>)}

        {/* ── Generating ── */}
        {phase === "generating" && (
          <div style={{ textAlign: "center", padding: "28px 0" }}>
            <div style={{ display: "inline-block", width: 34, height: 34, border: `3px solid ${T.borderSoft}`, borderTopColor: T.primary, borderRadius: "50%", animation: "spin 1s linear infinite", marginBottom: 14 }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 4 }}>{progress}</div>
            <div style={{ fontSize: 11, color: T.t2 }}>Typically 15–30 seconds</div>
          </div>
        )}

        {/* ── Done ── */}
        {phase === "done" && (<>
          <div style={{ background: T.okSoft, borderRadius: 9, padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: T.ok, fontWeight: 600 }}>
            <Ic n="check_circle" sz={16} c={T.ok} f={true} />Application kit ready!
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Btn v="ok" icon="download" onClick={() => downloadResume(tailored, null, "enhanced", new Set())} s={{ justifyContent: "center", padding: "10px 0" }}>Download Tailored Resume</Btn>
            <Btn v="ghost" icon="download" onClick={() => downloadCoverLetter(cover, resumeData, job)} s={{ justifyContent: "center", padding: "10px 0" }}>Download Cover Letter</Btn>
            <Btn icon="open_in_new" onClick={() => window.open(job.url, "_blank")} s={{ justifyContent: "center", padding: "10px 0" }}>Open Job Application</Btn>
          </div>
        </>)}

        {/* ── Error ── */}
        {phase === "error" && (<>
          {rlimited
            ? <RateLimitBanner onDismiss={() => setRlimited(false)} />
            : <div style={{ background: T.errSoft, color: T.err, padding: "10px 14px", borderRadius: 8, fontSize: 12, lineHeight: 1.5, marginBottom: 12 }}><strong>Error:</strong> {err}</div>
          }
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Btn onClick={runPrep} icon="refresh" s={{ justifyContent: "center", padding: "9px 0" }}>Try again</Btn>
            <Btn v="ghost" onClick={() => window.open(job.url, "_blank")} icon="open_in_new" s={{ justifyContent: "center", padding: "9px 0", fontSize: 11 }}>Apply directly on {job.source}</Btn>
          </div>
        </>)}

      </div>
    </div>
  );
};

const ProcBar = () => (
  <div style={{ background: T.primaryGhost, borderBottom: `1px solid ${T.border}`, padding: "9px 28px", display: "flex", alignItems: "center", gap: 14, overflowX: "auto" }}>
    {["Parsed document", "Detected sections", "Mapped headings", "Extracted skills", "Built profile"].map((s, i, a) => (
      <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
        <Ic n="check_circle" sz={13} c={T.ok} f={true} />
        <span style={{ fontSize: 11, fontWeight: 500, color: T.text, whiteSpace: "nowrap" }}>{s}</span>
        {i < a.length - 1 && <div style={{ width: 14, height: 1, background: T.border }} />}
      </div>
    ))}
  </div>
);

// ═══════════════════════════════════════════════════════════
//  UPLOAD SCREEN
// ═══════════════════════════════════════════════════════════
const Upload = ({ onDone }) => {
  const [resume, setResume] = useState("");
  const [jd, setJd] = useState("");
  const [phase, setPhase] = useState("resume");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState(null);
  const [rateLimited, setRateLimited] = useState(false);
  const fRef = useRef(null);

  const doAnalyze = async () => {
    if (rateLimited) return;
    if (!resume.trim()) { setError("Paste your resume first."); return; }
    setError(null);
    setRateLimited(false);
    setPhase("working");
    try {
      setProgress("Step 1/2 — Parsing resume…");
      const resumeData = await parseResume(resume);
      let matchData = null;
      if (jd.trim()) {
        setProgress("Step 2/2 — Matching job description…");
        matchData = await matchJD(resumeData, jd);
      }
      setProgress("Finding live job matches…");
      const jobFeed = await fetchJobs(resumeData);
      onDone({ resumeData, matchData, jobFeed });
    } catch (err) {
      console.error("[CC] Analysis failed:", err);
      if (err.name === "RateLimitError") {
        setRateLimited(true);
        setError(null);
      } else {
        setError(err.message);
      }
      setPhase(jd.trim() ? "jd" : "resume");
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: T.bg, padding: 40 }}>
      <div style={{ maxWidth: 600, width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: T.primary, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Ic n="auto_awesome" sz={17} c="#fff" f={true} />
            </div>
            <span style={{ fontSize: 19, fontWeight: 700, color: T.primary }}>Career Catalyst</span>
          </div>
          <h1 style={{ fontFamily: fontD, fontSize: 36, fontWeight: 400, color: T.text, lineHeight: 1.15, margin: "0 0 6px 0" }}>
            {phase === "resume" ? "Paste your resume" : phase === "jd" ? "Add a job description" : "Analyzing…"}
          </h1>
          <p style={{ fontSize: 13.5, color: T.t2, maxWidth: 400, margin: "0 auto", lineHeight: 1.6 }}>
            {phase === "resume" && "Paste resume text below. AI parses it regardless of format."}
            {phase === "jd" && "Optional: paste a job description for match scoring, suggestions, and interview prep."}
            {phase === "working" && "Processing — typically 15–30 seconds."}
          </p>
        </div>

        {rateLimited && <RateLimitBanner onDismiss={() => setRateLimited(false)} />}

        {phase === "working" && (
          <Card p={40} s={{ textAlign: "center" }}>
            <div style={{ display: "inline-block", width: 36, height: 36, border: `3px solid ${T.borderSoft}`, borderTopColor: T.primary, borderRadius: "50%", animation: "spin 1s linear infinite", marginBottom: 14 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{progress}</div>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </Card>
        )}

        {phase === "resume" && (<>
          <Card p={0} s={{ overflow: "hidden", marginBottom: 14 }}>
            <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.border}`, background: T.borderSoft, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.t2 }}>Resume Text</span>
              <div>
                <input ref={fRef} type="file" accept=".txt,.md" onChange={e => { const f = e.target.files?.[0]; if (f) f.text().then(t => { setResume(t); setError(null); }).catch(() => setError("Can't read file")); }} style={{ display: "none" }} />
                <Btn v="ghost" icon="upload_file" onClick={() => fRef.current?.click()} s={{ padding: "4px 10px", fontSize: 10 }}>Upload .txt</Btn>
              </div>
            </div>
            <textarea value={resume} onChange={e => { setResume(e.target.value); setError(null); }}
              placeholder={"Paste your full resume text here…\n\nJane Smith\nSenior Product Manager | San Francisco, CA\njane@email.com\n\nProfessional Summary\nExperienced product leader with 8+ years…\n\nExperience\nSenior PM — Acme Corp (2021–Present)\n• Led cross-functional team of 12…\n• Drove $4.2M ARR growth in first year\n\nSkills\nProduct Strategy, SQL, A/B Testing, Agile…"}
              style={{ width: "100%", minHeight: 280, padding: 18, border: "none", outline: "none", fontFamily: "'DM Mono', monospace", fontSize: 12, lineHeight: 1.7, color: T.text, background: T.card, resize: "vertical" }} />
          </Card>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Btn onClick={() => { if (!resume.trim()) { setError("Paste resume first."); return; } setError(null); setPhase("jd"); }} icon="arrow_forward">Next: Job Description</Btn>
          </div>
        </>)}

        {phase === "jd" && (<>
          <Card p={0} s={{ overflow: "hidden", marginBottom: 14 }}>
            <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.border}`, background: T.borderSoft, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.t2 }}>Job Description <span style={{ fontWeight: 400, color: T.t3 }}>(optional)</span></span>
              <Btn v="ghost" onClick={() => setPhase("resume")} s={{ padding: "4px 10px", fontSize: 10 }} icon="arrow_back">Back</Btn>
            </div>
            <textarea value={jd} onChange={e => setJd(e.target.value)}
              placeholder={"Paste job description here…\n\nSenior Product Manager — TechCorp\n\nAbout the role\nWe're looking for a PM to own our platform…\n\nRequirements\n• 5+ years PM experience\n• SQL and analytics\n• B2B SaaS experience…"}
              style={{ width: "100%", minHeight: 220, padding: 18, border: "none", outline: "none", fontFamily: "'DM Mono', monospace", fontSize: 12, lineHeight: 1.7, color: T.text, background: T.card, resize: "vertical" }} />
          </Card>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Btn v="ghost" onClick={doAnalyze} icon="skip_next" disabled={rateLimited}>Skip — resume only</Btn>
            <Btn onClick={doAnalyze} icon="auto_awesome" disabled={rateLimited}>{rateLimited ? "Limit Reached" : "Analyze with AI"}</Btn>
          </div>
        </>)}

        {error && !rateLimited && (
          <div style={{ background: T.errSoft, color: T.err, padding: "12px 16px", borderRadius: 8, fontSize: 12.5, marginTop: 14, display: "flex", alignItems: "flex-start", gap: 8, lineHeight: 1.5 }}>
            <Ic n="error" sz={15} c={T.err} s={{ marginTop: 2, flexShrink: 0 }} />
            <div><strong>Error:</strong> {error}</div>
          </div>
        )}

        <p style={{ fontSize: 10.5, color: T.t3, textAlign: "center", marginTop: 24 }}>Powered by Claude AI · No data stored on server</p>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
//  SIDEBAR + TOPBAR
// ═══════════════════════════════════════════════════════════
const Sidebar = ({ tab, setTab, name }) => {
  const tabs = [
    { id: "matcher", icon: "analytics", label: "Resume Intelligence" },
    { id: "editor", icon: "auto_fix_high", label: "AI Editor" },
    { id: "jobs", icon: "work_outline", label: "Job Feed" },
    { id: "interview", icon: "record_voice_over", label: "Interview Prep" },
  ];
  return (
    <div style={{ width: 230, height: "100vh", position: "fixed", left: 0, top: 0, background: T.borderSoft, borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", padding: "16px 10px", zIndex: 100 }}>
      <div style={{ padding: "0 10px", marginBottom: 26 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: T.primary, display: "flex", alignItems: "center", justifyContent: "center" }}><Ic n="auto_awesome" sz={14} c="#fff" f={true} /></div>
          <div><div style={{ fontSize: 13, fontWeight: 700, color: T.primary }}>Career Catalyst</div><div style={{ fontSize: 8, fontWeight: 600, color: T.t3, textTransform: "uppercase", letterSpacing: ".08em" }}>AI Intelligence</div></div>
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, border: "none", cursor: "pointer", background: tab === t.id ? T.card : "transparent", color: tab === t.id ? T.primary : T.t2, fontWeight: 600, fontSize: 11.5, fontFamily: font, boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,.04)" : "none" }}>
            <Ic n={t.icon} sz={15} c={tab === t.id ? T.primary : T.t3} f={tab === t.id} />{t.label}
          </button>
        ))}
      </div>
      {name && <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 10, fontSize: 10.5, color: T.t3, paddingLeft: 10 }}><Ic n="person" sz={11} c={T.t3} s={{ marginRight: 4 }} />{name}</div>}
    </div>
  );
};

const TopBar = ({ data, onReset, onShare, shareStatus }) => (
  <div style={{ height: 46, borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 22px", background: "rgba(255,255,255,0.9)", backdropFilter: "blur(10px)", position: "sticky", top: 0, zIndex: 50 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{data.name}</span>
      <span style={{ color: T.t3, fontSize: 10 }}>·</span>
      <span style={{ fontSize: 11.5, color: T.t2 }}>{data.title}</span>
      {data.layoutType && <Pill c="primary">{data.layoutType}</Pill>}
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      {shareStatus === "copied" && <span style={{ fontSize: 10.5, color: T.ok, fontWeight: 600 }}>Link copied (same device)</span>}
      {shareStatus === "saving" && <span style={{ fontSize: 10.5, color: T.t3 }}>Saving…</span>}
      {shareStatus === "error" && <span style={{ fontSize: 10.5, color: T.err }}>Share failed</span>}
      <Btn v="ghost" icon="share" onClick={onShare} s={{ padding: "3px 9px", fontSize: 10 }} disabled={shareStatus === "saving"}>Share</Btn>
      <Pill c="ok">Parsed</Pill>
      <Btn v="ghost" icon="restart_alt" onClick={onReset} s={{ padding: "3px 9px", fontSize: 10 }}>New</Btn>
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════
//  MATCHER
// ═══════════════════════════════════════════════════════════
const Matcher = ({ data, match }) => {
  const [showEx, setShowEx] = useState(false);
  const [selEx, setSelEx] = useState(0);
  const [exported, setExported] = useState(null); // null | "popup" | "file"
  const ex = [
    { name: "Preserve Original", fid: "96%", mode: "preserve", desc: "Maintains format and spacing", keeps: ["Section order", "Font style", "Spacing", "Bullets"], warns: [] },
    { name: "Enhanced Original", fid: "92%", mode: "enhanced", desc: "Keeps layout, applies AI content", keeps: ["Section order", "Spacing", "Alignment"], warns: ["Decorative elements simplified"] },
    { name: "ATS Clean", fid: "74%", mode: "ats", desc: "Single-column for ATS", keeps: ["Section order", "Hierarchy"], warns: ["Layout normalized", "Fidelity reduced"] },
    { name: "Modern Polished", fid: "88%", mode: "modern", desc: "Clean template + AI content", keeps: ["Hierarchy", "Bullets"], warns: ["Template replaced"] },
  ];
  const avgC = data.sections?.length ? Math.round(data.sections.reduce((acc, s) => acc + (s.confidence ?? 90), 0) / data.sections.length) : 92;
  const handleExport = () => { const mode = downloadResume(data, match, ex[selEx].mode, new Set()); setExported(mode); setTimeout(() => setExported(null), 3000); };

  return (
    <div style={{ padding: 22, maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily: fontD, fontSize: 26, fontWeight: 400, color: T.text, margin: 0 }}>Resume Intelligence</h2>
          {match && <p style={{ fontSize: 12, color: T.t2, marginTop: 2 }}>Matched: <strong>{match.matchLevel}</strong></p>}
        </div>
        <Btn v="ghost" icon="download" onClick={() => setShowEx(!showEx)} s={{ fontSize: 10.5 }}>Export</Btn>
      </div>

      {showEx && (
        <Card s={{ marginBottom: 18 }} p={14}>
          <Lbl icon="picture_as_pdf">Export Options</Lbl>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
            {ex.map((m, i) => (
              <div key={i} onClick={() => setSelEx(i)} style={{ padding: 11, borderRadius: 9, border: `2px solid ${selEx === i ? T.primary : T.border}`, background: selEx === i ? T.primaryGhost : T.card, cursor: "pointer" }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: T.text, marginBottom: 2 }}>{m.name}</div>
                <div style={{ fontSize: 10, color: T.t2, marginBottom: 6, lineHeight: 1.4 }}>{m.desc}</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: T.t3 }}>FIDELITY: <span style={{ color: parseInt(m.fid, 10) >= 90 ? T.ok : T.warn }}>{m.fid}</span></div>
                {m.keeps.map((k, j) => <div key={j} style={{ fontSize: 9, color: T.t3, display: "flex", alignItems: "center", gap: 3, marginTop: 1 }}><Ic n="check" sz={9} c={T.ok} />{k}</div>)}
                {m.warns.map((w, j) => <div key={j} style={{ fontSize: 9, color: T.warn, display: "flex", alignItems: "center", gap: 3, marginTop: 2 }}><Ic n="info" sz={9} c={T.warn} />{w}</div>)}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
            <div style={{ fontSize: 11, color: T.t3 }}>
              {exported === "popup" ? <span style={{ color: T.ok, fontWeight: 600 }}>Resume opened — use Print → Save as PDF</span> : exported === "file" ? <span style={{ color: T.warn, fontWeight: 600 }}>Downloaded as HTML — open in browser then Print → Save as PDF</span> : `Selected: ${ex[selEx].name} · Fidelity ${ex[selEx].fid}`}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn v="ghost" onClick={() => { const w = window.open("", "_blank"); if (w) { w.document.open(); w.document.write(buildResumeHTML(data, match, ex[selEx].mode, new Set())); w.document.close(); } }} s={{ padding: "7px 14px", fontSize: 11 }} icon="visibility">Preview</Btn>
              <Btn onClick={handleExport} s={{ padding: "7px 18px", fontSize: 11 }} icon="download">Download PDF</Btn>
            </div>
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Card><Lbl icon="analytics">Match Score</Lbl>{match ? <div style={{ display: "flex", alignItems: "center", gap: 12 }}><Ring v={match.matchScore} /><div><div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{match.matchLevel}</div><div style={{ fontSize: 10.5, color: T.t2, marginTop: 2 }}>KW: {match.keywordScore}% · Sem: {match.semanticScore}%</div></div></div> : <p style={{ fontSize: 11.5, color: T.t3, fontStyle: "italic" }}>Add a JD for match scoring</p>}</Card>
            <Card><Lbl icon="verified">Parse Confidence</Lbl><div style={{ display: "flex", alignItems: "center", gap: 12 }}><Ring v={avgC} c={T.primary} /><div><div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>High</div><div style={{ fontSize: 10.5, color: T.t2, marginTop: 2 }}>{data.sections?.length || 0} sections</div></div></div></Card>
          </div>
          <Card><Lbl icon="view_agenda">Detected Structure</Lbl><div style={{ display: "flex", flexDirection: "column", gap: 5 }}>{(data.sections || []).map((sec, i) => <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", borderRadius: 7, background: T.borderSoft }}><div style={{ display: "flex", alignItems: "center", gap: 7, flex: 1 }}><Ic n={sec.status === "detected" ? "check_circle" : sec.status === "inferred" ? "psychology" : "auto_awesome"} sz={14} c={sec.status === "detected" ? T.ok : sec.status === "inferred" ? T.accent : T.primary} f={true} /><span style={{ fontSize: 11.5, fontWeight: 600, color: T.text }}>{sec.name}</span>{sec.note && <span style={{ fontSize: 9.5, color: T.t3 }}>— {sec.note}</span>}</div><div style={{ display: "flex", alignItems: "center", gap: 6 }}><Pill c={sec.status === "detected" ? "ok" : sec.status === "inferred" ? "accent" : "primary"}>{sec.status}</Pill><span style={{ fontSize: 10, fontWeight: 600, color: (sec.confidence || 90) >= 95 ? T.ok : T.primary }}>{sec.confidence || 90}%</span></div></div>)}</div></Card>
          <Card><Lbl icon="psychology">Skills Intelligence</Lbl>{[["CORE", data.coreSkills, "ok"], ["TRANSFERABLE", data.transferableSkills, "accent"], ["DOMAIN", data.domainSkills, "default"]].map(([label, items, color], gi) => items?.length > 0 && <div key={gi} style={{ marginBottom: 10 }}><div style={{ fontSize: 9, fontWeight: 700, color: T.t3, marginBottom: 4 }}>{label}</div><div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{items.map((sk, si) => <Pill key={si} c={color}>{sk}</Pill>)}</div></div>)}{match?.missingKeywords?.length > 0 && <div><div style={{ fontSize: 9, fontWeight: 700, color: T.err, marginBottom: 4 }}>MISSING FROM JD</div><div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{match.missingKeywords.map((sk, si) => <Pill key={si} c="err">{sk}</Pill>)}</div></div>}</Card>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {match?.semanticMatches?.length > 0 && <Card><Lbl icon="compare_arrows">Semantic Alignment</Lbl><div style={{ display: "flex", flexDirection: "column", gap: 5 }}>{match.semanticMatches.map((sm, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 7, background: T.borderSoft }}><div style={{ flex: 1, fontSize: 10.5, color: T.t2 }}><span style={{ fontWeight: 600, color: T.text }}>"{sm.resume}"</span></div><Ic n="arrow_forward" sz={11} c={T.t3} /><div style={{ flex: 1, fontSize: 10.5 }}><span style={{ fontWeight: 600, color: T.primary }}>"{sm.jd}"</span></div><Pill c={sm.score >= 90 ? "ok" : "primary"}>{sm.score}%</Pill></div>)}</div></Card>}
          <Card s={{ flex: 1 }}><Lbl icon="description">Parsed Content</Lbl><div style={{ background: T.borderSoft, borderRadius: 10, padding: 18, maxHeight: 550, overflowY: "auto" }}><div style={{ textAlign: "center", marginBottom: 14 }}><h3 style={{ fontSize: 15, fontWeight: 700, color: T.text, margin: 0 }}>{data.name?.toUpperCase()}</h3><p style={{ fontSize: 10, color: T.t2, marginTop: 2 }}>{[data.location, data.email, data.phone].filter(Boolean).join(" · ")}</p></div>{data.summary && <div style={{ marginBottom: 12 }}><div style={{ fontSize: 8.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: T.t3, borderBottom: `1px solid ${T.border}`, paddingBottom: 3, marginBottom: 5 }}>Summary</div><p style={{ fontSize: 10.5, color: T.t2, lineHeight: 1.6 }}>{data.summary}</p></div>}{(data.experience || []).map((exp, i) => <div key={i} style={{ marginBottom: 10 }}>{i === 0 && <div style={{ fontSize: 8.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: T.t3, borderBottom: `1px solid ${T.border}`, paddingBottom: 3, marginBottom: 5 }}>Experience</div>}<div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 11.5, fontWeight: 700, color: T.text }}>{exp.role}</span><span style={{ fontSize: 9, color: T.t3 }}>{exp.period}</span></div><div style={{ fontSize: 10, fontWeight: 600, color: T.primary, fontStyle: "italic", marginBottom: 4 }}>{exp.company}</div>{(exp.bullets || []).filter(b => !isAISuggestion(b)).map((b, j) => <div key={j} style={{ display: "flex", gap: 5, marginBottom: 2, fontSize: 10, color: T.t2, lineHeight: 1.6 }}><span style={{ color: T.t3, flexShrink: 0 }}>•</span><span>{b}</span></div>)}</div>)}</div></Card>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
//  EDITOR
// ═══════════════════════════════════════════════════════════
const Editor = ({ data, match }) => {
  const sug = match?.suggestions || [];
  const [applied, setApplied] = useState(new Set());
  const [dismissed, setDismissed] = useState(new Set());
  const [filter, setFilter] = useState("all");

  if (!sug.length) return <div style={{ padding: 60, textAlign: "center" }}><Ic n="edit_note" sz={48} c={T.t3} /><h3 style={{ fontFamily: fontD, fontSize: 24, color: T.text, marginTop: 14 }}>No suggestions</h3><p style={{ fontSize: 13, color: T.t2, marginTop: 6 }}>Add a job description to get AI edit suggestions.</p></div>;

  const cats = ["all", ...new Set(sug.map(s => s.category))];
  const vis = sug.filter(s => !dismissed.has(s.id) && (filter === "all" || s.category === filter));

  return (
    <div style={{ display: "flex", height: "calc(100vh - 46px)" }}>
      {/* Resume preview */}
      <div style={{ flex: 1, overflowY: "auto", padding: 22, background: T.borderSoft, borderRight: `1px solid ${T.border}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <Lbl icon="description">Resume — Live Preview</Lbl>
          <Btn v="ghost" icon="download" onClick={() => downloadResume(data, match, "enhanced", applied)} s={{ padding: "4px 12px", fontSize: 10 }}>Export with changes</Btn>
        </div>
        <Card p={22}>
          <div style={{ textAlign: "center", marginBottom: 16 }}><h3 style={{ fontSize: 15, fontWeight: 700, color: T.text, margin: 0 }}>{data.name?.toUpperCase()}</h3><p style={{ fontSize: 10, color: T.t2, marginTop: 2 }}>{[data.location, data.email].filter(Boolean).join(" · ")}</p></div>
          {(data.experience || []).map((exp, ei) => (
            <div key={ei} style={{ marginBottom: 14 }}>
              {ei === 0 && <div style={{ fontSize: 8.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: T.t3, borderBottom: `1px solid ${T.border}`, paddingBottom: 3, marginBottom: 7 }}>Experience</div>}
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{exp.role}</span><span style={{ fontSize: 9.5, color: T.t3 }}>{exp.period}</span></div>
              <div style={{ fontSize: 10, fontWeight: 600, color: T.primary, fontStyle: "italic", marginBottom: 6 }}>{exp.company}</div>
              {(exp.bullets || []).filter(b => !isAISuggestion(b)).map((b, j) => {
                const found = matchBullet(b, sug, applied);
                const isApplied = found && applied.has(found.id);
                return (
                  <div key={j} style={{ display: "flex", gap: 5, marginBottom: 4, fontSize: 10.5, lineHeight: 1.65, padding: "3px 8px", borderRadius: 5, background: isApplied ? T.okSoft : found && !dismissed.has(found.id) ? `${T.primary}08` : "transparent", borderLeft: isApplied ? `3px solid ${T.ok}` : found ? `3px solid ${T.primary}22` : "3px solid transparent", color: T.t2 }}>
                    <span style={{ color: T.t3, flexShrink: 0 }}>•</span>
                    <span>{isApplied ? found.improved : b}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </Card>
      </div>

      {/* Suggestions panel */}
      <div style={{ width: 380, overflowY: "auto", padding: 18, background: T.bg }}>
        <Lbl icon="auto_fix_high">Suggestions ({vis.length})</Lbl>
        <div style={{ display: "flex", gap: 3, marginBottom: 12, flexWrap: "wrap" }}>
          {cats.map(cat => <button key={cat} onClick={() => setFilter(cat)} style={{ padding: "3px 9px", borderRadius: 14, border: "none", background: filter === cat ? T.primary : T.borderSoft, color: filter === cat ? "#fff" : T.t2, fontSize: 9.5, fontWeight: 600, cursor: "pointer", fontFamily: font }}>{cat === "all" ? "All" : cat}</button>)}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {vis.map(sg => (
            <Card key={sg.id} p={12} s={{ borderLeft: `3px solid ${sg.impact === "High" ? T.primary : sg.impact === "Medium" ? T.accent : T.t3}`, opacity: applied.has(sg.id) ? 0.5 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}><Ic n={sg.icon || "edit"} sz={12} c={T.primary} /><span style={{ fontSize: 10, fontWeight: 700, color: T.primary }}>{sg.category}</span></div>
                <Pill c={sg.impact === "High" ? "err" : "default"}>{sg.impact}</Pill>
              </div>
              <div style={{ background: T.errSoft, borderRadius: 5, padding: "5px 9px", marginBottom: 5 }}><div style={{ fontSize: 8, fontWeight: 600, color: T.t3 }}>ORIGINAL</div><div style={{ fontSize: 10, color: T.t2, lineHeight: 1.5 }}>{sg.original}</div></div>
              <div style={{ background: T.okSoft, borderRadius: 5, padding: "5px 9px", marginBottom: 5 }}><div style={{ fontSize: 8, fontWeight: 600, color: T.t3 }}>IMPROVED</div><div style={{ fontSize: 10, color: T.text, lineHeight: 1.5, fontWeight: 500 }}>{sg.improved}</div></div>
              <div style={{ background: T.primaryGhost, borderRadius: 5, padding: "5px 9px", marginBottom: 7 }}><div style={{ fontSize: 8, fontWeight: 600, color: T.t3 }}>WHY</div><div style={{ fontSize: 10, color: T.t2, lineHeight: 1.5 }}>{sg.reason}</div></div>
              {sg.tags?.length > 0 && <div style={{ display: "flex", gap: 3, marginBottom: 6 }}>{sg.tags.map((t, ti) => <Pill key={ti}>{t}</Pill>)}</div>}
              <div style={{ display: "flex", gap: 5 }}>
                <Btn v={applied.has(sg.id) ? "ok" : "primary"} disabled={applied.has(sg.id)} onClick={() => setApplied(prev => new Set([...prev, sg.id]))} s={{ flex: 1, justifyContent: "center", padding: "5px 0", fontSize: 10 }}>{applied.has(sg.id) ? "✓ Applied" : "Apply"}</Btn>
                <Btn v="ghost" onClick={() => setDismissed(prev => new Set([...prev, sg.id]))} s={{ padding: "5px 11px", fontSize: 10 }}>Dismiss</Btn>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
//  JOBS — live listings with search, filter, pagination & AI Apply
// ═══════════════════════════════════════════════════════════
const Jobs = ({ jobs: initialJobs, resumeData, setTab }) => {
  const [jobs, setJobs] = useState(initialJobs || []);
  const [loading, setLoading] = useState(!initialJobs?.length);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | remote | recent
  const [page, setPage] = useState(0);
  const [applyJob, setApplyJob] = useState(null);
  const PAGE = 8;

  useEffect(() => { if (!initialJobs?.length) loadJobs(); }, []);
  useEffect(() => { setPage(0); }, [search, filter]);

  const loadJobs = async () => {
    setLoading(true); setError(null);
    try { setJobs(await fetchJobs(resumeData)); }
    catch (e) { setError(e.message); }
    setLoading(false);
  };

  const isRecent = d => d && (Date.now() - new Date(d).getTime()) < 14 * 86400000;

  const filtered = jobs.filter(j => {
    const q = search.toLowerCase();
    const textOk = !q || [j.title, j.company, ...(j.tags || [])].join(" ").toLowerCase().includes(q);
    const fOk = filter === "all" || (filter === "remote" && j.remote) || (filter === "recent" && isRecent(j.postedAt));
    return textOk && fOk;
  });

  const pages = Math.ceil(filtered.length / PAGE);
  const paged = filtered.slice(page * PAGE, (page + 1) * PAGE);

  if (loading) return (
    <div style={{ padding: 60, textAlign: "center" }}>
      <div style={{ display: "inline-block", width: 34, height: 34, border: `3px solid ${T.borderSoft}`, borderTopColor: T.primary, borderRadius: "50%", animation: "spin 1s linear infinite", marginBottom: 16 }} />
      <div style={{ fontSize: 13, fontWeight: 500, color: T.t2 }}>Searching live job listings…</div>
    </div>
  );

  if (error) return (
    <div style={{ padding: 60, textAlign: "center" }}>
      <Ic n="wifi_off" sz={44} c={T.t3} />
      <h3 style={{ fontFamily: fontD, fontSize: 22, color: T.text, marginTop: 14, marginBottom: 6 }}>Job search unavailable</h3>
      <p style={{ fontSize: 12.5, color: T.t2, maxWidth: 340, margin: "0 auto 18px" }}>{error}</p>
      <Btn onClick={loadJobs} icon="refresh">Retry</Btn>
    </div>
  );

  return (
    <div style={{ padding: 22, maxWidth: 920, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <h2 style={{ fontFamily: fontD, fontSize: 26, fontWeight: 400, color: T.text, margin: 0 }}>Live Job Listings</h2>
          <p style={{ fontSize: 12, color: T.t2, marginTop: 2 }}>{filtered.length} jobs · sorted by match · Remotive + Arbeitnow</p>
        </div>
        <Btn v="ghost" icon="refresh" onClick={loadJobs} s={{ fontSize: 10.5 }}>Refresh</Btn>
      </div>

      {/* Search + filter bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18, alignItems: "center" }}>
        <div style={{ flex: 1, position: "relative" }}>
          <Ic n="search" sz={14} c={T.t3} s={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search title, company, or skill…"
            style={{ width: "100%", padding: "8px 12px 8px 32px", border: `1px solid ${T.border}`, borderRadius: 8, fontFamily: font, fontSize: 12, color: T.text, background: T.card, outline: "none" }} />
        </div>
        {[["all", "All"], ["remote", "Remote only"], ["recent", "Last 2 weeks"]].map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: "7px 13px", borderRadius: 20, border: "none", background: filter === f ? T.primary : T.borderSoft, color: filter === f ? "#fff" : T.t2, fontFamily: font, fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>{label}</button>
        ))}
      </div>

      {!paged.length && (
        <div style={{ padding: "40px 0", textAlign: "center" }}>
          <Ic n="search_off" sz={36} c={T.t3} />
          <p style={{ fontSize: 13, color: T.t2, marginTop: 10 }}>
            No jobs match.{" "}
            <button onClick={() => { setSearch(""); setFilter("all"); }} style={{ background: "none", border: "none", color: T.primary, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: font }}>Clear filters</button>
          </p>
        </div>
      )}

      {/* Job cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        {paged.map(job => (
          <Card key={job.id} p={16}>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3, flexWrap: "wrap" }}>
                  <h3 style={{ fontSize: 13.5, fontWeight: 700, color: T.text, margin: 0 }}>{job.title}</h3>
                  {job.remote && <Pill c="ok">Remote</Pill>}
                  <Pill c="default">{job.source}</Pill>
                </div>
                <p style={{ fontSize: 11.5, color: T.t2, margin: "0 0 5px" }}>{job.company} · {job.location}</p>
                {job.salary && <p style={{ fontSize: 10.5, color: T.ok, fontWeight: 600, margin: "0 0 5px" }}>{job.salary}</p>}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 7 }}>
                  {(job.tags || []).slice(0, 5).map((t, i) => <Pill key={i}>{t}</Pill>)}
                </div>
                <p style={{ fontSize: 10.5, color: T.t2, lineHeight: 1.55, margin: 0 }}>
                  {(job.description || "").substring(0, 160)}{(job.description || "").length > 160 ? "…" : ""}
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
                <Ring v={job.matchScore || 50} sz={52} sw={3} c={(job.matchScore || 50) >= 75 ? T.ok : (job.matchScore || 50) >= 58 ? T.primary : T.warn} />
                <span style={{ fontSize: 8.5, fontWeight: 600, color: T.t3, textTransform: "uppercase", letterSpacing: ".05em" }}>Match</span>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 11, paddingTop: 10, borderTop: `1px solid ${T.borderSoft}` }}>
              <Btn v="ghost" icon="open_in_new" onClick={() => window.open(job.url, "_blank")} s={{ padding: "5px 13px", fontSize: 10.5 }}>View Job</Btn>
              <Btn icon="auto_awesome" onClick={() => setApplyJob(job)} s={{ padding: "5px 15px", fontSize: 10.5 }}>AI Apply</Btn>
            </div>
          </Card>
        ))}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 20 }}>
          <Btn v="ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)} icon="chevron_left" s={{ padding: "6px 14px" }}>Prev</Btn>
          <span style={{ fontSize: 12, color: T.t2 }}>Page {page + 1} of {pages}</span>
          <Btn v="ghost" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)} s={{ padding: "6px 14px" }}>Next <Ic n="chevron_right" sz={14} c={T.t2} /></Btn>
        </div>
      )}

      {applyJob && <ApplyModal job={applyJob} resumeData={resumeData} onClose={() => setApplyJob(null)} />}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
//  INTERVIEW
// ═══════════════════════════════════════════════════════════
const Interview = ({ data, match }) => {
  const qs = match?.interviewQuestions || [];
  const [sel, setSel] = useState(0);
  const catColors = { "Resume-Based": "primary", "JD-Based": "warn", "Behavioral": "accent", "Technical": "ok", "Gap Risk": "err" };
  const confColors = { "Strong": "ok", "Medium": "default", "Needs Prep": "err" };

  if (!qs.length) return <div style={{ padding: 60, textAlign: "center" }}><Ic n="record_voice_over" sz={48} c={T.t3} /><h3 style={{ fontFamily: fontD, fontSize: 24, color: T.text, marginTop: 14 }}>No questions</h3><p style={{ fontSize: 13, color: T.t2, marginTop: 6 }}>Add a JD for interview prep.</p></div>;

  const q = qs[sel] || qs[0];
  return (
    <div style={{ padding: 22, maxWidth: 1060, margin: "0 auto" }}>
      <h2 style={{ fontFamily: fontD, fontSize: 26, fontWeight: 400, color: T.text, margin: "0 0 4px 0" }}>Interview Preparation</h2>
      <p style={{ fontSize: 12, color: T.t2, marginBottom: 20 }}>From resume + JD analysis</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <Lbl icon="psychology">Questions ({qs.length})</Lbl>
          {qs.map((iq, i) => (
            <div key={i} onClick={() => setSel(i)} style={{ padding: "9px 11px", borderRadius: 8, background: sel === i ? T.primaryGhost : T.card, border: `1px solid ${sel === i ? T.primary + "30" : T.border}`, cursor: "pointer" }}>
              <div style={{ display: "flex", gap: 4, marginBottom: 3 }}><Pill c={catColors[iq.category] || "default"}>{iq.category}</Pill><Pill c={confColors[iq.confidence] || "default"}>{iq.confidence}</Pill></div>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.text, lineHeight: 1.45 }}>{iq.question}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          <Card p={18}>
            <div style={{ display: "flex", gap: 5, marginBottom: 9 }}><Pill c={catColors[q.category]}>{q.category}</Pill><Pill c={confColors[q.confidence]}>{q.confidence}</Pill></div>
            <h3 style={{ fontFamily: fontD, fontSize: 18, fontWeight: 400, color: T.text, lineHeight: 1.3, margin: "0 0 12px 0" }}>{q.question}</h3>
            <div style={{ background: T.primaryGhost, borderRadius: 7, padding: "8px 12px", marginBottom: 10 }}><div style={{ fontSize: 8.5, fontWeight: 600, color: T.t3, marginBottom: 2 }}>SOURCE</div><div style={{ fontSize: 11, color: T.t2 }}>{q.source}</div></div>
            {q.starHint && <div style={{ background: T.okSoft, borderRadius: 7, padding: "8px 12px", marginBottom: 10 }}><div style={{ fontSize: 8.5, fontWeight: 600, color: T.ok, marginBottom: 2 }}>STAR HINT</div><div style={{ fontSize: 11, color: T.t2, lineHeight: 1.5 }}>{q.starHint}</div></div>}
            {q.followUp && <div style={{ background: T.warnSoft, borderRadius: 7, padding: "8px 12px" }}><div style={{ fontSize: 8.5, fontWeight: 600, color: T.warn, marginBottom: 2 }}>FOLLOW-UP</div><div style={{ fontSize: 11, color: T.t2, lineHeight: 1.5 }}>{q.followUp}</div></div>}
          </Card>
          <Card><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><div><div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>Practice Mode</div><div style={{ fontSize: 10.5, color: T.t2, marginTop: 1 }}>Record and get feedback</div></div><Btn icon="mic">Record</Btn></div></Card>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
//  APP ROOT
// ═══════════════════════════════════════════════════════════
export default function App() {
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("matcher");
  const [shareStatus, setShareStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount: check URL hash for shared state
  useEffect(() => {
    let cancelled = false;
    const hash = window.location.hash.replace("#", "");
    if (hash && hash.startsWith("cc_")) {
      const data = loadShare(hash);
      if (data && !cancelled) { setState(data); setTab("matcher"); }
    }
    if (!cancelled) setLoading(false);
    return () => { cancelled = true; };
  }, []);

  const handleShare = async () => {
    if (!state) return;
    setShareStatus("saving");
    try {
      const id = saveShare(state);
      const url = window.location.origin + window.location.pathname + "#" + id;
      try { await navigator.clipboard.writeText(url); } catch { window.prompt("Copy this link (same-device only):", url); }
      window.history.replaceState(null, "", "#" + id);
      setShareStatus("copied");
      setTimeout(() => setShareStatus(null), 3000);
    } catch {
      setShareStatus("error");
      setTimeout(() => setShareStatus(null), 3000);
    }
  };

  if (loading) return null;

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      <style>{`*{box-sizing:border-box;margin:0}body{font-family:${font};background:${T.bg};color:${T.text};-webkit-font-smoothing:antialiased}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px}.mso{font-family:'Material Symbols Outlined';font-variation-settings:'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24;vertical-align:middle;font-style:normal;display:inline-block}textarea::placeholder{color:${T.t3}}@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {!state ? (
        <Upload onDone={r => { setState(r); setTab("matcher"); window.location.hash = ""; }} />
      ) : (
        <div style={{ display: "flex", minHeight: "100vh", background: T.bg }}>
          <Sidebar tab={tab} setTab={setTab} name={state.resumeData?.name} />
          <main style={{ marginLeft: 230, flex: 1, minHeight: "100vh" }}>
            <ProcBar />
            <TopBar data={state.resumeData} onReset={() => { setState(null); window.location.hash = ""; }} onShare={handleShare} shareStatus={shareStatus} />
            {tab === "matcher" && <Matcher data={state.resumeData} match={state.matchData} />}
            {tab === "editor" && <Editor data={state.resumeData} match={state.matchData} />}
            {tab === "jobs" && <Jobs jobs={state.jobFeed} resumeData={state.resumeData} setTab={setTab} />}
            {tab === "interview" && <Interview data={state.resumeData} match={state.matchData} />}
          </main>
        </div>
      )}
    </>
  );
}
