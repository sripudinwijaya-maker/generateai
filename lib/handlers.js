// Logika bersama untuk Vercel (folder /api) dan server lokal (server.js).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const API_ROOT = "https://api.emix.ai/api/v1";
const API = API_ROOT + "/client/tasks";
const MODEL = "suno/upload-and-cover-audio";
// Satu kode redeem untuk membuka akses Kling. Ganti nilai ini untuk membuat kode baru.
const KLING_REDEEM_CODE = "KLING-ACCESS-2026";
const ALLOWED = [
  "model", "customMode", "imageUrls", "videoUrls", "audioUrls", "uploadUrl", "title", "style", "duration", "instrumental", "lyrics", "prompt",
  "negativeTags", "vocalGender", "styleWeight", "weirdnessConstraint",
  "audioWeight", "variety", "personaId", "personaModel", "continueAt",
];

// Indeks key default yang saldonya habis atau tidak valid (diingat selama instance hidup)
const dead = new Set();

// Akun sederhana: USERNAME_PW, USERNAME_KEY_1, USERNAME_KEY_2, ...
// Juga mendukung USERNAME_APIKEY_1 / USERNAME_APIKEY_2 dan USERNAME_APIKEY.
// Setiap akun hanya boleh memakai key dengan prefix username-nya sendiri.
function normalizeUsername(value) {
  return String(value || "").trim().toUpperCase();
}
function findConfiguredUser(username) {
  const wanted = normalizeUsername(username);
  if (!/^[A-Z0-9][A-Z0-9_]{2,39}$/.test(wanted)) return null;
  const password = String(process.env[wanted + "_PW"] || process.env[wanted + "_PASSWORD"] || "");
  const keys = [];
  for (let i = 1; i <= 100; i++) {
    const key = String(process.env[wanted + "_KEY_" + i] || process.env[wanted + "_APIKEY_" + i] || "").trim();
    if (key) keys.push({ key, index: i });
  }
  // Optional single-key shorthand.
  if (!keys.length) {
    const key = String(process.env[wanted + "_APIKEY"] || process.env[wanted + "_KEY"] || "").trim();
    if (key) keys.push({ key, index: 1 });
  }
  if (!password || !keys.length) return null;
  return { username: wanted, password, name: wanted, keys };
}
function getUser(req) {
  const header = String((req.headers || {}).authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || !process.env.SESSION_SECRET) return null;
  const parts = match[1].split(".");
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(parts[0]).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(parts[1]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!data.u || !data.exp || data.exp < Date.now()) return null;
    return data.u;
  } catch (_) { return null; }
}
function makeToken(username) {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + 12 * 60 * 60 * 1000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("hex");
  return payload + "." + sig;
}
function userKeys(username) {
  const account = findConfiguredUser(username);
  return account ? account.keys : [];
}
function userKey(username) {
  const keys = userKeys(username);
  return keys.length ? keys[0].key : "";
}
function isKeyUnavailable(json) {
  const msg = String((json && (json.msg || json.message || json.error)) || "").toLowerCase();
  return json && (json.code === 401 || json.code === 402 || /insufficient credit|credit (is )?(exhausted|not enough)|quota exceeded|no balance|out of balance|saldo (habis|tidak cukup)|kredit (habis|tidak cukup)|limit exceeded/.test(msg));
}
async function handleLogin(req, res) {
  if (req.method !== "POST") return send(res, 405, { code: 405, msg: "Gunakan POST" });
  if (!process.env.SESSION_SECRET) return send(res, 500, { code: 500, msg: "SESSION_SECRET belum diatur di Environment Variables." });
  let body;
  try { body = await readJson(req); } catch (_) { return send(res, 400, { code: 400, msg: "Data login tidak valid." }); }
  const username = normalizeUsername(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[A-Z0-9][A-Z0-9_]{2,39}$/.test(username)) return send(res, 401, { code: 401, msg: "Username atau password salah." });
  const account = findConfiguredUser(username);
  if (!account || !account.password || !account.keys.length || password.length === 0) return send(res, 401, { code: 401, msg: "Akun belum didaftarkan atau username/password salah." });
  const a = Buffer.from(account.password), b = Buffer.from(password);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return send(res, 401, { code: 401, msg: "Username atau password salah." });
  return send(res, 200, { code: 200, token: makeToken(username), username, name: account.name });
}
function requireUser(req, res) {
  const username = getUser(req);
  if (!username) { send(res, 401, { code: 401, msg: "Sesi login berakhir. Silakan login lagi." }); return null; }
  if (!userKeys(username).length) { send(res, 403, { code: 403, msg: "API key untuk akun ini belum dikonfigurasi." }); return null; }
  return username;
}


function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

async function readJson(req) {
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
  }
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 100000) throw new Error("Body terlalu besar");
  }
  return JSON.parse(data || "{}");
}

// Daftar key default: env EMIX_API_KEYS (dipisah baris, koma, atau spasi), atau file keys.txt
function getKeys() {
  let raw = process.env.EMIX_API_KEYS || process.env.EMIX_API_KEY || "";
  if (!raw.trim()) {
    const candidates = [path.join(__dirname, "..", "keys.txt"), path.join(process.cwd(), "keys.txt")];
    for (const f of candidates) {
      try { raw = fs.readFileSync(f, "utf8"); if (raw.trim()) break; } catch (e) { raw = ""; }
    }
  }
  const keys = raw
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("#"))
    .join(",")
    .split(/[\s,]+/)
    .filter(Boolean);
  return Array.from(new Set(keys));
}

function validKeyFormat(k) {
  return typeof k === "string" && k.length >= 8 && k.length <= 500 && !/[\r\n\t ]/.test(k);
}
function getRequestKey(req) {
  const h = (req.headers || {});
  return String(h["x-api-key"] || "").trim();
}

async function call(key, url, options) {
  const r = await fetch(url, {
    ...options,
    headers: {
      ...(options && options.headers ? options.headers : {}),
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    json = { msg: text.slice(0, 500) || "Respons tidak valid dari Emix" };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    json = { msg: "Format respons tidak dikenali dari Emix" };
  }
  // Beberapa gateway mengirim HTTP 200 tetapi code error di JSON, dan sebaliknya.
  const bodyCode = Number(json.code);
  const code = (r.status === 401 || r.status === 402)
    ? r.status
    : (Number.isFinite(bodyCode) && bodyCode > 0 ? bodyCode : r.status);
  return {
    ...json,
    code,
    upstreamStatus: r.status,
    source: "emix",
  };
}

// Mengembalikan pesan error bila akses ditolak, atau null bila boleh lanjut
function checkAccess(req, usingOwnKey) {
  const need = process.env.ACCESS_CODE;
  if (!need || usingOwnKey) return null;
  return req.headers["x-access-code"] === need ? null : "Kode akses salah atau belum diisi.";
}

function ownKeyFrom(req) {
  const username = getUser(req);
  return username ? userKey(username) : "";
}

async function handleInfo(req, res) {
  send(res, 200, { code: 200, apiKeyMode: "manual" });
}

async function handleCreate(req, res) {
  if (req.method !== "POST") return send(res, 405, { code: 405, msg: "Gunakan POST" });
  let body;
  try { body = await readJson(req); } catch (e) { return send(res, 400, { code: 400, msg: "Body bukan JSON yang valid" }); }
  if (body.workflow === "kling" || (body.input && body.input.workflow === "kling")) return handleKlingCreate(req, res, body);
  const workflow = body.workflow || "cover";
  if (!["generate", "cover", "extend"].includes(workflow)) return send(res, 422, { code: 422, msg: "Fitur tidak dikenal." });
  const key = getRequestKey(req);
  if (!key) return send(res, 401, { code: 401, msg: "Masukkan API key Emix di kolom API key." });
  if (!validKeyFormat(key)) return send(res, 422, { code: 422, msg: "Format API key tidak valid." });
  const input = {};
  for (const k of ALLOWED) {
    let v = body.input && body.input[k];
    if (k === "lyrics" && (v === undefined || v === null || v === "") && body.input) v = body.input.Lyrics;
    if (v !== undefined && v !== null && v !== "") input[k] = v;
  }
  if (workflow !== "generate" && !/^https?:\/\//i.test(input.uploadUrl || "")) return send(res, 422, { code: 422, msg: "Link audio harus diawali http:// atau https://" });
  const apiModel = workflow === "generate" ? "suno/generate" : workflow === "extend" ? "suno/upload-and-extend-audio" : MODEL;
  if (workflow === "extend" && (!Number.isFinite(Number(input.continueAt)) || Number(input.continueAt) < 0)) return send(res, 422, { code: 422, msg: "Posisi extend harus berupa detik yang valid." });
  if (workflow === "generate") {
    delete input.uploadUrl;
    // Generate memakai mode kustom agar style/lirik/judul dari form diproses.
    input.customMode = true;
    // Jangan kirim URL kosong sebagai file referensi.
    for (const field of ["imageUrls", "videoUrls", "audioUrls"]) {
      if (!Array.isArray(input[field]) || input[field].every((url) => !String(url || "").trim())) delete input[field];
    }
    if (input.variety === "normal") input.variety = "1";
    if (input.title && input.title.length > 80) input.title = input.title.slice(0, 80);
  }
  try {
    // Generate Music memakai endpoint jobs/createTask sesuai dokumentasi Emix.
    // Fitur cover/extend tetap memakai endpoint lama yang sudah dipakai proyek.
    const createEndpoint = workflow === "generate" ? API_ROOT + "/jobs/createTask" : API;
    const json = await call(key, createEndpoint, { method: "POST", body: JSON.stringify({ model: apiModel, input }) });
    return send(res, 200, json);
  } catch (e) { return send(res, 500, { code: 500, msg: e.message || "Server error" }); }
}

async function handleKlingCreate(req, res, body) {
  const redeemCode = String(body.redeemCode || "").trim();
  if (redeemCode !== KLING_REDEEM_CODE) return send(res, 403, { code: 403, msg: "Kode redeem Kling salah atau belum diisi." });
  const key = getRequestKey(req);
  if (!key) return send(res, 401, { code: 401, msg: "Masukkan API key Emix di kolom API key." });
  if (!validKeyFormat(key)) return send(res, 422, { code: 422, msg: "Format API key tidak valid." });
  const raw = body.input || {};
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  const image = Array.isArray(raw.input_urls) ? raw.input_urls[0] : "";
  const video = Array.isArray(raw.video_urls) ? raw.video_urls[0] : "";
  const orientation = raw.character_orientation, mode = raw.mode;
  if (!/^https?:\/\//i.test(image || "")) return send(res, 422, { code: 422, msg: "URL gambar harus berupa link http:// atau https:// yang publik." });
  if (!/^https?:\/\//i.test(video || "")) return send(res, 422, { code: 422, msg: "URL video harus berupa link http:// atau https:// yang publik." });
  if (prompt.length > 2500) return send(res, 422, { code: 422, msg: "Prompt maksimal 2500 karakter." });
  if (!["image", "video"].includes(orientation)) return send(res, 422, { code: 422, msg: "Orientasi karakter tidak valid." });
  if (!["720p", "1080p"].includes(mode)) return send(res, 422, { code: 422, msg: "Resolusi harus 720p atau 1080p." });
  const payload = { method: "POST", body: JSON.stringify({ model: "kling/v2-6-motion-control", input: { prompt: prompt || "The character is dancing.", input_urls: [image], video_urls: [video], character_orientation: orientation, mode } }) };
  try { return send(res, 200, await call(key, API, payload)); }
  catch (e) { return send(res, 500, { code: 500, msg: e.message || "Server error" }); }
}

async function handleStatus(req, res) {
  if (req.method !== "GET") return send(res, 405, { code: 405, msg: "Gunakan GET" });
  const q = new URL(req.url, "http://localhost").searchParams;
  const id = q.get("taskId") || "";
  if (!/^[\w-]{6,100}$/.test(id)) return send(res, 422, { code: 422, msg: "taskId tidak valid" });
  const key = getRequestKey(req);
  if (!key) return send(res, 401, { code: 401, msg: "API key belum diisi." });
  if (!validKeyFormat(key)) return send(res, 422, { code: 422, msg: "Format API key tidak valid" });
  try {
    const t = encodeURIComponent(id);
    const candidates = [API + "?taskId=" + t, API + "/" + t, API_ROOT + "/jobs/recordInfo?taskId=" + t];
    let json = null;
    for (const url of candidates) {
      const candidate = await call(key, url, { method: "GET" }); json = candidate;
      if (candidate.code === 200 && candidate.data) break;
      if (![404, 405, 400, 422].includes(candidate.code)) break;
    }
    return send(res, 200, json || { code: 502, msg: "Tidak ada respons status task dari Emix", source: "emix" });
  } catch (e) { return send(res, 500, { code: 500, msg: e.message || "Server error" }); }
}

module.exports = { handleLogin, handleCreate, handleStatus, handleInfo, send };
