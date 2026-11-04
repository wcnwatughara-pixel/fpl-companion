export default async function handler(req, res) {
  const pathSegments = req.query.path || [];
  const fplPath = pathSegments.join("/");
  if (!fplPath) {
    res.setHeader("Content-Type", "text/plain");
    return res.status(200).send("FPL CORS Proxy running. Use /api/bootstrap-static/ to test.");
  }
  const targetUrl = "https://fantasy.premierleague.com/api/" + fplPath + "/";
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: { "User-Agent": "FPL-Companion/1.0", "Accept": "application/json" },
    });
    const contentType = response.headers.get("content-type") || "application/json";
    res.setHeader("Content-Type", contentType);
    if (response.ok) res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=60");
    const body = await response.text();
    return res.status(response.status).send(body);
  } catch (err) {
    return res.status(502).json({ error: "Failed to reach FPL API", detail: err.message });
  }
}
