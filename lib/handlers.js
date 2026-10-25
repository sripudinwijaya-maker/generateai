// Logika bersama untuk Vercel (folder /api) dan server lokal (server.js).
const fs = require("fs");
const path = require("path");
const API_ROOT = "https://api.emix.ai/api/v1";
const API = API_ROOT + "/client/tasks";
const MODEL = "suno/upload-and-cover-audio";
const MODEL_BY_WORKFLOW = {
  generate: "Suno/generate",
  cover: "suno/upload-and-cover-audio",
  extend: "suno/upload-and-extend-audio",
};
const ALLOWED_GENERATE = [
  "uploadUrl", "title", "style", "duration", "instrumental", "lyrics", "prompt", "model",
  "negativeTags", "vocalGender", "styleWeight", "weirdnessConstraint",
  "audioWeight", "variety", "personaId", "personaModel", "continueAt",
  "customMode", "audioId", "audioIds", "startTime", "endTime", "negativeTags", "callBackUrl",
  "voiceId", "stylePrompt", "taskId", "uploadUrl", "audioUrl", "audioUrls", "audioId", "audioIds", "personaId", "personaModel", "startTime", "endTime", "callBackUrl",
];
const ALLOWED = [
  "model", "uploadUrl", "title", "style", "duration", "instrumental", "lyrics", "prompt",
  "negativeTags", "vocalGender", "styleWeight", "weirdnessConstraint",
  "audioWeight", "variety", "personaId", "personaModel", "continueAt",
];


// Pesan error untuk Generate Music (teks asli).
function publicErrorGenerate(code) {
  if (code === 401) return "Sesi berakhir atau permintaan tidak dapat diproses. Silakan masuk kembali.";
  if (code === 402 || code === 403 || code === 429) return "Layanan sedang sibuk. Coba lagi beberapa saat.";
  if (code === 422) return "Permintaan tidak dapat diproses. Periksa isian lalu coba lagi.";
  return "Terjadi kendala saat memproses permintaan. Coba lagi nanti.";
}

function publicError(code) {
  if (code === 400) return "Parameter tidak valid. Periksa isian form lalu coba lagi.";
  if (code === 401) return "Sesi berakhir atau permintaan tidak dapat diproses. Silakan masuk kembali.";
  if (code === 402 || code === 403 || code === 429) return "Layanan sedang sibuk. Coba lagi beberapa saat.";
  if (code === 404) return "Sumber tidak ditemukan. Periksa link audio lalu coba lagi.";
  if (code === 422) return "Permintaan tidak dapat diproses. Periksa isian lalu coba lagi.";
  if (code === 500) return "Server bermasalah. Coba lagi nanti.";
  return "Terjadi kendala saat memproses permintaan (kode " + (Number(code) || "tidak diketahui") + "). Coba lagi nanti.";
}
function sanitizeResult(json, workflow) {
  if (!json || typeof json !== "object") return { code: 500, msg: publicError(500) };
  const code = Number(json.code || 0);
  const out = { ...json };
  delete out.providerMessage; delete out.source; delete out.upstreamStatus; delete out.creditsConsumed;
  if (code && code !== 200) { out.msg = workflow === "generate" ? publicErrorGenerate(code) : publicError(code); delete out.message; delete out.error; }
  if (out.data && typeof out.data === "object" && String(out.data.state || "").toLowerCase() === "fail") {
    const friendly = workflow === "generate" ? "Tugas tidak dapat diselesaikan. Coba lagi nanti." : friendlyFail(out.data.failCode, out.data.failMsg);
    out.data = { ...out.data, failMsg: friendly };
    delete out.data.failCode;
  }
  return out;
}

function friendlyFail(code, msg) {
  const m = String(msg || "").toLowerCase();
  const c = String(code || "");
  if (m.includes("file fetch failed") || (m.includes("fetch") && m.includes("file"))) {
    return "Layanan tidak bisa mengunduh audio dari link. Pastikan link publik dan langsung ke file audio (mp3/wav).";
  }
  if (/copyright|copyrighted/.test(m) || (c === "400" && m.includes("lyric"))) {
    return "Lirik terdeteksi mengandung materi berhak cipta. Ubah lirik lalu coba lagi.";
  }
  if (c === "413" || /conflict|matches existing/.test(m)) return "Audio sumber cocok dengan karya yang sudah ada. Coba audio lain.";
  if (c === "408") return "Layanan AI tidak merespons tepat waktu. Coba lagi nanti.";
  if (c === "531") return "Pembuatan gagal di sisi layanan. Kredit dikembalikan, silakan coba lagi.";
  return "Tugas tidak dapat diselesaikan. Coba lagi nanti.";
}

// Cek link audio sebelum dikirim ke provider: harus bisa dibuka dan bukan halaman web.
async function checkAudioUrl(url) {
  try {
    const r = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (r.body && typeof r.body.cancel === "function") r.body.cancel().catch(() => {});
    if (r.status >= 400) return "Link audio tidak bisa diakses (HTTP " + r.status + "). Pastikan link publik dan bisa dibuka langsung.";
    const type = String(r.headers.get("content-type") || "").toLowerCase();
    if (type.includes("text/html")) return "Link mengarah ke halaman web, bukan file audio. Gunakan link langsung ke file mp3/wav (misalnya link unduh langsung).";
    return null;
  } catch (e) {
    return "Link audio tidak bisa dibuka. Pastikan link publik dan benar.";
  }
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

// Kumpulan key: Vercel API_KEY_1, API_KEY_2, ... atau keys.txt lokal.
// Tidak pernah mengirim key ke browser/log. Key berikutnya dicoba jika key sebelumnya
// ditolak, kuotanya habis, atau terkena rate limit.
function getRequestKeys() {
  const keys = [];
  const add = (value) => {
    if (typeof value !== "string") return;
    const k = value.trim().replace(/^Bearer\s+/i, "").trim();
    if (k && !keys.includes(k)) keys.push(k);
  };

  // Legacy names tetap didukung.
  add(process.env.API_KEY);
  add(process.env.SUNO_API_KEY);

  // Sort numerically so API_KEY_2 comes after API_KEY_1 (not API_KEY_10).
  Object.keys(process.env)
    .map((name) => ({ name, match: name.match(/^API_KEY_(\d+)$/i) }))
    .filter((item) => item.match)
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]))
    .forEach(({ name }) => add(process.env[name]));

  try {
    const contents = fs.readFileSync(path.join(__dirname, "..", "keys.txt"), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const value = trimmed.replace(/^API_KEY(?:_\d+)?\s*=\s*/i, "").replace(/^Bearer\s+/i, "").trim();
      add(value.replace(/^("|')(.*)\1$/, "$2"));
    }
  } catch (_e) { /* keys.txt opsional pada hosting */ }

  return keys.filter(validKeyFormat);
}

function getRequestKey(_req) {
  return getRequestKeys()[0] || "";
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


async function callWithKeyFallback(keys, url, options) {
  if (!keys.length) throw new Error("API key belum ditemukan.");
  let result;
  for (let i = 0; i < keys.length; i++) {
    result = await call(keys[i], url, options);
    const status = Number(result.upstreamStatus || result.code || 0);
    const bodyCode = Number(result.code || 0);
    const shouldTryNext = [401, 402, 403, 429].includes(status) || [401, 402, 403, 429].includes(bodyCode);
    if (!shouldTryNext || i === keys.length - 1) return result;
  }
  return result;
}


function parseProvidedKeys(value) {
  const list = Array.isArray(value) ? value : (typeof value === "string" ? value.split(/[\r\n,;\s]+/) : []);
  const keys = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const key = item.trim().replace(/^API_KEY(?:_\d+)?\s*=\s*/i, "").replace(/^Bearer\s+/i, "").replace(/^(["'])(.*)\1$/, "$2");
    if (validKeyFormat(key) && !keys.includes(key)) keys.push(key);
  }
  return keys.slice(0, 200);
}

async function handleCreate(req, res) {
  if (req.method !== "POST") return send(res, 405, { code: 405, msg: "Gunakan POST" });
  let body;
  try { body = await readJson(req); } catch (e) { return send(res, 400, { code: 400, msg: "Body bukan JSON yang valid" }); }

  const keys = parseProvidedKeys(body.apiKeys || (req.headers && (req.headers["x-api-key"] || req.headers["X-API-Key"])));
  if (!keys.length) return send(res, 401, { code: 401, msg: "Masukkan API key atau upload file TXT terlebih dahulu." });

  const workflow = body.workflow || "cover";
  if (!Object.prototype.hasOwnProperty.call(MODEL_BY_WORKFLOW, workflow)) return send(res, 422, { code: 422, msg: "Fitur tidak dikenal atau belum tersedia." });
  const input = {};
  for (const k of (workflow === "generate" ? ALLOWED_GENERATE : ALLOWED)) {
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
  if (workflow === "extend" && (!Number.isFinite(Number(input.continueAt)) || Number(input.continueAt) <= 0)) return send(res, 422, { code: 422, msg: "Posisi extend harus lebih dari 0 detik dan lebih pendek dari durasi audio." });
  // Keep the selected model for endpoints that require it. The UI sends it,
  // so it must be included in ALLOWED and must not be silently discarded.
  input.model = String(input.model || "V6").toUpperCase();
  if (!["V6", "V6_MINI", "V6_WILD"].includes(input.model)) input.model = "V6";
  // Remove only UI-only fields; model is a real API parameter.
  delete input.workflow;
  if (workflow === "generate") delete input.uploadUrl;
  // Provider validates `variety` differently by endpoint:
  // Generate accepts numeric strings 0-4; upload-cover/extend accept
  // off|normal|high|extra|max. The UI currently sends numeric 1 for all workflows.
  if (workflow === "cover" || workflow === "extend") {
    // Dokumen OpenAPI terbaru: variety adalah integer 0–4 (default 1).
    if (input.variety !== undefined) input.variety = Math.max(0, Math.min(4, Math.round(Number(input.variety) || 1)));
  }
  if (workflow === "generate") {
    // Generate Music requires customMode, instrumental, and model.
    // customMode dibaca langsung dari input (tidak lewat ALLOWED) agar daftar ALLOWED tetap sama dengan konfigurasi.
    const rawCustomMode = body.input ? body.input.customMode : undefined;
    input.customMode = rawCustomMode === true || rawCustomMode === "true";
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
      for (const k of ["title", "style", "lyrics", "prompt", "negativeTags"]) {
        if (input[k] !== undefined && typeof input[k] !== "string") {
          return send(res, 422, { code: 422, msg: "Parameter " + k + " harus berupa teks." });
        }
      }
      if (input.title && input.title.length > 80) return send(res, 422, { code: 422, msg: "Judul maksimal 80 karakter." });
      if (input.style && input.style.length > 1000) return send(res, 422, { code: 422, msg: "Gaya musik maksimal 1000 karakter." });
      if (input.lyrics && input.lyrics.length > 5000) return send(res, 422, { code: 422, msg: "Lirik maksimal 5000 karakter." });
      if (input.prompt && input.prompt.length > 5000) return send(res, 422, { code: 422, msg: "Prompt/lirik maksimal 5000 karakter untuk model V6." });
      if (input.negativeTags && input.negativeTags.length > 1000) return send(res, 422, { code: 422, msg: "Negative tags maksimal 1000 karakter." });
      if (input.instrumental) {
        // Provider does not support audioWeight when generating without vocals.
        delete input.audioWeight;
        delete input.lyrics;
        delete input.prompt;
      }
      input.variety = Number.isFinite(Number(input.variety)) ? Math.max(0, Math.min(4, Math.round(Number(input.variety)))) : 1;
      for (const k of ["styleWeight", "weirdnessConstraint", "audioWeight"]) {
        if (input[k] !== undefined) {
          const n = Number(input[k]);
          if (!Number.isFinite(n)) return send(res, 422, { code: 422, msg: k + " harus berupa angka antara 0 dan 1." });
          input[k] = Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;
        }
      }
    }
  }
  const apiModel = MODEL_BY_WORKFLOW[workflow];
  if (workflow === "extend") {
    // Upload And Extend Audio: defaultParamFlag wajib. Dengan defaultParamFlag=true (mode custom),
    // continueAt, prompt, style, dan title dibutuhkan. Hanya field yang dikenal yang dikirim.
    const allowedExtendFields = ["model", "uploadUrl", "continueAt", "prompt", "style", "title", "instrumental", "negativeTags", "vocalGender", "styleWeight", "weirdnessConstraint", "audioWeight", "personaId"];
    const extendInput = {};
    for (const key of allowedExtendFields) if (input[key] !== undefined) extendInput[key] = input[key];
    extendInput.style = String(input.style || "").trim();
    if (!extendInput.style) return send(res, 422, { code: 422, msg: "Isi gaya musik untuk Upload Extend Cover." });
    extendInput.prompt = String(input.prompt || extendInput.style).trim();
    if (extendInput.prompt.length > 5000) return send(res, 422, { code: 422, msg: "Prompt maksimal 5000 karakter." });
    if (extendInput.style.length > 1000) return send(res, 422, { code: 422, msg: "Gaya musik maksimal 1000 karakter." });
    extendInput.title = String(input.title || "").trim().slice(0, 100) || "Extended Cover";
    extendInput.continueAt = Number(input.continueAt);
    extendInput.instrumental = input.instrumental === true || input.instrumental === "true";
    for (const key of ["styleWeight", "weirdnessConstraint", "audioWeight"]) {
      if (extendInput[key] !== undefined) {
        const n = Number(extendInput[key]);
        if (!Number.isFinite(n) || n < 0 || n > 1) return send(res, 422, { code: 422, msg: "Pengaturan gaya audio harus berupa angka 0–1." });
        extendInput[key] = Math.round(n * 100) / 100;
      }
    }
    for (const key of Object.keys(input)) delete input[key];
    Object.assign(input, extendInput);
  }
  if (workflow === "cover") {
    // Upload And Cover Audio has a dedicated endpoint and a stricter input schema.
    // Do not forward UI-only or endpoint-incompatible fields such as prompt/customMode.
    const allowedCoverFields = ["model", "uploadUrl", "title", "style", "duration", "instrumental", "lyrics", "negativeTags", "vocalGender", "styleWeight", "weirdnessConstraint", "audioWeight", "variety", "personaId", "personaModel"];
    for (const key of Object.keys(input)) if (!allowedCoverFields.includes(key)) delete input[key];
    if (input.title && input.title.length > 80) return send(res, 422, { code: 422, msg: "Judul maksimal 80 karakter." });
    if (input.style && input.style.length > 1000) return send(res, 422, { code: 422, msg: "Gaya musik maksimal 1000 karakter." });
    if (input.lyrics && input.lyrics.length > 5000) return send(res, 422, { code: 422, msg: "Lirik maksimal 5000 karakter." });
    const duration = Number(input.duration);
    if (!Number.isFinite(duration) || duration < 10 || duration > 360) return send(res, 422, { code: 422, msg: "Durasi cover harus antara 10 sampai 360 detik." });
    input.duration = Math.round(duration);
    for (const key of ["styleWeight", "weirdnessConstraint", "audioWeight"]) {
      if (input[key] !== undefined) {
        const n = Number(input[key]);
        if (!Number.isFinite(n) || n < 0 || n > 1 || Math.round(n * 100) !== n * 100) return send(res, 422, { code: 422, msg: "Pengaturan gaya audio harus berupa angka 0–1 dengan maksimal 2 desimal." });
        input[key] = n;
      }
    }
  }
  if (workflow === "cover" || workflow === "extend") {
    const problem = await checkAudioUrl(input.uploadUrl);
    if (problem) return send(res, 422, { code: 422, msg: problem });
  }
  const payload = { method: "POST", body: JSON.stringify({ model: apiModel, input }) };
  // Dokumen OpenAPI (Upload And Cover Audio): POST /client/tasks, sama dengan Generate.
  const endpoint = API;

  try {
    const json = await callWithKeyFallback(keys, endpoint, payload);
    logUpstreamError("create:" + workflow, json, keys);
    const result = sanitizeResult(json, workflow);
    // 401 pada cover/extend biasanya berarti key belum punya akses ke model tersebut
    // (Model Access Restriction di dashboard), sementara Generate tetap berjalan.
    if ((workflow === "cover" || workflow === "extend") && Number(result.code) === 401) {
      const label = workflow === "cover" ? "Upload Cover Audio" : "Upload Extend Cover";
      result.msg = "Akses untuk fitur " + label + " belum tersedia untuk key ini. Coba lagi nanti atau hubungi admin.";
    }
    return send(res, 200, result);
  } catch (e) {
    console.error("[create:" + workflow + "] exception:", redact(String(e && e.message), keys));
    return send(res, 500, { code: 500, msg: publicError(500) });
  }
}

// Catat penyebab error dari provider di log server (Vercel/terminal). Pesan UI tetap umum.
function redact(text, keys) {
  let out = String(text || "");
  for (const k of keys || []) if (k) out = out.split(k).join("***");
  return out.replace(/Bearer\s+\S+/gi, "Bearer ***");
}
function logUpstreamError(label, json, keys) {
  const code = Number(json && json.code);
  if (code === 200) return;
  console.error("[" + label + "] upstream status=" + (json && json.upstreamStatus) + " code=" + code +
    " msg=" + redact(String((json && json.providerMessage) || ""), keys).slice(0, 400));
}


async function handleStatus(req, res) {
  let body = {};
  if (req.method === "POST") {
    try { body = await readJson(req); } catch (_) { return send(res, 400, { code: 400, msg: "Body bukan JSON yang valid." }); }
  } else if (req.method === "GET") {
    // The current browser client polls status with GET query parameters.
    const query = new URL(req.url || "/", "http://localhost").searchParams;
    body.taskId = query.get("taskId") || "";
    body.workflow = query.get("workflow") || "";
  } else {
    return send(res, 405, { code: 405, msg: "Gunakan GET atau POST" });
  }
  const headerKey = req.headers && (req.headers["x-api-key"] || req.headers["X-API-Key"]);
  const keys = parseProvidedKeys(body.apiKeys || headerKey);
  if (!keys.length) return send(res, 401, { code: 401, msg: "Masukkan API key atau upload file TXT terlebih dahulu." });
  const id = String(body.taskId || "");
  if (!/^[\w-]{6,100}$/.test(id)) return send(res, 422, { code: 422, msg: "taskId tidak valid" });

  try {
    // Cover/Extend tasks use recordInfo; Generate uses client/tasks.
    const t = encodeURIComponent(id);
    const workflow = String(body.workflow || "");
    // Status semua workflow lewat /client/tasks/{id}, sama seperti Generate.
    const statusUrl = API + "/" + t;
    const json = await callWithKeyFallback(keys, statusUrl, { method: "GET" });
    logUpstreamError("status:" + workflow, json, keys);
    return send(res, 200, sanitizeResult(json || { code: 502, msg: "Tidak ada respons status task", source: "provider" }, workflow));
  } catch (e) {
    return send(res, 500, { code: 500, msg: publicError(500) });
  }
}

module.exports = { handleCreate, handleStatus, send };
