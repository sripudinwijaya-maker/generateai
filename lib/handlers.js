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

  if (body.workflow === "kling" || (body.input && body.input.workflow === "kling")) return handleKlingCreate(req, res, body);

  const workflow = body.workflow || "cover";
  if (!["generate", "cover", "extend"].includes(workflow)) return send(res, 422, { code: 422, msg: "Fitur tidak dikenal." });
  const ownKey = ownKeyFrom(req);
  if (ownKey && !validKeyFormat(ownKey)) return send(res, 422, { code: 422, msg: "Format API key tidak valid" });
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
  const payload = { method: "POST", body: JSON.stringify({ model: apiModel, input }) };

  try {
    if (ownKey) {
      const json = await call(ownKey, API, payload);
      // Keep the app API response shape stable, but pass through Emix's actual code/message.
      return send(res, 200, json);
    }

    const keys = getKeys();
    if (!keys.length) {
      return send(res, 500, { code: 500, msg: "Belum ada API key default di server. Isi EMIX_API_KEYS atau keys.txt." });
    }
    let order = keys.map((_, i) => i).filter((i) => !dead.has(i));
    if (!order.length) { dead.clear(); order = keys.map((_, i) => i); }

    let lastFailure = null;
    const failureCodes = [];
    for (const i of order) {
      const json = await call(keys[i], API, payload);
      if (json.code === 402 || json.code === 401) {
        dead.add(i);
        lastFailure = json;
        failureCodes.push(json.code);
        continue; // Coba key berikutnya hanya untuk saldo habis atau autentikasi ditolak.
      }
      return send(res, 200, { ...json, keyIndex: i, keyCount: keys.length });
    }
    const onlyAuthFailures = failureCodes.length > 0 && failureCodes.every((code) => code === 401);
    return send(res, 200, {
      code: onlyAuthFailures ? 401 : 402,
      source: "emix",
      upstreamStatus: lastFailure ? lastFailure.upstreamStatus : null,
      msg: onlyAuthFailures
        ? "Semua API key default ditolak Emix (401). Periksa EMIX_API_KEYS di Vercel dan pastikan key masih aktif di dashboard Emix." + (lastFailure && lastFailure.msg ? " Detail Emix: " + String(lastFailure.msg).slice(0, 240) : "")
        : "Semua API key default kehabisan saldo atau tidak valid.",
    });
  } catch (e) {
    return send(res, 500, { code: 500, msg: e.message || "Server error" });
  }
}


async function handleKlingCreate(req, res, body) {
  const ownKey = ownKeyFrom(req);
  if (ownKey && !validKeyFormat(ownKey)) return send(res, 422, { code: 422, msg: "Format API key tidak valid" });
  const denied = checkAccess(req, Boolean(ownKey));
  if (denied) return send(res, 401, { code: 401, msg: denied });

  const raw = body.input || {};
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  const image = Array.isArray(raw.input_urls) ? raw.input_urls[0] : "";
  const video = Array.isArray(raw.video_urls) ? raw.video_urls[0] : "";
  const orientation = raw.character_orientation;
  const mode = raw.mode;
  if (!/^https?:\/\//i.test(image || "")) return send(res, 422, { code: 422, msg: "URL gambar harus berupa link http:// atau https:// yang publik." });
  if (!/^https?:\/\//i.test(video || "")) return send(res, 422, { code: 422, msg: "URL video harus berupa link http:// atau https:// yang publik." });
  if (prompt.length > 2500) return send(res, 422, { code: 422, msg: "Prompt maksimal 2500 karakter." });
  if (!["image", "video"].includes(orientation)) return send(res, 422, { code: 422, msg: "Orientasi karakter tidak valid." });
  if (!["720p", "1080p"].includes(mode)) return send(res, 422, { code: 422, msg: "Resolusi harus 720p atau 1080p." });

  const payload = { method: "POST", body: JSON.stringify({
    model: "kling/v2-6-motion-control",
    input: { prompt: prompt || "The character is dancing.", input_urls: [image], video_urls: [video], character_orientation: orientation, mode }
  }) };
  const url = API; // Kling 2.6 docs: POST /api/v1/client/tasks
  try {
    if (ownKey) return send(res, 200, await call(ownKey, url, payload));
    const keys = getKeys();
    if (!keys.length) return send(res, 200, { code: 500, msg: "Belum ada API key default di server. Isi EMIX_API_KEYS atau keys.txt." });
    let order = keys.map((_, i) => i).filter((i) => !dead.has(i));
    if (!order.length) { dead.clear(); order = keys.map((_, i) => i); }
    let lastFailure = null; const failureCodes = [];
    for (const i of order) {
      const json = await call(keys[i], url, payload);
      if (json.code === 402 || json.code === 401) { dead.add(i); lastFailure = json; failureCodes.push(json.code); continue; }
      return send(res, 200, { ...json, keyIndex: i, keyCount: keys.length });
    }
    const onlyAuthFailures = failureCodes.length > 0 && failureCodes.every((code) => code === 401);
    return send(res, 200, { code: onlyAuthFailures ? 401 : 402, source: "emix", upstreamStatus: lastFailure ? lastFailure.upstreamStatus : null,
      msg: onlyAuthFailures ? "Semua API key default ditolak Emix (401). Periksa EMIX_API_KEYS di Vercel dan pastikan key masih aktif di dashboard Emix." + (lastFailure && lastFailure.msg ? " Detail Emix: " + String(lastFailure.msg).slice(0, 240) : "") : "Semua API key default kehabisan saldo atau tidak valid." });
  } catch (e) { return send(res, 500, { code: 500, msg: e.message || "Server error" }); }
}

async function handleStatus(req, res) {
  if (req.method !== "GET") return send(res, 405, { code: 405, msg: "Gunakan GET" });
  const q = new URL(req.url, "http://localhost").searchParams;
  const id = q.get("taskId") || "";
  if (!/^[\w-]{6,100}$/.test(id)) return send(res, 422, { code: 422, msg: "taskId tidak valid" });

  const ownKey = ownKeyFrom(req);
  if (ownKey && !validKeyFormat(ownKey)) return send(res, 422, { code: 422, msg: "Format API key tidak valid" });
  const denied = checkAccess(req, Boolean(ownKey));
  if (denied) return send(res, 401, { code: 401, msg: denied });

  let key = ownKey;
  if (!key) {
    const keys = getKeys();
    const idx = Number(q.get("keyIndex"));
    key = Number.isInteger(idx) ? keys[idx] : undefined;
    if (!key) return send(res, 422, { code: 422, msg: "keyIndex tidak valid" });
  }
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
