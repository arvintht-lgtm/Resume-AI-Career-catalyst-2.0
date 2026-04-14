// api/jobs.js — Vercel serverless function
// Aggregates live job listings from free public APIs (no auth required).
// POST body: { query: string, skills?: string[] }
// Returns: { jobs: NormalizedJob[], total: number }

const REMOTIVE_URL = "https://remotive.com/api/remote-jobs";
const ARBEITNOW_URL = "https://arbeitnow.com/api/job-board-api";

function stripHtml(html) {
  return (html || "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#39;/g, "'").replace(/&[a-zA-Z#0-9]+;/g, " ")
    .replace(/\s+/g, " ").trim();
}

function scoreJob(queryTokens, job) {
  const haystack = [job.title, ...(job.tags || [])].join(" ").toLowerCase();
  const hits = queryTokens.filter(t => t.length > 2 && haystack.includes(t)).length;
  return Math.min(97, 40 + Math.round((hits / Math.max(queryTokens.length, 1)) * 57));
}

async function fetchWithTimeout(url, options = {}, ms = 9000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { ...options, signal: ac.signal });
    clearTimeout(timer);
    return r;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  const { query = "", skills = [] } = req.body || {};
  if (!query && !skills.length) return res.status(400).json({ error: "query required" });

  const term = encodeURIComponent(String(query).substring(0, 100));
  const queryTokens = [
    ...String(query).toLowerCase().split(/\s+/),
    ...skills.map(s => String(s).toLowerCase()),
  ].filter(Boolean);

  const jobs = [];

  // ── Source 1: Remotive — remote-first tech jobs, free, no auth ──
  try {
    const r = await fetchWithTimeout(
      `${REMOTIVE_URL}?search=${term}&limit=20`,
      { headers: { "User-Agent": "CareerCatalyst/1.0" } }
    );
    if (r.ok) {
      const d = await r.json();
      for (const j of (d.jobs || []).slice(0, 20)) {
        jobs.push({
          id: `rem_${j.id}`,
          title: j.title || "",
          company: j.company_name || "",
          companyLogo: j.company_logo || null,
          location: j.candidate_required_location || "Remote",
          remote: true,
          url: j.url || "",
          description: stripHtml(j.description || "").substring(0, 500),
          tags: (j.tags || []).slice(0, 8),
          salary: j.salary || null,
          source: "Remotive",
          postedAt: j.publication_date || null,
        });
      }
    }
  } catch (e) {
    console.error("[jobs] Remotive:", e.message);
  }

  // ── Source 2: Arbeitnow — broader tech jobs, free, no auth ──
  try {
    const r = await fetchWithTimeout(
      `${ARBEITNOW_URL}?search=${term}&page=1`,
      { headers: { "User-Agent": "CareerCatalyst/1.0" } }
    );
    if (r.ok) {
      const d = await r.json();
      for (const j of (d.data || []).slice(0, 20)) {
        jobs.push({
          id: `arb_${j.slug}`,
          title: j.title || "",
          company: j.company_name || "",
          companyLogo: null,
          location: j.location || "Remote",
          remote: j.remote || false,
          url: j.url || "",
          description: stripHtml(j.description || "").substring(0, 500),
          tags: (j.tags || []).slice(0, 8),
          salary: null,
          source: "Arbeitnow",
          postedAt: j.created_at || null,
        });
      }
    }
  } catch (e) {
    console.error("[jobs] Arbeitnow:", e.message);
  }

  // ── Deduplicate by normalised title+company ──
  const seen = new Set();
  const unique = jobs.filter(j => {
    const key = `${j.title}|${j.company}`.toLowerCase().replace(/\s+/g, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // ── Score and sort by relevance ──
  const scored = unique
    .map(j => ({ ...j, matchScore: scoreJob(queryTokens, j) }))
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 30);

  // Cache for 5 minutes on Vercel CDN to reduce upstream API hits
  res.setHeader("Cache-Control", "public, s-maxage=300");
  return res.status(200).json({ jobs: scored, total: scored.length });
};
