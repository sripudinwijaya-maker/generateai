// Server lokal (Node 18+, tanpa dependensi). Di Vercel file ini tidak dipakai,
// yang jalan adalah fungsi di folder /api.
const http = require("http");
const fs = require("fs");
const path = require("path");

// Baca .env sederhana (KEY=VALUE per baris)
try {
  fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
} catch (e) { /* .env opsional */ }

const { handleCreate, handleStatus, handleInfo, send } = require("./lib/handlers");
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  const p = new URL(req.url, "http://localhost").pathname;
  if (req.method === "GET" && (p === "/" || p === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(path.join(__dirname, "public", "index.html")).pipe(res);
  }
  if (p === "/api/create") return handleCreate(req, res);
  if (p === "/api/status") return handleStatus(req, res);
  if (p === "/api/info") return handleInfo(req, res);
  send(res, 404, { code: 404, msg: "Tidak ditemukan" });
}).listen(PORT, () => console.log("Jalan di http://localhost:" + PORT));
