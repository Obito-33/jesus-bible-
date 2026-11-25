"use strict";

const API = "https://bible.helloao.org/api";
const $ = id => document.getElementById(id);

const els = {
  language: $("languageSelect"),
  translation: $("translationSelect"),
  book: $("bookSelect"),
  chapter: $("chapterSelect"),
  name: $("visitorName"),
  date: $("verseDate"),
  getVerse: $("getVerseBtn"),
  status: $("sourceStatus"),
  dailyResult: $("dailyResult"),
  greeting: $("greetingText"),
  verse: $("verseText"),
  reference: $("verseReference"),
  dailyListen: $("dailyListenBtn"),
  dailyStop: $("dailyStopBtn"),
  dailyVoice: $("dailyVoiceLanguage"),
  dailyExplain: $("dailyExplainBtn"),
  dailyExplanation: $("dailyExplanation"),
  readerStatus: $("readerStatus"),
  chapterContent: $("chapterContent"),
  readListen: $("readListenBtn"),
  stopListen: $("stopListenBtn"),
  readerVoice: $("readerVoiceLanguage"),
  readerAudioMode: $("readerAudioMode"),
  effects: $("effectsLayer")
};

let translations = [];
let books = [];
let currentVerses = [];
let dailyVerseText = "";
let explanationMode = "modern";
let currentChapterAudio = {};
let currentAudio = null;
let requestVersion = 0;
let browserVoices = [];

const now = new Date();
els.date.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;

function setStatus(node, message, error = false) {
  node.textContent = message;
  node.style.color = error ? "#b45d50" : "";
}
async function fetchJSON(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Server response ${response.status}`);
  return response.json();
}
function languageLabel(item) {
  return item.languageName || item.languageEnglishName || item.language || "Other";
}
function translationName(t) {
  return `${t.name || t.englishName || t.id} (${t.id})`;
}
function setOptions(select, items, labelFn, placeholder) {
  select.replaceChildren(new Option(placeholder, ""));
  items.forEach(item => select.add(new Option(labelFn(item), item.id)));
}
function selectedTranslation() {
  return translations.find(t => t.id === els.translation.value);
}
function translationsForLanguage() {
  const language = els.language.value;
  return translations.filter(t => !language || languageLabel(t) === language);
}
function populateTranslations(preferredId) {
  const list = translationsForLanguage();
  setOptions(els.translation, list, translationName, "Choose a translation");
  const preferred = list.find(t => t.id === preferredId) || list[0];
  if (preferred) els.translation.value = preferred.id;
}

function getVoices() {
  if (!("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices();
}
function refreshVoiceMenus() {
  browserVoices = getVoices();
  [els.dailyVoice, els.readerVoice].forEach(select => {
    if (!select) return;
    const oldValue = select.value;
    select.replaceChildren(new Option("Device default voice", "default"));
    const languageMap = new Map();
    browserVoices.forEach(voice => {
      const lang = voice.lang || "und";
      if (!languageMap.has(lang)) languageMap.set(lang, voice);
    });
    [...languageMap.entries()]
      .sort((a,b) => a[0].localeCompare(b[0]))
      .forEach(([lang, voice]) => {
        const label = `${new Intl.DisplayNames([navigator.language || "en"], {type:"language"}).of(lang.split("-")[0])} — ${lang}`;
        select.add(new Option(label, lang));
      });
    if ([...select.options].some(o => o.value === oldValue)) select.value = oldValue;
    else {
      const pageLang = selectedTranslation()?.language;
      const match = [...select.options].find(o => o.value.toLowerCase().startsWith((pageLang || "").toLowerCase()));
      if (match) select.value = match.value;
    }
  });
}
if ("speechSynthesis" in window) {
  refreshVoiceMenus();
  window.speechSynthesis.onvoiceschanged = refreshVoiceMenus;
  setTimeout(refreshVoiceMenus, 700);
}

function chosenVoice(select) {
  const value = select?.value || "default";
  if (value === "default") return null;
  return browserVoices.find(v => v.lang === value) || null;
}
function stopAllAudio() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
}
function speak(text, select, statusNode) {
  if (!text || !text.trim()) {
    if (statusNode) setStatus(statusNode, "There is no text to read yet.", true);
    return;
  }
  if (!("speechSynthesis" in window)) {
    if (statusNode) setStatus(statusNode, "Your browser does not support text-to-speech. Try Chrome and enable a voice in your device settings.", true);
    return;
  }
  stopAllAudio();
  const voice = chosenVoice(select);
  const utterance = new SpeechSynthesisUtterance(text);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = selectedTranslation()?.language || navigator.language || "en-US";
  }
  utterance.rate = 0.88;
  utterance.onstart = () => statusNode && setStatus(statusNode, `Listening in ${voice?.lang || utterance.lang}…`);
  utterance.onerror = event => statusNode && setStatus(statusNode, `Voice playback failed (${event.error}). Try another voice language.`, true);
  utterance.onend = () => statusNode && setStatus(statusNode, "Listening finished.");
  window.speechSynthesis.speak(utterance);
}

async function loadLibrary() {
  setStatus(els.status, "Loading available Bible translations…");
  try {
    const data = await fetchJSON(`${API}/available_translations.json`);
    translations = Array.isArray(data.translations) ? data.translations : [];
    if (!translations.length) throw new Error("No translations were returned.");
    const languages = [...new Set(translations.map(languageLabel))].sort((a,b) => a.localeCompare(b));
    els.language.replaceChildren(new Option("All available languages", ""));
    languages.forEach(lang => els.language.add(new Option(lang, lang)));
    const preferred = translations.find(t => t.language === "eng") || translations[0];
    els.language.value = languageLabel(preferred);
    populateTranslations(preferred.id);
    await loadBooks();
    refreshVoiceMenus();
    setStatus(els.status, `${translations.length.toLocaleString()} translations are available. Voice choices depend on voices installed on your device.`);
  } catch (error) {
    setStatus(els.status, `Could not load the Bible library. Check your internet connection and refresh. ${error.message}`, true);
    els.translation.replaceChildren(new Option("Bible library unavailable", ""));
  }
}

async function loadBooks() {
  const translation = els.translation.value;
  if (!translation) return;
  const version = ++requestVersion;
  els.book.disabled = true;
  els.chapter.disabled = true;
  setStatus(els.readerStatus, "Loading Bible books…");
  try {
    const data = await fetchJSON(`${API}/${encodeURIComponent(translation)}/books.json`);
    if (version !== requestVersion) return;
    books = data.books || [];
    setOptions(els.book, books, b => b.name || b.commonName || b.id, "Choose a book");
    els.book.disabled = false;
    setStatus(els.readerStatus, `${books.length} books loaded. Choose a book and chapter.`);
  } catch (error) {
    setStatus(els.readerStatus, `Could not load books: ${error.message}`, true);
  }
}

async function loadChapter() {
  const translation = els.translation.value;
  const book = books.find(b => b.id === els.book.value);
  const chapterNumber = Number(els.chapter.value);
  if (!translation || !book || !chapterNumber) return;

  const version = ++requestVersion;
  els.chapterContent.replaceChildren();
  setStatus(els.readerStatus, "Opening chapter…");
  try {
    // Standard chapter JSON includes the actual verse content and optional recorded-audio links.
    const data = await fetchJSON(`${API}/${encodeURIComponent(translation)}/${encodeURIComponent(book.id)}/${chapterNumber}.json`);
    if (version !== requestVersion) return;

    currentChapterAudio = data.thisChapterAudioLinks || {};
    currentVerses = (data.chapter?.content || [])
      .filter(item => item.type === "verse")
      .map(v => ({
        number: v.number,
        text: (v.content || []).map(part => typeof part === "string" ? part : (part.text || part.heading || "")).join("")
      }))
      .filter(v => v.text.trim());

    renderChapter();
    updateRecordedAudioOption();
    setStatus(els.readerStatus, `${book.name || book.commonName} ${chapterNumber} · ${currentVerses.length} verses loaded.`);
  } catch (error) {
    currentVerses = [];
    currentChapterAudio = {};
    setStatus(els.readerStatus, `Could not open this chapter: ${error.message}`, true);
  }
}

function updateRecordedAudioOption() {
  const option = els.readerAudioMode.querySelector('option[value="recorded"]');
  const available = Object.keys(currentChapterAudio);
  option.disabled = available.length === 0;
  option.textContent = available.length
    ? `Bible recording available (${available.join(", ")})`
    : "Bible recording unavailable for this chapter";
  if (!available.length) els.readerAudioMode.value = "device";
}

function explanationText(mode) {
  if (mode === "traditional") {
    return "Traditional reflection: Consider the historical setting, the original audience, and the meaning of the passage in its surrounding chapter. Read the verses before and after this passage for context.";
  }
  return "Modern reflection: In everyday words, pause and think about what this passage teaches, how it connects with life today, and one practical way to put its message into action.";
}
function renderChapter() {
  els.chapterContent.replaceChildren();
  if (!currentVerses.length) {
    els.chapterContent.textContent = "No verse text was found for this chapter.";
    return;
  }
  currentVerses.forEach(v => {
    const line = document.createElement("p");
    line.className = "verse-line";
    const number = document.createElement("sup");
    number.textContent = v.number;
    line.append(number, document.createTextNode(v.text));
    els.chapterContent.append(line);

    if (explanationMode === "modern" || explanationMode === "traditional" || explanationMode === "both") {
      const note = document.createElement("div");
      note.className = "verse-explain";
      if (explanationMode === "both") {
        note.textContent = `Modern reflection: ${explanationText("modern")} Traditional reflection: ${explanationText("traditional")}`;
      } else {
        note.textContent = explanationText(explanationMode);
      }
      els.chapterContent.append(note);
    }
  });
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}
async function getDailyVerse() {
  if (!els.translation.value) {
    setStatus(els.status, "Wait until the Bible translations finish loading.", true);
    return;
  }
  if (!els.date.value) {
    setStatus(els.status, "Please choose a date.", true);
    return;
  }
  const version = ++requestVersion;
  const name = els.name.value.trim();
  setStatus(els.status, "Finding a verse for you…");
  els.dailyResult.hidden = true;
  try {
    const translation = els.translation.value;
    const data = await fetchJSON(`${API}/${encodeURIComponent(translation)}/books.json`);
    const availableBooks = (data.books || []).filter(b => b.numberOfChapters > 0 && !b.isApocryphal);
    if (!availableBooks.length) throw new Error("No readable books found.");
    const seed = hashString(`${name.toLowerCase()}|${els.date.value}|${translation}`);
    const book = availableBooks[seed % availableBooks.length];
    const chapterNumber = (Math.floor(seed / 97) % book.numberOfChapters) + 1;
    const chapterData = await fetchJSON(`${API}/${encodeURIComponent(translation)}/${encodeURIComponent(book.id)}/${chapterNumber}.simple.json`);
    if (version !== requestVersion) return;
    const verses = (chapterData.chapter?.content || []).filter(v => v.type === "verse" && v.text);
    if (!verses.length) throw new Error("No verse text found.");
    const verse = verses[Math.floor(seed / 7919) % verses.length];
    dailyVerseText = verse.text;
    els.greeting.textContent = name ? `A peaceful day to you, ${name}.` : "A peaceful moment for you.";
    els.verse.textContent = `“${verse.text}”`;
    els.reference.textContent = `${book.name || book.commonName} ${chapterNumber}:${verse.number} · ${translation}`;
    els.dailyExplanation.hidden = true;
    els.dailyResult.hidden = false;
    setStatus(els.status, "Your daily verse is ready. Choose a voice language and press Listen.");
  } catch (error) {
    setStatus(els.status, `Could not get a verse. Please try again. ${error.message}`, true);
  }
}

async function listenToChapter() {
  if (!currentVerses.length) {
    setStatus(els.readerStatus, "Open a Bible chapter first.", true);
    return;
  }
  const mode = els.readerAudioMode.value;
  if (mode === "recorded") {
    const entries = Object.entries(currentChapterAudio);
    if (!entries.length) {
      setStatus(els.readerStatus, "No recorded Bible audio is available for this chapter. Choose Device voice.", true);
      return;
    }
    const [reader, url] = entries[0];
    stopAllAudio();
    currentAudio = new Audio(url);
    currentAudio.onended = () => setStatus(els.readerStatus, "Bible recording finished.");
    currentAudio.onerror = () => setStatus(els.readerStatus, "Recorded audio could not play. Choose Device voice instead.", true);
    try {
      await currentAudio.play();
      setStatus(els.readerStatus, `Playing recorded Bible audio · ${reader}`);
    } catch (error) {
      setStatus(els.readerStatus, "Your browser blocked audio playback. Tap Listen again or choose Device voice.", true);
    }
    return;
  }
  const text = currentVerses.map(v => `${v.number}. ${v.text}`).join(" ");
  speak(text, els.readerVoice, els.readerStatus);
}

els.language.addEventListener("change", () => {
  const previous = els.translation.value;
  populateTranslations(previous);
  loadBooks();
  els.dailyResult.hidden = true;
  refreshVoiceMenus();
});
els.translation.addEventListener("change", () => {
  loadBooks();
  els.dailyResult.hidden = true;
  refreshVoiceMenus();
});
els.book.addEventListener("change", () => {
  const book = books.find(b => b.id === els.book.value);
  els.chapter.replaceChildren(new Option("Choose a chapter", ""));
  if (book) {
    const first = book.firstChapterNumber || 1;
    const last = book.lastChapterNumber || book.numberOfChapters || 1;
    for (let i = first; i <= last; i++) els.chapter.add(new Option(`Chapter ${i}`, String(i)));
    els.chapter.disabled = false;
  } else {
    els.chapter.disabled = true;
  }
  currentVerses = [];
  currentChapterAudio = {};
  els.chapterContent.innerHTML = '<div class="empty-state"><span>✝</span><p>Choose a chapter to begin reading.</p></div>';
  updateRecordedAudioOption();
});
els.chapter.addEventListener("change", loadChapter);
els.getVerse.addEventListener("click", getDailyVerse);
els.dailyListen.addEventListener("click", () => speak(dailyVerseText, els.dailyVoice, els.status));
els.dailyStop.addEventListener("click", stopAllAudio);
els.dailyExplain.addEventListener("click", () => {
  els.dailyExplanation.hidden = !els.dailyExplanation.hidden;
  if (!els.dailyExplanation.hidden) {
    els.dailyExplanation.textContent = `Modern reflection: ${explanationText("modern")} Traditional reflection: ${explanationText("traditional")}`;
  }
});
document.querySelectorAll(".mode-button").forEach(button => button.addEventListener("click", () => {
  explanationMode = button.dataset.mode;
  document.querySelectorAll(".mode-button").forEach(b => b.classList.toggle("active", b === button));
  if (currentVerses.length) renderChapter();
}));
els.readListen.addEventListener("click", listenToChapter);
els.stopListen.addEventListener("click", stopAllAudio);

// Gentle touch effects.
const symbols = ["○", "◦", "✿", "❀", "✧", "♡"];
function releaseEffect(x, y) {
  const item = document.createElement("span");
  item.className = "effect";
  item.textContent = symbols[Math.floor(Math.random() * symbols.length)];
  item.style.left = `${x}px`;
  item.style.top = `${y}px`;
  item.style.color = ["#a8bda7", "#c8a7a0", "#c4a66f", "#9eb6c2"][Math.floor(Math.random() * 4)];
  els.effects.append(item);
  item.addEventListener("animationend", () => item.remove(), { once: true });
}
document.addEventListener("pointerdown", event => {
  if (event.target.closest("button, a, input, select, label")) return;
  releaseEffect(event.clientX, event.clientY);
});

loadLibrary();
