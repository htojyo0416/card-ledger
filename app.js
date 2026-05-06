const storageKey = "card-ledger.cards";

const elements = {
  cameraTab: document.querySelector("#cameraTab"),
  uploadTab: document.querySelector("#uploadTab"),
  cameraPane: document.querySelector("#cameraPane"),
  uploadPane: document.querySelector("#uploadPane"),
  startCameraButton: document.querySelector("#startCameraButton"),
  captureButton: document.querySelector("#captureButton"),
  cameraPreview: document.querySelector("#cameraPreview"),
  snapshotCanvas: document.querySelector("#snapshotCanvas"),
  imageInput: document.querySelector("#imageInput"),
  businessCardImage: document.querySelector("#businessCardImage"),
  ocrState: document.querySelector("#ocrState"),
  ocrProgress: document.querySelector("#ocrProgress"),
  rawText: document.querySelector("#rawText"),
  parseButton: document.querySelector("#parseButton"),
  cardForm: document.querySelector("#cardForm"),
  company: document.querySelector("#company"),
  companyCandidates: document.querySelector("#companyCandidates"),
  saveButton: document.querySelector("#saveButton"),
  deleteButton: document.querySelector("#deleteButton"),
  newCardButton: document.querySelector("#newCardButton"),
  searchInput: document.querySelector("#searchInput"),
  cardList: document.querySelector("#cardList"),
  totalCount: document.querySelector("#totalCount"),
  recentCount: document.querySelector("#recentCount"),
  toast: document.querySelector("#toast"),
};

const fields = ["name", "company", "title", "email", "phone", "website", "address", "notes"];
let cards = loadCards();
let activeId = cards[0]?.id ?? null;
let cameraStream = null;
let toastTimer = null;

registerServiceWorker();
render();
if (activeId) {
  loadCard(activeId);
} else {
  resetForm();
}

elements.cameraTab.addEventListener("click", () => setInputMode("camera"));
elements.uploadTab.addEventListener("click", () => setInputMode("upload"));
elements.startCameraButton.addEventListener("click", startCamera);
elements.captureButton.addEventListener("click", capturePhoto);
elements.imageInput.addEventListener("change", handleImageUpload);
elements.parseButton.addEventListener("click", () => applyParsedText(elements.rawText.value));
elements.saveButton.addEventListener("click", saveActiveCard);
elements.deleteButton.addEventListener("click", deleteActiveCard);
elements.newCardButton.addEventListener("click", createBlankCard);
elements.searchInput.addEventListener("input", render);

function setInputMode(mode) {
  const camera = mode === "camera";
  elements.cameraTab.classList.toggle("active", camera);
  elements.uploadTab.classList.toggle("active", !camera);
  elements.cameraPane.classList.toggle("active", camera);
  elements.uploadPane.classList.toggle("active", !camera);
}

async function startCamera() {
  try {
    if (cameraStream) {
      stopCamera();
    }
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    elements.cameraPreview.srcObject = cameraStream;
    elements.captureButton.disabled = false;
    setStatus("カメラ準備完了", "");
  } catch (error) {
    setStatus("カメラを起動できません", "");
    showToast("ブラウザのカメラ許可、またはHTTPSでの起動を確認してください。");
  }
}

function stopCamera() {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  elements.captureButton.disabled = true;
}

function capturePhoto() {
  const video = elements.cameraPreview;
  const canvas = elements.snapshotCanvas;
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const context = canvas.getContext("2d");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
  setImageAndRunOcr(dataUrl);
}

function handleImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => setImageAndRunOcr(String(reader.result));
  reader.readAsDataURL(file);
}

async function setImageAndRunOcr(dataUrl) {
  elements.businessCardImage.src = dataUrl;
  ensureDraftCard().image = dataUrl;
  persist();
  render();

  if (!window.Tesseract) {
    setStatus("OCRライブラリ未読込", "");
    showToast("OCRが読み込めませんでした。テキスト欄に入力して再抽出できます。");
    return;
  }

  try {
    setStatus("画像補正中", "");
    const preparedImage = await prepareImageForOcr(dataUrl);
    setStatus("OCR解析中", "0%");
    const result = await Tesseract.recognize(preparedImage, "jpn+eng", {
      preserve_interword_spaces: "1",
      logger(message) {
        if (message.status === "recognizing text") {
          elements.ocrProgress.textContent = `${Math.round(message.progress * 100)}%`;
        }
      },
    });
    const text = normalizeOcrText(result.data.text);
    elements.rawText.value = text;
    ensureDraftCard().rawText = text;
    setStatus("OCR完了", "");
    applyParsedText(text);
  } catch (error) {
    setStatus("OCR失敗", "");
    showToast("OCRに失敗しました。明るい場所で名刺を大きく撮り直してください。");
  }
}

function prepareImageForOcr(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(2.4, Math.max(1.2, 2200 / Math.max(image.width, image.height)));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.45 + 128));
        data[i] = contrasted;
        data[i + 1] = contrasted;
        data[i + 2] = contrasted;
      }
      context.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = reject;
    image.src = dataUrl;
  });
}

function applyParsedText(text) {
  const parsed = parseBusinessCard(text);
  fields.forEach((field) => {
    if (field !== "company" && parsed[field]) {
      document.querySelector(`#${field}`).value = parsed[field];
    }
  });

  if (parsed.company && parsed.companyConfidence >= 8) {
    elements.company.value = parsed.company;
  } else if (!elements.company.value.trim()) {
    elements.company.value = "";
  }

  renderCompanyCandidates(parsed.companyCandidates);
  elements.rawText.value = text;
  showToast(parsed.company ? "会社名候補を抽出しました。確認して保存してください。" : "OCR結果を抽出しました。会社名は候補から選んでください。");
}

function renderCompanyCandidates(candidates) {
  elements.companyCandidates.innerHTML = "";
  candidates.slice(0, 5).forEach((candidate) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "candidate-chip";
    button.textContent = candidate.text;
    button.title = `会社名候補: ${candidate.text}`;
    button.addEventListener("click", () => {
      elements.company.value = candidate.text;
      showToast("会社名を候補から入力しました。");
    });
    elements.companyCandidates.append(button);
  });
}

function parseBusinessCard(text) {
  const lines = normalizeOcrText(text)
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);
  const joined = lines.join(" ");
  const email = joined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
  const website = findWebsite(lines);
  const phone = joined.match(/(?:\+?\d{1,3}[-\s.]*)?(?:\(?0\d{1,4}\)?[-\s.]*)?\d{2,4}[-\s.]\d{2,4}[-\s.]\d{3,4}/)?.[0] ?? "";
  const address = lines.find((line) => /〒|都|道|府|県|市|区|町|丁目|番地|-\d/.test(line) && !line.includes("@")) ?? "";
  const title = lines.find((line) => /(代表|取締役|部長|課長|主任|係長|Manager|Director|CEO|CTO|Sales|Marketing|Engineer)/i.test(line)) ?? "";
  const companyCandidates = findCompanyCandidates(lines, { email, phone, website, address, title });
  const company = companyCandidates[0]?.text ?? "";
  const companyConfidence = companyCandidates[0]?.score ?? 0;
  const name = findLikelyName(lines, { email, phone, website, address, company, title });

  return { name, company, companyConfidence, companyCandidates, title, email, phone, website, address };
}

function findWebsite(lines) {
  const explicit = lines.find((line) => !line.includes("@") && /(?:https?:\/\/|www\.)[A-Z0-9.-]+\.[A-Z]{2,}(?:\/\S*)?/i.test(line));
  if (explicit) return explicit.match(/(?:https?:\/\/|www\.)[A-Z0-9.-]+\.[A-Z]{2,}(?:\/\S*)?/i)?.[0] ?? "";
  return "";
}

function findCompanyCandidates(lines, known) {
  const companyWords = /(株式会社|有限会社|合同会社|一般社団法人|公益社団法人|医療法人|学校法人|Inc\.?|Ltd\.?|Co\.?|Corporation|Company|LLC|GmbH|Group|Holdings)/i;
  const weakCompanyWords = /(事務所|研究所|制作|デザイン|システム|ソリューション|サービス|商事|工業|産業|不動産|クリニック|大学|学院|銀行|協会|センター|LAB|STUDIO|DESIGN|SYSTEM|SOLUTION)/i;
  const rejectedValues = new Set(Object.values(known).filter(Boolean));

  return lines
    .map((line, index) => {
      const text = cleanLine(line);
      let score = 0;
      if (!text || rejectedValues.has(text)) return null;
      if (text.includes("@") || /TEL|FAX|携帯|Mobile|Phone|E-mail|Email/i.test(text)) return null;
      if (/https?:|www\.|^\d+$/.test(text)) return null;
      if (companyWords.test(text)) score += 10;
      if (weakCompanyWords.test(text)) score += 4;
      if (/[A-Z][A-Z0-9&., -]{2,}/.test(text)) score += 2;
      if (/[\u4e00-\u9fff]{2,}/.test(text)) score += 2;
      if (index <= 3) score += 3;
      if (text.length >= 4 && text.length <= 34) score += 2;
      if (/\d{3,}/.test(text)) score -= 4;
      if (/(代表|取締役|部長|課長|主任|Manager|Director|CEO|CTO)/i.test(text)) score -= 5;
      return score > 1 ? { text, score } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

function findLikelyName(lines, known) {
  const rejected = new Set(Object.values(known).filter(Boolean));
  const candidates = lines.filter((line) => {
    if (rejected.has(line)) return false;
    if (line.includes("@") || /https?:|www\.|\d{3,}/i.test(line)) return false;
    if (/(株式会社|有限会社|合同会社|Inc\.?|Ltd\.?|〒|TEL|FAX|Mail|Email)/i.test(line)) return false;
    return line.length >= 2 && line.length <= 28;
  });
  return candidates[0] ?? "";
}

function normalizeOcrText(text) {
  return text
    .replace(/[|｜]/g, "I")
    .replace(/[―–—]/g, "-")
    .replace(/[　\t]+/g, " ")
    .replace(/\r/g, "")
    .trim();
}

function cleanLine(line) {
  return line
    .replace(/\s+/g, " ")
    .replace(/^[・:：,，.。-\s]+|[・:：,，.。-\s]+$/g, "")
    .trim();
}

function saveActiveCard() {
  const card = ensureDraftCard();
  fields.forEach((field) => {
    card[field] = document.querySelector(`#${field}`).value.trim();
  });
  card.rawText = elements.rawText.value.trim();
  card.updatedAt = new Date().toISOString();
  persist();
  render();
  showToast("名刺を保存しました。");
}

function deleteActiveCard() {
  if (!activeId) return;
  const card = cards.find((item) => item.id === activeId);
  if (!card) return;
  const hasContent = fields.some((field) => card[field]) || card.image || card.rawText;
  if (hasContent && !window.confirm("この名刺を削除しますか？")) return;
  cards = cards.filter((item) => item.id !== activeId);
  activeId = cards[0]?.id ?? null;
  persist();
  render();
  activeId ? loadCard(activeId) : resetForm();
  showToast("削除しました。");
}

function createBlankCard() {
  const card = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rawText: "",
    image: "",
  };
  fields.forEach((field) => {
    card[field] = "";
  });
  cards.unshift(card);
  activeId = card.id;
  persist();
  resetForm();
  render();
  showToast("新しい名刺を作成しました。");
}

function ensureDraftCard() {
  let card = cards.find((item) => item.id === activeId);
  if (!card) {
    createBlankCard();
    card = cards.find((item) => item.id === activeId);
  }
  return card;
}

function loadCard(id) {
  const card = cards.find((item) => item.id === id);
  if (!card) return;
  activeId = id;
  fields.forEach((field) => {
    document.querySelector(`#${field}`).value = card[field] ?? "";
  });
  elements.rawText.value = card.rawText ?? "";
  elements.businessCardImage.src = card.image ?? "";
  renderCompanyCandidates([]);
  render();
}

function resetForm() {
  fields.forEach((field) => {
    document.querySelector(`#${field}`).value = "";
  });
  elements.rawText.value = "";
  elements.businessCardImage.removeAttribute("src");
  renderCompanyCandidates([]);
}

function render() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const visibleCards = cards.filter((card) => {
    const haystack = fields.map((field) => card[field]).join(" ").toLowerCase();
    return haystack.includes(query);
  });
  elements.cardList.innerHTML = "";
  visibleCards.forEach((card) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `list-item${card.id === activeId ? " active" : ""}`;
    item.innerHTML = `
      <strong>${escapeHtml(card.name || "氏名未入力")}</strong>
      <span>${escapeHtml(card.company || card.email || "詳細未入力")}</span>
    `;
    item.addEventListener("click", () => loadCard(card.id));
    elements.cardList.append(item);
  });
  if (!visibleCards.length) {
    const empty = document.createElement("div");
    empty.className = "list-item";
    empty.innerHTML = "<strong>該当なし</strong><span>検索条件を変えてください</span>";
    elements.cardList.append(empty);
  }
  elements.totalCount.textContent = String(cards.length);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  elements.recentCount.textContent = String(cards.filter((card) => Date.parse(card.createdAt) >= weekAgo).length);
}

function loadCards() {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) ?? [];
  } catch {
    return [];
  }
}

function persist() {
  localStorage.setItem(storageKey, JSON.stringify(cards));
}

function setStatus(state, progress) {
  elements.ocrState.textContent = state;
  elements.ocrProgress.textContent = progress;
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2600);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return map[char];
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;

  navigator.serviceWorker.register("sw.js").catch(() => {
    // The app still works without offline caching.
  });
}
