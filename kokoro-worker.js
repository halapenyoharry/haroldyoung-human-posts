// kokoro-worker.js — Web Worker for Kokoro TTS
// Loads model from HuggingFace, generates audio blobs
// Communicates via postMessage: {action, text, voice} → {status, ...}

import { KokoroTTS } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";

let tts = null;

// Detect WebGPU
async function detectWebGPU() {
  try {
    if (!navigator.gpu) return false;
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch { return false; }
}

// Load model on startup
async function init() {
  try {
    const device = (await detectWebGPU()) ? "webgpu" : "wasm";
    self.postMessage({ status: "loading", device });

    const model_id = "onnx-community/Kokoro-82M-v1.0-ONNX";
    tts = await KokoroTTS.from_pretrained(model_id, {
      dtype: device === "wasm" ? "q8" : "fp32",
      device,
    });

    self.postMessage({ status: "ready", voices: tts.voices, device });
  } catch (e) {
    self.postMessage({ status: "error", error: e.message });
  }
}

// Handle generation requests
self.addEventListener("message", async (e) => {
  const { action, text, voice } = e.data;

  if (action === "generate") {
    try {
      self.postMessage({ status: "generating" });
      const audio = await tts.generate(text, { voice });
      const blob = audio.toBlob();
      self.postMessage({ status: "complete", audio: URL.createObjectURL(blob), text });
    } catch (err) {
      self.postMessage({ status: "error", error: err.message });
    }
  }
});

init();
