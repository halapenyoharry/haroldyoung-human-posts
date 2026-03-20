// tts-reader.js — Standalone TTS reader module for post-pipe
// Provides: openReader(d), closeReader() + wires up panel buttons
// Expects DOM: #reader-panel, #reader-overlay, #reader-body, #readerTitle,
//   #readerVoice, #readerPlay, #readerPause, #readerStop, #readerClose,
//   #reader-progress-fill

(function() {
  'use strict';

  const synth = window.speechSynthesis;
  let sentences = [];
  let sentenceIndex = 0;
  let playing = false;
  let voice = null;

  // Curated natural-sounding voices — no novelty voices
  const GOOD_VOICES = new Set([
    'Samantha', 'Daniel', 'Karen', 'Moira', 'Tessa', 'Rishi', 'Tara', 'Aman',
    'Flo', 'Shelley', 'Sandy', 'Grandma', 'Grandpa', 'Reed',
    'Google US English', 'Google UK English Male', 'Google UK English Female',
  ]);

  function stripVoiceSuffix(name) {
    return name.replace(/ \(English.*\)/, '');
  }

  function getRandomVoice() {
    const good = synth.getVoices().filter(v =>
      v.lang.startsWith('en') && GOOD_VOICES.has(stripVoiceSuffix(v.name))
    );
    if (good.length) return good[Math.floor(Math.random() * good.length)];
    const fallback = synth.getVoices().filter(v => v.lang.startsWith('en'));
    return fallback.length ? fallback[0] : null;
  }

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

  function speakNext() {
    if (!playing || sentenceIndex >= sentences.length) {
      stop();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(sentences[sentenceIndex]);
    if (voice) utterance.voice = voice;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onend = () => {
      sentenceIndex++;
      updateProgress();
      if (playing) setTimeout(speakNext, 80);
    };
    synth.speak(utterance);
  }

  function play() {
    if (!sentences.length || !synth) return;
    playing = true;
    document.getElementById('readerPlay').style.display = 'none';
    document.getElementById('readerPause').style.display = '';
    document.getElementById('readerStop').style.display = '';
    speakNext();
  }

  function pause() {
    synth.pause();
    playing = false;
    document.getElementById('readerPlay').style.display = '';
    document.getElementById('readerPlay').textContent = 'Resume';
    document.getElementById('readerPause').style.display = 'none';
  }

  function resume() {
    if (synth.paused) {
      synth.resume();
      playing = true;
      document.getElementById('readerPlay').style.display = 'none';
      document.getElementById('readerPause').style.display = '';
    } else {
      play();
    }
  }

  function stop() {
    synth.cancel();
    playing = false;
    sentenceIndex = 0;
    document.getElementById('readerPlay').style.display = '';
    document.getElementById('readerPlay').textContent = 'Play';
    document.getElementById('readerPause').style.display = 'none';
    document.getElementById('readerStop').style.display = 'none';
    updateProgress();
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

    voice = getRandomVoice();
    voiceLabel.textContent = voice ? voice.name : 'No voice';

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
      if (synth.paused) resume();
      else play();
    });
    document.getElementById('readerPause').addEventListener('click', pause);
    document.getElementById('readerStop').addEventListener('click', stop);
    document.getElementById('readerClose').addEventListener('click', window.closeReader);
    document.getElementById('reader-overlay').addEventListener('click', window.closeReader);
    synth.addEventListener('voiceschanged', () => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireButtons);
  } else {
    wireButtons();
  }

})();
