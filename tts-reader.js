// tts-reader.js — Standalone TTS reader module for post-pipe
// Two engines: Browser TTS (instant) and Kokoro (high quality, loads model from HuggingFace)
// Provides: openReader(d), closeReader() + wires up panel buttons
// Expects DOM: #reader-panel, #reader-overlay, #reader-body, #readerTitle,
//   #readerVoice, #readerPlay, #readerPause, #readerStop, #readerClose,
//   #reader-progress-fill, #readerEngine

(function() {
  'use strict';

  const synth = window.speechSynthesis;
  let sentences = [];
  let sentenceIndex = 0;
  let playing = false;
  let browserVoice = null;
  let currentAudio = null; // for Kokoro playback

  // Engine state: 'browser' or 'kokoro'
  let engine = 'browser';
  let kokoroWorker = null;
  let kokoroReady = false;
  let kokoroVoices = [];
  let kokoroVoice = null;

  // Best Kokoro voices (grade B- or above)
  const KOKORO_BEST = [
    'af_heart', 'af_bella', 'af_nicole', 'af_aoede', 'af_kore', 'af_sarah',
    'am_fenrir', 'am_michael', 'am_puck',
    'bf_emma', 'bm_fable', 'bm_george',
  ];

  // Curated browser voices — no novelty voices
  const GOOD_BROWSER_VOICES = new Set([
    'Samantha', 'Daniel', 'Karen', 'Moira', 'Tessa', 'Rishi', 'Tara', 'Aman',
    'Flo', 'Shelley', 'Sandy', 'Grandma', 'Grandpa', 'Reed',
    'Google US English', 'Google UK English Male', 'Google UK English Female',
  ]);

  function stripVoiceSuffix(name) {
    return name.replace(/ \(English.*\)/, '');
  }

  function getRandomBrowserVoice() {
    const good = synth.getVoices().filter(v =>
      v.lang.startsWith('en') && GOOD_BROWSER_VOICES.has(stripVoiceSuffix(v.name))
    );
    if (good.length) return good[Math.floor(Math.random() * good.length)];
    const fallback = synth.getVoices().filter(v => v.lang.startsWith('en'));
    return fallback.length ? fallback[0] : null;
  }

  function getRandomKokoroVoice() {
    const available = KOKORO_BEST.filter(v => kokoroVoices.includes(v));
    if (available.length) return available[Math.floor(Math.random() * available.length)];
    return kokoroVoices.length ? kokoroVoices[0] : 'af_heart';
  }

  // ─── Kokoro Worker ──────────────────────────────────────────────────────────

  function initKokoro() {
    if (kokoroWorker) return;

    const voiceLabel = document.getElementById('readerVoice');
    voiceLabel.textContent = 'Loading Kokoro model...';

    kokoroWorker = new Worker('./kokoro-worker.js', { type: 'module' });
    kokoroWorker.addEventListener('message', (e) => {
      const msg = e.data;

      if (msg.status === 'loading') {
        voiceLabel.textContent = 'Loading model (' + msg.device + ')...';
      }
      if (msg.status === 'ready') {
        kokoroReady = true;
        kokoroVoices = msg.voices || [];
        kokoroVoice = getRandomKokoroVoice();
        voiceLabel.textContent = 'Kokoro: ' + kokoroVoice;
      }
      if (msg.status === 'generating') {
        voiceLabel.textContent = 'Generating audio...';
      }
      if (msg.status === 'complete') {
        voiceLabel.textContent = 'Kokoro: ' + kokoroVoice;
        playAudioBlob(msg.audio);
      }
      if (msg.status === 'error') {
        voiceLabel.textContent = 'Kokoro error: ' + msg.error;
        // Fall back to browser TTS
        engine = 'browser';
        updateEngineButton();
      }
    });
  }

  function playAudioBlob(url) {
    stopAudio();
    currentAudio = new Audio(url);
    currentAudio.onended = () => {
      sentenceIndex++;
      updateProgress();
      if (playing && sentenceIndex < sentences.length) {
        kokoroGenerateNext();
      } else {
        stop();
      }
    };
    currentAudio.play();
  }

  function stopAudio() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
  }

  function kokoroGenerateNext() {
    if (!playing || sentenceIndex >= sentences.length) {
      stop();
      return;
    }
    kokoroWorker.postMessage({
      action: 'generate',
      text: sentences[sentenceIndex],
      voice: kokoroVoice,
    });
  }

  // ─── Content extraction ────────────────────────────────────────────────────

  function extractContent(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('nav, header, footer, script, style, .quarto-title-block').forEach(el => el.remove());
    return doc.querySelector('main') || doc.querySelector('.content') || doc.querySelector('article') || doc.body;
  }

  function splitSentences(text) {
    return text.match(/[^.!?]+[.!?]+[\s]*/g) || [text];
  }

  function updateProgress() {
    const pct = sentences.length ? (sentenceIndex / sentences.length * 100) : 0;
    document.getElementById('reader-progress-fill').style.width = pct + '%';
  }

  // ─── Browser TTS ───────────────────────────────────────────────────────────

  function browserSpeakNext() {
    if (!playing || sentenceIndex >= sentences.length) {
      stop();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(sentences[sentenceIndex]);
    if (browserVoice) utterance.voice = browserVoice;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onend = () => {
      sentenceIndex++;
      updateProgress();
      if (playing) setTimeout(browserSpeakNext, 80);
    };
    synth.speak(utterance);
  }

  // ─── Unified controls ─────────────────────────────────────────────────────

  function play() {
    if (!sentences.length) return;
    playing = true;
    document.getElementById('readerPlay').style.display = 'none';
    document.getElementById('readerPause').style.display = '';
    document.getElementById('readerStop').style.display = '';

    if (engine === 'kokoro') {
      if (!kokoroReady) {
        document.getElementById('readerVoice').textContent = 'Model still loading...';
        playing = false;
        document.getElementById('readerPlay').style.display = '';
        document.getElementById('readerPause').style.display = 'none';
        return;
      }
      kokoroGenerateNext();
    } else {
      browserSpeakNext();
    }
  }

  function pause() {
    playing = false;
    document.getElementById('readerPlay').style.display = '';
    document.getElementById('readerPlay').textContent = 'Resume';
    document.getElementById('readerPause').style.display = 'none';

    if (engine === 'browser') {
      synth.pause();
    } else {
      if (currentAudio) currentAudio.pause();
    }
  }

  function resume() {
    if (engine === 'browser' && synth.paused) {
      synth.resume();
      playing = true;
      document.getElementById('readerPlay').style.display = 'none';
      document.getElementById('readerPause').style.display = '';
    } else if (engine === 'kokoro' && currentAudio && currentAudio.paused) {
      currentAudio.play();
      playing = true;
      document.getElementById('readerPlay').style.display = 'none';
      document.getElementById('readerPause').style.display = '';
    } else {
      play();
    }
  }

  function stop() {
    playing = false;
    sentenceIndex = 0;
    synth.cancel();
    stopAudio();
    document.getElementById('readerPlay').style.display = '';
    document.getElementById('readerPlay').textContent = 'Play';
    document.getElementById('readerPause').style.display = 'none';
    document.getElementById('readerStop').style.display = 'none';
    updateProgress();
  }

  function updateEngineButton() {
    const btn = document.getElementById('readerEngine');
    if (!btn) return;
    btn.textContent = engine === 'browser' ? 'Browser' : 'Kokoro';
    btn.classList.toggle('active', engine === 'kokoro');
  }

  function toggleEngine() {
    stop();
    engine = engine === 'browser' ? 'kokoro' : 'browser';
    updateEngineButton();

    const voiceLabel = document.getElementById('readerVoice');
    if (engine === 'kokoro') {
      initKokoro();
      if (kokoroReady) {
        kokoroVoice = getRandomKokoroVoice();
        voiceLabel.textContent = 'Kokoro: ' + kokoroVoice;
      }
    } else {
      browserVoice = getRandomBrowserVoice();
      voiceLabel.textContent = browserVoice ? browserVoice.name : 'No voice';
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  window.openReader = function(d) {
    const panel = document.getElementById('reader-panel');
    const overlay = document.getElementById('reader-overlay');
    const body = document.getElementById('reader-body');
    const title = document.getElementById('readerTitle');
    const voiceLabel = document.getElementById('readerVoice');

    stop();
    title.textContent = d.title || d.label;
    body.innerHTML = '<p style="color:#64ffda;">Loading...</p>';
    panel.style.display = 'flex';
    overlay.style.display = 'block';

    if (engine === 'browser') {
      browserVoice = getRandomBrowserVoice();
      voiceLabel.textContent = browserVoice ? browserVoice.name : 'No voice';
    } else {
      kokoroVoice = getRandomKokoroVoice();
      voiceLabel.textContent = kokoroReady ? 'Kokoro: ' + kokoroVoice : 'Loading model...';
    }
    updateEngineButton();

    fetch(d.url)
      .then(r => r.text())
      .then(html => {
        const content = extractContent(html);
        body.innerHTML = '';
        Array.from(content.childNodes).forEach(n => body.appendChild(n.cloneNode(true)));
        sentences = splitSentences(body.textContent);
        sentenceIndex = 0;
        updateProgress();
      })
      .catch(err => {
        body.innerHTML = '<p style="color:#ef4444;">Failed to load: ' + err.message + '</p>';
      });
  };

  window.closeReader = function() {
    stop();
    document.getElementById('reader-panel').style.display = 'none';
    document.getElementById('reader-overlay').style.display = 'none';
  };

  // ─── Wire up buttons on DOMContentLoaded ─────────────────────────────────────

  function wireButtons() {
    document.getElementById('readerPlay').addEventListener('click', () => {
      if ((engine === 'browser' && synth.paused) ||
          (engine === 'kokoro' && currentAudio && currentAudio.paused)) {
        resume();
      } else {
        play();
      }
    });
    document.getElementById('readerPause').addEventListener('click', pause);
    document.getElementById('readerStop').addEventListener('click', stop);
    document.getElementById('readerClose').addEventListener('click', window.closeReader);
    document.getElementById('reader-overlay').addEventListener('click', window.closeReader);

    const engineBtn = document.getElementById('readerEngine');
    if (engineBtn) engineBtn.addEventListener('click', toggleEngine);

    synth.addEventListener('voiceschanged', () => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireButtons);
  } else {
    wireButtons();
  }

})();
