// Logika bersama untuk Vercel (folder /api) dan server lokal (server.js).
const fs = require("fs");
const path = require("path");

const API_ROOT = "https://api.emix.ai/api/v1";
const API = API_ROOT + "/client/tasks";
const MODEL = "suno/upload-and-cover-audio";
const ALLOWED = [
  "model", "uploadUrl", "title", "style", "duration", "instrumental", "lyrics", "prompt",
  "negativeTags", "vocalGender", "styleWeight", "weirdnessConstraint",
  "audioWeight", "variety", "personaId", "personaModel", "continueAt",
];

// Indeks key default yang saldonya habis atau tidak valid (diingat selama instance hidup)
const dead = new Set();

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
  return typeof k === "string" && /^[\w.\-]{8,200}$/.test(k);
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
  const k = req.headers["x-api-key"];
  return k ? String(k).trim() : "";
}

async function handleInfo(req, res) {
  send(res, 200, {
    code: 200,
    defaultKeys: getKeys().length,
    accessCodeRequired: Boolean(process.env.ACCESS_CODE),
  });
}

async function handleCreate(req, res) {
  if (req.method !== "POST") return send(res, 405, { code: 405, msg: "Gunakan POST" });
  let body;
  try { body = await readJson(req); } catch (e) { return send(res, 400, { code: 400, msg: "Body bukan JSON yang valid" }); }


  const workflow = body.workflow || "cover";
  if (!["generate", "cover", "extend"].includes(workflow)) return send(res, 422, { code: 422, msg: "Fitur tidak dikenal." });
  const ownKey = ownKeyFrom(req);
  if (!ownKey) return send(res, 401, { code: 401, msg: "Masukkan API key Emix sendiri." });
  if (!validKeyFormat(ownKey)) return send(res, 422, { code: 422, msg: "Format API key tidak valid" });
  const denied = checkAccess(req, Boolean(ownKey));
  if (denied) return send(res, 401, { code: 401, msg: denied });

  const input = {};
  for (const k of ALLOWED) {
    let v = body.input && body.input[k];
    // UI versi lama mengirim Lyrics dengan huruf besar; API terbaru memakai lyrics.
    if (k === "lyrics" && (v === undefined || v === null || v === "") && body.input) v = body.input.Lyrics;
    if (v !== undefined && v !== null && v !== "") input[k] = v;
  }
  if (workflow !== "generate" && !/^https?:\/\//i.test(input.uploadUrl || "")) {
    return send(res, 422, { code: 422, msg: "Link audio harus diawali http:// atau https://" });
  }
  const apiModel = workflow === "generate" ? "suno/generate" : workflow === "extend" ? "suno/upload-and-extend-audio" : MODEL;
  if (workflow === "extend" && (!Number.isFinite(Number(input.continueAt)) || Number(input.continueAt) < 0)) return send(res, 422, { code: 422, msg: "Posisi extend harus berupa detik yang valid." });
  if (workflow === "generate") delete input.uploadUrl;
  else delete input.duration; // Duration is only supported by music generation models, not cover/extend.
  const payload = { method: "POST", body: JSON.stringify({ model: apiModel, input }) };

  try {
    const json = await call(ownKey, API, payload);
    return send(res, 200, json);
  } catch (e) {
    return send(res, 500, { code: 500, msg: e.message || "Server error" });
  }
}



async function handleStatus(req, res) {
  if (req.method !== "GET") return send(res, 405, { code: 405, msg: "Gunakan GET" });
  const q = new URL(req.url, "http://localhost").searchParams;
  const id = q.get("taskId") || "";
  if (!/^[\w-]{6,100}$/.test(id)) return send(res, 422, { code: 422, msg: "taskId tidak valid" });

  const ownKey = ownKeyFrom(req);
  if (!ownKey) return send(res, 401, { code: 401, msg: "Masukkan API key Emix sendiri." });
  if (!validKeyFormat(ownKey)) return send(res, 422, { code: 422, msg: "Format API key tidak valid" });
  const denied = checkAccess(req, true);
  if (denied) return send(res, 401, { code: 401, msg: denied });
  const key = ownKey;
  try {
    // Endpoint status terpadu dari dokumentasi terbaru; endpoint jobs lama sebagai fallback.
    const t = encodeURIComponent(id);
    const candidates = [
      API + "?taskId=" + t,
      API + "/" + t,
      API_ROOT + "/jobs/recordInfo?taskId=" + t,
    ];
    let json = null;
    for (const url of candidates) {
      const candidate = await call(key, url, { method: "GET" });
      json = candidate;
      if (candidate.code === 200 && candidate.data) break;
      if (![404, 405, 400, 422].includes(candidate.code)) break;
    }
    return send(res, 200, json || { code: 502, msg: "Tidak ada respons status task dari Emix", source: "emix" });
  } catch (e) {
    return send(res, 500, { code: 500, msg: e.message || "Server error" });
  }
}

module.exports = { handleCreate, handleStatus, handleInfo, send };
