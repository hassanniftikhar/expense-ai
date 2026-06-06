import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { parseExpenseText } from "./api/parse-shared.js";

const root = new URL(".", import.meta.url).pathname;
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function handleParse(req, res) {
  try {
    const result = await parseExpenseText(await parseBody(req));
    res.writeHead(result.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result.body));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: error.message }));
  }
}

function handleConfig(_req, res) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      supabaseUrl: process.env.SUPABASE_URL || "",
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
      currency: "PKR"
    }));
}

createServer(async (req, res) => {
  if (req.url === "/api/parse" && req.method === "POST") {
    await handleParse(req, res);
    return;
  }
  if (req.url === "/api/config" && req.method === "GET") {
    handleConfig(req, res);
    return;
  }

  const urlPath = new URL(req.url, `http://localhost:${port}`).pathname;
  const requested = normalize(urlPath === "/" ? "index.html" : urlPath.slice(1));
  const filePath = join(root, requested.startsWith("public/") ? requested : requested);

  try {
    const file = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mime[extname(filePath)] || "application/octet-stream" });
    res.end(file);
  } catch {
    const file = await readFile(join(root, "index.html"));
    res.writeHead(200, { "Content-Type": mime[".html"] });
    res.end(file);
  }
}).listen(port, host, () => {
  console.log(`Expense AI running at http://${host}:${port}`);
});
