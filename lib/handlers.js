// Logika bersama untuk Vercel (folder /api) dan server lokal (server.js).
// API key diisi manual di UI dan dikirim per request lewat header "x-api-key".
// Server tidak menyimpan key apa pun.
const API_ROOT = "https://api.emix.ai/api/v1";
const TASKS_API = API_ROOT + "/client/tasks";

const SUNO_MODELS = {
  generate: "suno/generate",
  cover: "suno/upload-and-cover-audio",
  extend: "suno/upload-and-extend-audio",
  addVocals: "suno/add-vocals",
  musicCover: "suno/cover-generate",
};
const SUNO_MODEL_NAMES = ["V6", "V6_MINI", "V6_WILD"];
const GENERATE_FIELDS = ["prompt", "lyrics", "style", "title", "instrumental", "customMode", "model", "negativeTags", "vocalGender", "styleWeight", "weirdnessConstraint", "audioWeight", "variety", "duration", "personaId", "personaModel", "imageUrls", "videoUrls", "audioUrls"];
const COVER_FIELDS = ["uploadUrl", "prompt", "lyrics", "style", "title", "instrumental", "model", "negativeTags", "vocalGender", "styleWeight", "weirdnessConstraint", "audioWeight", "variety", "personaId", "personaModel", "duration"];
const EXTEND_FIELDS = ["uploadUrl", "prompt", "lyrics", "style", "title", "continueAt", "instrumental", "model", "negativeTags", "vocalGender", "styleWeight", "weirdnessConstraint", "audioWeight", "variety", "personaId", "personaModel"];
const ADDVOCALS_FIELDS = ["uploadUrl", "prompt", "style", "title", "negativeTags", "vocalGender", "styleWeight", "weirdnessConstraint", "audioWeight", "model"];
const GENERATE_ONLY_FIELDS = ["title", "negativeTags", "duration", "vocalGender", "styleWeight", "weirdnessConstraint", "audioWeight", "variety"];

const ALLOWED = [
  "uploadUrl", "title", "style", "duration", "instrumental", "lyrics", "prompt", "model",
  "negativeTags", "vocalGender", "styleWeight", "weirdnessConstraint",
  "audioWeight", "variety", "personaId", "personaModel", "continueAt",
  "customMode", "audioId", "audioIds", "startTime", "endTime", "callBackUrl",
  "voiceId", "stylePrompt", "taskId", "audioUrl", "audioUrls", "imageUrls", "videoUrls",
];

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

function getApiKey(req) {
  return String((req.headers || {})["x-api-key"] || "").trim();
}

// Karakter yang diizinkan di API key: huruf, angka, dan simbol umum tanpa spasi.
function validKeyFormat(k) {
  return typeof k === "string" && /^[\x21-\x7e]{8,300}$/.test(k);
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
  } catch (_) {
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
    providerMessage: String(json.msg || json.message || json.error || "").slice(0, 600),
  };
}

// Validasi key yang sama untuk semua endpoint. Mengembalikan pesan error atau null.
function checkKey(key) {
  if (!key) return "API key belum dimasukkan.";
  if (!validKeyFormat(key)) return "Format API key tidak valid.";
  return null;
}

async function handleCreate(req, res) {
  if (req.method !== "POST") return send(res, 405, { code: 405, msg: "Gunakan POST" });
  let body;
  try { body = await readJson(req); } catch (_) { return send(res, 400, { code: 400, msg: "Body bukan JSON yang valid" }); }

  const key = getApiKey(req);
  const keyError = checkKey(key);
  if (keyError) return send(res, 401, { code: 401, msg: keyError });

  const workflow = body.workflow || "cover";
  if (workflow === "kling") return handleKlingCreate(res, body, key);
  if (!Object.prototype.hasOwnProperty.call(SUNO_MODELS, workflow)) {
    return send(res, 422, { code: 422, msg: "Fitur Suno tidak dikenal atau belum dipetakan." });
  }

  const raw = body.input || {};
  const input = {};
  for (const k of ALLOWED) {
    let v = raw[k];
    if (k === "lyrics" && (v === undefined || v === null || v === "")) v = raw.Lyrics;
    if (v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)) input[k] = v;
  }

  if (workflow === "generate") {
    for (const k of Object.keys(input)) if (!GENERATE_FIELDS.includes(k)) delete input[k];
    input.customMode = input.customMode === true || input.customMode === "true";
    input.instrumental = input.instrumental === true || input.instrumental === "true";
    if (!input.customMode) {
      // Non-custom: prompt adalah ide utama. Parameter khusus custom mode tidak boleh dikirim.
      const text = input.prompt || input.style || "";
      if (!text && !input.lyrics) return send(res, 422, { code: 422, msg: "Isi deskripsi lagu atau gaya musik." });
      if (text) input.prompt = text;
      delete input.style;
      for (const k of GENERATE_ONLY_FIELDS) delete input[k];
    } else {
      // Custom: lirik lewat field lyrics. Untuk instrumental, lirik diabaikan.
      if (input.instrumental) { delete input.lyrics; delete input.prompt; }
      else if (!input.lyrics && input.prompt) { input.lyrics = input.prompt; delete input.prompt; }
      else delete input.prompt;
      if (!input.style && !input.lyrics && !input.negativeTags) {
        return send(res, 422, { code: 422, msg: "Custom Mode butuh minimal gaya musik, lirik, atau negative tags." });
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
  } else if (workflow === "musicCover") {
    // Generate Music Cover: memakai ID task Suno yang sudah ada, bukan file audio.
    const taskId = String(raw.taskId || raw.audioId || "").trim();
    if (!/^[\w-]{6,100}$/.test(taskId)) return send(res, 422, { code: 422, msg: "Isi ID task lagu yang ingin dibuatkan cover." });
    for (const k of Object.keys(input)) delete input[k];
    input.taskId = taskId;
  } else {
    // Cover, Extend, dan Add Vocals wajib memakai uploadUrl (link audio publik).
    const sourceUrl = input.uploadUrl;
    if (!/^https?:\/\//i.test(sourceUrl || "")) {
      return send(res, 422, { code: 422, msg: "Fitur ini memerlukan link audio publik (uploadUrl)." });
    }
    if (workflow === "extend" && (!Number.isFinite(Number(input.continueAt)) || Number(input.continueAt) <= 0)) {
      return send(res, 422, { code: 422, msg: "Posisi extend harus lebih dari 0 detik." });
    }
    delete input.customMode;
    const allowed = workflow === "extend" ? EXTEND_FIELDS : workflow === "addVocals" ? ADDVOCALS_FIELDS : COVER_FIELDS;
    for (const k of Object.keys(input)) if (!allowed.includes(k)) delete input[k];
    if (allowed.includes("instrumental")) {
      input.instrumental = input.instrumental === true || input.instrumental === "true";
      if (input.instrumental) { delete input.lyrics; delete input.prompt; delete input.vocalGender; }
    }
    for (const k of ["styleWeight", "weirdnessConstraint", "audioWeight"]) {
      if (input[k] !== undefined) input[k] = Math.max(0, Math.min(1, Number(input[k])));
    }
    if (input.variety !== undefined) input.variety = Math.max(0, Math.min(4, Math.round(Number(input.variety))));
    const titleMax = workflow === "extend" ? 100 : 80;
    if (input.title && input.title.length > titleMax) return send(res, 422, { code: 422, msg: "Judul maksimal " + titleMax + " karakter." });
    if (input.style && input.style.length > 1000) return send(res, 422, { code: 422, msg: "Gaya musik maksimal 1000 karakter." });
    if (input.lyrics && input.lyrics.length > 5000) return send(res, 422, { code: 422, msg: "Lirik maksimal 5000 karakter." });
  }

  if (workflow !== "musicCover") {
    input.model = String(input.model || "V6").toUpperCase();
    if (!SUNO_MODEL_NAMES.includes(input.model)) input.model = "V6";
  }

  const payload = { method: "POST", body: JSON.stringify({ model: SUNO_MODELS[workflow], input }) };
  try {
    return send(res, 200, await call(key, TASKS_API, payload));
  } catch (e) {
    return send(res, 500, { code: 500, msg: e.message || "Server error" });
  }
}

async function handleKlingCreate(res, body, key) {
  const raw = body.input || {};
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  const image = Array.isArray(raw.input_urls) ? raw.input_urls[0] : "";
  const video = Array.isArray(raw.video_urls) ? raw.video_urls[0] : "";
  if (!/^https?:\/\//i.test(image || "")) return send(res, 422, { code: 422, msg: "URL gambar harus berupa link http:// atau https:// yang publik." });
  if (!/^https?:\/\//i.test(video || "")) return send(res, 422, { code: 422, msg: "URL video harus berupa link http:// atau https:// yang publik." });
  if (prompt.length > 2500) return send(res, 422, { code: 422, msg: "Prompt maksimal 2500 karakter." });
  if (!["image", "video"].includes(raw.character_orientation)) return send(res, 422, { code: 422, msg: "Orientasi karakter tidak valid." });
  if (!["720p", "1080p"].includes(raw.mode)) return send(res, 422, { code: 422, msg: "Resolusi harus 720p atau 1080p." });

  const payload = { method: "POST", body: JSON.stringify({
    model: "kling/v2-6-motion-control",
    input: { prompt: prompt || "The character is dancing.", input_urls: [image], video_urls: [video],
      character_orientation: raw.character_orientation, mode: raw.mode },
  }) };
  try {
    return send(res, 200, await call(key, TASKS_API, payload));
  } catch (e) {
    return send(res, 500, { code: 500, msg: e.message || "Server error" });
  }
}

async function handleStatus(req, res) {
  if (req.method !== "GET") return send(res, 405, { code: 405, msg: "Gunakan GET" });
  const key = getApiKey(req);
  const keyError = checkKey(key);
  if (keyError) return send(res, 401, { code: 401, msg: keyError });

  const id = new URL(req.url, "http://localhost").searchParams.get("taskId") || "";
  if (!/^[\w-]{6,100}$/.test(id)) return send(res, 422, { code: 422, msg: "taskId tidak valid" });
  try {
    const json = await call(key, TASKS_API + "?taskId=" + encodeURIComponent(id), { method: "GET" });
    return send(res, 200, json);
  } catch (e) {
    return send(res, 500, { code: 500, msg: e.message || "Server error" });
  }
}

module.exports = { handleCreate, handleStatus, send };
