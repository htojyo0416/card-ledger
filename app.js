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
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1600 } },
      audio: false,
    });
    elements.cameraPreview.srcObject = cameraStream;
    elements.captureButton.disabled = false;
    setStatus("カメラ準備完了", "");
  } catch (error) {
    setStatus("カメラを起動できません", "");
    showToast("ブラウザのカメラ許可、またはlocalhostでの起動を確認してください。");
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
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
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
    setStatus("OCR解析中", "0%");
    const result = await Tesseract.recognize(dataUrl, "jpn+eng", {
      logger(message) {
        if (message.status === "recognizing text") {
          elements.ocrProgress.textContent = `${Math.round(message.progress * 100)}%`;
        }
      },
    });
    const text = result.data.text.trim();
    elements.rawText.value = text;
    ensureDraftCard().rawText = text;
    setStatus("OCR完了", "");
    applyParsedText(text);
  } catch (error) {
    setStatus("OCR失敗", "");
    showToast("OCRに失敗しました。画像を明るく撮り直すか、テキストを手入力してください。");
  }
}

function applyParsedText(text) {
  const parsed = parseBusinessCard(text);
  fields.forEach((field) => {
    if (parsed[field]) {
      document.querySelector(`#${field}`).value = parsed[field];
    }
  });
  elements.rawText.value = text;
  showToast("テキストから候補を抽出しました。");
}

function parseBusinessCard(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const joined = lines.join(" ");
  const email = joined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
  const website =
    lines.find((line) => !line.includes("@") && /(?:https?:\/\/|www\.)[A-Z0-9.-]+\.[A-Z]{2,}(?:\/\S*)?/i.test(line)) ?? "";
  const phone = joined.match(/(?:\+?\d{1,3}[-\s.]*)?(?:\(?0\d{1,4}\)?[-\s.]*)?\d{2,4}[-\s.]\d{2,4}[-\s.]\d{3,4}/)?.[0] ?? "";
  const address = lines.find((line) => /〒|都|道|府|県|市|区|町|丁目|番地|-\d/.test(line) && !line.includes("@")) ?? "";
  const company = lines.find((line) => /(株式会社|有限会社|合同会社|Inc\.?|Ltd\.?|Co\.?|Corporation|Company|LLC)/i.test(line)) ?? "";
  const title = lines.find((line) => /(代表|取締役|部長|課長|主任|Manager|Director|CEO|CTO|Sales|Marketing|Engineer)/i.test(line)) ?? "";
  const name = findLikelyName(lines, { email, phone, website, address, company, title });

  return { name, company, title, email, phone, website, address };
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
  render();
}

function resetForm() {
  fields.forEach((field) => {
    document.querySelector(`#${field}`).value = "";
  });
  elements.rawText.value = "";
  elements.businessCardImage.removeAttribute("src");
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
