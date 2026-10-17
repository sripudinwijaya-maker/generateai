// Logika bersama untuk Vercel (folder /api) dan server lokal (server.js).
const API_ROOT = "https://api.emix.ai/api/v1";
const API = API_ROOT + "/client/tasks";
const KLING_API = API;
const MODEL = "suno/upload-and-cover-audio";
const SUNO_MODELS = {
  generate: "suno/generate",
  cover: "suno/upload-and-cover-audio",
  extend: "suno/upload-and-extend-audio",
};
const ALLOWED = [
  "uploadUrl", "title", "style", "duration", "instrumental", "lyrics", "prompt", "model",
  "negativeTags", "vocalGender", "styleWeight", "weirdnessConstraint",
  "audioWeight", "variety", "personaId", "personaModel", "continueAt",
  "customMode", "audioId", "audioIds", "startTime", "endTime", "negativeTags", "callBackUrl",
  "voiceId", "stylePrompt", "taskId", "uploadUrl", "audioUrl", "audioUrls", "audioId", "audioIds", "personaId", "personaModel", "startTime", "endTime", "callBackUrl",
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

// API key dimasukkan pengguna melalui header X-API-Key; tidak disimpan di server.
function getRequestKey(req) {
  const raw = req.headers && (req.headers["x-api-key"] || req.headers["X-API-Key"]);
  if (typeof raw !== "string") return "";
  // Accept either a raw API key or a pasted "Bearer <key>" value.
  return raw.trim().replace(/^Bearer\s+/i, "").trim();
}

function validKeyFormat(k) {
  return typeof k === "string" && /^[^\s]{8,512}$/.test(k);
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
    json = { msg: text.slice(0, 500) || "Respons tidak valid dari provider" };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    json = { msg: "Format respons tidak dikenali dari provider" };
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
    source: "provider",
    // Keep a compact provider diagnostic so the UI can show the actual missing-field message.
    providerMessage: String(json.msg || json.message || json.error || "").slice(0, 600),
  };
}


async function handleCreate(req, res) {
  if (req.method !== "POST") return send(res, 405, { code: 405, msg: "Gunakan POST" });
  let body;
  try { body = await readJson(req); } catch (e) { return send(res, 400, { code: 400, msg: "Body bukan JSON yang valid" }); }

  if (body.workflow === "kling" || (body.input && body.input.workflow === "kling")) return handleKlingCreate(req, res, body);

  const workflow = body.workflow || "cover";
  if (!Object.prototype.hasOwnProperty.call(SUNO_MODELS, workflow)) return send(res, 422, { code: 422, msg: "Fitur Suno tidak dikenal atau belum dipetakan." });
  const key = getRequestKey(req);
  if (!key) return send(res, 400, { code: 400, msg: "Masukkan API key milik Emix pada kolom API Key. Endpoint resmi Emix Market: https://api.emix.ai/api/v1/client/tasks." });
  if (!validKeyFormat(key)) return send(res, 422, { code: 422, msg: "Format API key tidak valid." });
  const input = {};
  for (const k of ALLOWED) {
    let v = body.input && body.input[k];
    // Dokumentasi Upload and Cover Audio memakai field Lyrics dengan huruf besar.
    if (k === "lyrics" && (v === undefined || v === null || v === "") && body.input) v = body.input.Lyrics;
    if (v !== undefined && v !== null && v !== "") input[k] = v;
  }
  const urlWorkflows = ["cover", "extend"];
  const sourceUrl = input.uploadUrl || input.audioUrl || (Array.isArray(input.audioUrls) ? input.audioUrls[0] : "");
  const hasPublicUrl = /^https?:\/\//i.test(sourceUrl || "");
  if (urlWorkflows.includes(workflow) && !hasPublicUrl) {
    return send(res, 422, { code: 422, msg: "Fitur ini memerlukan URL audio publik." });
  }
  if (workflow === "extend" && (!Number.isFinite(Number(input.continueAt)) || Number(input.continueAt) < 0)) return send(res, 422, { code: 422, msg: "Posisi extend harus berupa detik yang valid." });
  // Keep the selected Suno model for endpoints that require it. The UI sends it,
  // so it must be included in ALLOWED and must not be silently discarded.
  input.model = String(input.model || "V6").toUpperCase();
  if (!["V6", "V6_MINI", "V6_WILD"].includes(input.model)) input.model = "V6";
  // Remove only UI-only fields; model is a real API parameter.
  delete input.workflow;
  if (workflow === "generate") delete input.uploadUrl;
  // Emix validates `variety` differently by endpoint:
  // Generate accepts numeric strings 0-4; upload-cover/extend accept
  // off|normal|high|extra|max. The UI currently sends numeric 1 for all workflows.
  if (workflow === "cover" || workflow === "extend") {
    const varietyMap = { "0": "off", "1": "normal", "2": "high", "3": "extra", "4": "max" };
    if (input.variety !== undefined) {
      const rawVariety = String(input.variety).toLowerCase();
      input.variety = ["off", "normal", "high", "extra", "max"].includes(rawVariety)
        ? rawVariety
        : (varietyMap[rawVariety] || "normal");
    }
  }
  if (workflow === "generate") {
    // Generate Music requires customMode, instrumental, and model.
    input.customMode = input.customMode === true || input.customMode === "true";
    input.instrumental = input.instrumental === true || input.instrumental === "true";
    if (!input.customMode) {
      // Non-custom mode accepts prompt plus optional attachments/style/lyrics.
      delete input.title; delete input.negativeTags; delete input.duration;
      delete input.vocalGender; delete input.styleWeight; delete input.weirdnessConstraint;
      delete input.audioWeight; delete input.variety;
      if (!input.prompt && !input.style && !input.lyrics && !input.audioUrls && !input.imageUrls && !input.videoUrls) {
        return send(res, 422, { code: 422, msg: "Isi prompt, gaya musik, lirik, atau URL media untuk Generate Music." });
      }
    } else {
      if (!input.style && !input.lyrics && !input.prompt && !input.negativeTags) {
        return send(res, 422, { code: 422, msg: "Custom Mode membutuhkan minimal gaya musik, lirik, atau negative tags." });
      }
      if (input.title && input.title.length > 80) return send(res, 422, { code: 422, msg: "Judul maksimal 80 karakter." });
      if (input.style && input.style.length > 1000) return send(res, 422, { code: 422, msg: "Gaya musik maksimal 1000 karakter." });
      if (input.lyrics && input.lyrics.length > 5000) return send(res, 422, { code: 422, msg: "Lirik maksimal 5000 karakter." });
      if (input.negativeTags && input.negativeTags.length > 1000) return send(res, 422, { code: 422, msg: "Negative tags maksimal 1000 karakter." });
      input.variety = Number.isFinite(Number(input.variety)) ? Math.max(0, Math.min(4, Math.round(Number(input.variety)))) : 1;
      for (const k of ["styleWeight", "weirdnessConstraint", "audioWeight"]) {
        if (input[k] !== undefined) input[k] = Math.max(0, Math.min(1, Number(input[k])));
      }
    }
  }
  const apiModel = SUNO_MODELS[workflow];
  if (workflow === "cover" && input.lyrics !== undefined) { input.Lyrics = input.lyrics; delete input.lyrics; }
  const payload = { method: "POST", body: JSON.stringify({ model: apiModel, input }) };

  try {
    const json = await call(key, API, payload);
    return send(res, 200, json);
  } catch (e) {
    return send(res, 500, { code: 500, msg: e.message || "Server error" });
  }
}


async function handleKlingCreate(req, res, body) {
  const key = getRequestKey(req);
  if (!key) return send(res, 400, { code: 400, msg: "Masukkan API key milik Anda pada kolom API Key." });
  if (!validKeyFormat(key)) return send(res, 422, { code: 422, msg: "Format API key tidak valid." });

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
  const url = KLING_API; // Kling 2.6 docs: POST /api/v1/client/tasks
  try {
    const json = await call(key, url, payload);
    return send(res, 200, json);
  } catch (e) { return send(res, 500, { code: 500, msg: e.message || "Server error" }); }
}

async function handleStatus(req, res) {
  if (req.method !== "GET") return send(res, 405, { code: 405, msg: "Gunakan GET" });
  const q = new URL(req.url, "http://localhost").searchParams;
  const id = q.get("taskId") || "";
  if (!/^[\w-]{6,100}$/.test(id)) return send(res, 422, { code: 422, msg: "taskId tidak valid" });

  const key = getRequestKey(req);
  if (!key) return send(res, 400, { code: 400, msg: "API key tidak ditemukan. Isi API key Emix lalu mulai ulang." });
  if (!validKeyFormat(key)) return send(res, 422, { code: 422, msg: "Format API key tidak valid." });

  try {
    // EMIX client/tasks requires pagination even when filtering by taskId.
    const pageSize = Math.min(100, Math.max(1, Number(q.get("pageSize")) || 50));
    const pageNum = Math.max(1, Number(q.get("pageNum")) || 1);
    const params = new URLSearchParams({ pageSize: String(pageSize), pageNum: String(pageNum), taskId: id });
    const json = await call(key, API + "?" + params.toString(), { method: "GET" });
    return send(res, 200, json || { code: 502, msg: "Tidak ada respons status task dari provider", source: "provider" });
  } catch (e) {
    return send(res, 500, { code: 500, msg: e.message || "Server error" });
  }
}

module.exports = { handleCreate, handleStatus, send };
