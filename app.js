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
  aiEndpoint: document.querySelector("#aiEndpoint"),
  saveAiEndpointButton: document.querySelector("#saveAiEndpointButton"),
  aiOcrButton: document.querySelector("#aiOcrButton"),
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
const jp = {
  company: "\\u682a\\u5f0f\\u4f1a\\u793e|\\u6709\\u9650\\u4f1a\\u793e|\\u5408\\u540c\\u4f1a\\u793e|\\u4e00\\u822c\\u793e\\u56e3\\u6cd5\\u4eba|\\u516c\\u76ca\\u793e\\u56e3\\u6cd5\\u4eba|\\u533b\\u7642\\u6cd5\\u4eba|\\u5b66\\u6821\\u6cd5\\u4eba",
  title: "\\u4ee3\\u8868|\\u53d6\\u7de0\\u5f79|\\u90e8\\u9577|\\u8ab2\\u9577|\\u4e3b\\u4efb|\\u4fc2\\u9577|\\u793e\\u9577",
  address: "\\u3012|\\u90fd|\\u9053|\\u5e9c|\\u770c|\\u5e02|\\u533a|\\u753a|\\u4e01\\u76ee|\\u756a\\u5730",
  weakCompany: "\\u4e8b\\u52d9\\u6240|\\u7814\\u7a76\\u6240|\\u5236\\u4f5c|\\u30c7\\u30b6\\u30a4\\u30f3|\\u30b7\\u30b9\\u30c6\\u30e0|\\u30bd\\u30ea\\u30e5\\u30fc\\u30b7\\u30e7\\u30f3|\\u30b5\\u30fc\\u30d3\\u30b9|\\u5546\\u4e8b|\\u5de5\\u696d|\\u7523\\u696d|\\u4e0d\\u52d5\\u7523|\\u30af\\u30ea\\u30cb\\u30c3\\u30af|\\u5927\\u5b66|\\u5b66\\u9662|\\u9280\\u884c|\\u5354\\u4f1a|\\u30bb\\u30f3\\u30bf\\u30fc",
};

let cards = loadCards();
let activeId = cards[0]?.id ?? null;
let cameraStream = null;
let toastTimer = null;

registerServiceWorker();
elements.aiEndpoint.value = localStorage.getItem("card-ledger.aiEndpoint") || "";
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
elements.saveAiEndpointButton.addEventListener("click", saveAiEndpoint);
elements.aiOcrButton.addEventListener("click", runAiOcr);
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
    if (cameraStream) stopCamera();
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    elements.cameraPreview.srcObject = cameraStream;
    elements.captureButton.disabled = false;
    setStatus("Camera ready", "");
  } catch {
    setStatus("Camera unavailable", "");
    showToast("Use the high-resolution camera button or open this app over HTTPS.");
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
  setImageAndRunOcr(canvas.toDataURL("image/jpeg", 0.95));
}

function handleImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => setImageAndRunOcr(String(reader.result));
  reader.readAsDataURL(file);
  event.target.value = "";
}

async function setImageAndRunOcr(dataUrl) {
  elements.businessCardImage.src = dataUrl;
  ensureDraftCard().image = dataUrl;
  persist();
  render();

  if (elements.aiEndpoint.value.trim()) {
    await runAiOcr();
    return;
  }

  if (!window.Tesseract) {
    setStatus("OCR not loaded", "");
    showToast("OCR library did not load. You can paste text and extract fields.");
    return;
  }

  try {
    setStatus("Preparing image", "");
    const images = await prepareImagesForOcr(dataUrl);
    const results = [];
    for (let i = 0; i < images.length; i += 1) {
      setStatus("OCR running", `${i + 1}/${images.length}`);
      results.push(await recognizeImage(images[i], i));
    }
    const best = results.sort((a, b) => b.score - a.score)[0];
    const text = normalizeOcrText(best.text);
    elements.rawText.value = text;
    ensureDraftCard().rawText = text;
    setStatus("OCR done", "");
    applyParsedText(text);
  } catch {
    setStatus("OCR failed", "");
    showToast("OCR failed. Retake the card brighter, larger, and as flat as possible.");
  }
}

function saveAiEndpoint() {
  localStorage.setItem("card-ledger.aiEndpoint", elements.aiEndpoint.value.trim());
  showToast("AI OCR URL saved.");
}

async function runAiOcr() {
  const endpoint = elements.aiEndpoint.value.trim();
  const image = ensureDraftCard().image || elements.businessCardImage.src;
  if (!endpoint) {
    showToast("Set the AI OCR URL first.");
    return;
  }
  if (!image) {
    showToast("Take or upload a business card image first.");
    return;
  }

  try {
    setStatus("AI OCR running", "");
    elements.aiOcrButton.disabled = true;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
    });
    if (!response.ok) throw new Error(`AI OCR failed: ${response.status}`);
    const data = await response.json();
    fillFieldsFromAi(data);
    elements.rawText.value = data.rawText || JSON.stringify(data, null, 2);
    ensureDraftCard().rawText = elements.rawText.value;
    setStatus("AI OCR done", "");
    showToast("AI OCR completed. Check the fields before saving.");
  } catch {
    setStatus("AI OCR failed", "");
    showToast("AI OCR failed. Check the Worker URL and API key.");
  } finally {
    elements.aiOcrButton.disabled = false;
  }
}

function fillFieldsFromAi(data) {
  const mapping = {
    name: data.name,
    company: data.company,
    title: data.title,
    email: data.email,
    phone: data.phone,
    website: data.website,
    address: data.address,
    notes: data.notes,
  };
  Object.entries(mapping).forEach(([field, value]) => {
    if (typeof value === "string" && value.trim()) {
      document.querySelector(`#${field}`).value = value.trim();
    }
  });
  renderCompanyCandidates(data.company ? [{ text: data.company, score: 99 }] : []);
}

function recognizeImage(image, index) {
  const psm = index === 0 ? "6" : "11";
  return Tesseract.recognize(image, "jpn+eng", {
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
    tessedit_pageseg_mode: psm,
    logger(message) {
      if (message.status === "recognizing text") {
        elements.ocrProgress.textContent = `${Math.round(message.progress * 100)}%`;
      }
    },
  }).then((result) => {
    const text = result.data.text || "";
    return { text, score: scoreOcrText(text, result.data.confidence || 0) };
  });
}

function prepareImagesForOcr(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const maxSide = Math.max(image.width, image.height);
      const scale = Math.min(3, Math.max(1, 2600 / maxSide));
      const width = Math.round(image.width * scale);
      const height = Math.round(image.height * scale);
      resolve([
        renderPreparedImage(image, width, height, "contrast"),
        renderPreparedImage(image, width, height, "threshold"),
      ]);
    };
    image.onerror = reject;
    image.src = dataUrl;
  });
}

function renderPreparedImage(image, width, height, mode) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const value = mode === "threshold" ? (gray > 178 ? 255 : 0) : Math.max(0, Math.min(255, (gray - 128) * 1.65 + 142));
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function scoreOcrText(text, confidence) {
  const clean = normalizeOcrText(text);
  const japaneseChars = (clean.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) || []).length;
  const usefulLines = clean.split(/\n/).filter((line) => cleanLine(line).length >= 2).length;
  const hasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(clean) ? 25 : 0;
  const hasPhone = /\d{2,4}[-\s.]\d{2,4}[-\s.]\d{3,4}/.test(clean) ? 16 : 0;
  const hasCompany = new RegExp(`(${jp.company}|Inc\\.?|Ltd\\.?|Co\\.?|Corporation|LLC)`, "i").test(clean) ? 24 : 0;
  return confidence + japaneseChars * 2 + usefulLines * 5 + hasEmail + hasPhone + hasCompany;
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
  showToast("OCR complete. Please choose/check company candidates before saving.");
}

function renderCompanyCandidates(candidates) {
  elements.companyCandidates.innerHTML = "";
  candidates.slice(0, 6).forEach((candidate) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "candidate-chip";
    button.textContent = candidate.text;
    button.addEventListener("click", () => {
      elements.company.value = candidate.text;
      showToast("Company filled from candidate.");
    });
    elements.companyCandidates.append(button);
  });
}

function parseBusinessCard(text) {
  const lines = normalizeOcrText(text).split(/\r?\n/).map(cleanLine).filter(Boolean);
  const joined = lines.join(" ");
  const email = joined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
  const website = findWebsite(lines);
  const phone = joined.match(/(?:\+?\d{1,3}[-\s.]*)?(?:\(?0\d{1,4}\)?[-\s.]*)?\d{2,4}[-\s.]\d{2,4}[-\s.]\d{3,4}/)?.[0] ?? "";
  const address = lines.find((line) => new RegExp(`(${jp.address}|-\\d)`).test(line) && !line.includes("@")) ?? "";
  const title = lines.find((line) => new RegExp(`(${jp.title}|Manager|Director|CEO|CTO|Sales|Marketing|Engineer)`, "i").test(line)) ?? "";
  const companyCandidates = findCompanyCandidates(lines, { email, phone, website, address, title });
  const company = companyCandidates[0]?.text ?? "";
  const companyConfidence = companyCandidates[0]?.score ?? 0;
  const name = findLikelyName(lines, { email, phone, website, address, company, title });
  return { name, company, companyConfidence, companyCandidates, title, email, phone, website, address };
}

function findWebsite(lines) {
  const line = lines.find((item) => !item.includes("@") && /(?:https?:\/\/|www\.)[A-Z0-9.-]+\.[A-Z]{2,}(?:\/\S*)?/i.test(item));
  return line?.match(/(?:https?:\/\/|www\.)[A-Z0-9.-]+\.[A-Z]{2,}(?:\/\S*)?/i)?.[0] ?? "";
}

function findCompanyCandidates(lines, known) {
  const companyWords = new RegExp(`(${jp.company}|Inc\\.?|Ltd\\.?|Co\\.?|Corporation|Company|LLC|GmbH|Group|Holdings)`, "i");
  const weakCompanyWords = new RegExp(`(${jp.weakCompany}|LAB|STUDIO|DESIGN|SYSTEM|SOLUTION)`, "i");
  const titleWords = new RegExp(`(${jp.title}|Manager|Director|CEO|CTO)`, "i");
  const rejectedValues = new Set(Object.values(known).filter(Boolean));

  return lines
    .map((line, index) => {
      const text = cleanLine(line);
      let score = 0;
      if (!text || rejectedValues.has(text)) return null;
      if (text.includes("@") || /TEL|FAX|Mobile|Phone|E-mail|Email/i.test(text)) return null;
      if (/https?:|www\.|^\d+$/.test(text)) return null;
      if (companyWords.test(text)) score += 12;
      if (weakCompanyWords.test(text)) score += 5;
      if (/[A-Z][A-Z0-9&., -]{2,}/.test(text)) score += 2;
      if (/[\u4e00-\u9fff]{2,}/.test(text)) score += 2;
      if (index <= 4) score += 3;
      if (text.length >= 3 && text.length <= 38) score += 2;
      if (/\d{3,}/.test(text)) score -= 4;
      if (titleWords.test(text)) score -= 5;
      return score > 1 ? { text, score } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

function findLikelyName(lines, known) {
  const rejected = new Set(Object.values(known).filter(Boolean));
  const companyWords = new RegExp(`(${jp.company}|Inc\\.?|Ltd\\.?|Co\\.?)`, "i");
  const candidates = lines.filter((line) => {
    if (rejected.has(line)) return false;
    if (line.includes("@") || /https?:|www\.|\d{3,}/i.test(line)) return false;
    if (companyWords.test(line) || /TEL|FAX|Mail|Email/i.test(line)) return false;
    return line.length >= 2 && line.length <= 28;
  });
  return candidates[0] ?? "";
}

function normalizeOcrText(text) {
  return String(text)
    .replace(/[|｜]/g, "I")
    .replace(/[―–—]/g, "-")
    .replace(/[　\t]+/g, " ")
    .replace(/\r/g, "")
    .trim();
}

function cleanLine(line) {
  return String(line).replace(/\s+/g, " ").replace(/^[・:：,，.。-\s]+|[・:：,，.。-\s]+$/g, "").trim();
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
  showToast("Saved.");
}

function deleteActiveCard() {
  if (!activeId) return;
  const card = cards.find((item) => item.id === activeId);
  if (!card) return;
  const hasContent = fields.some((field) => card[field]) || card.image || card.rawText;
  if (hasContent && !window.confirm("Delete this card?")) return;
  cards = cards.filter((item) => item.id !== activeId);
  activeId = cards[0]?.id ?? null;
  persist();
  render();
  activeId ? loadCard(activeId) : resetForm();
  showToast("Deleted.");
}

function createBlankCard() {
  const card = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), rawText: "", image: "" };
  fields.forEach((field) => {
    card[field] = "";
  });
  cards.unshift(card);
  activeId = card.id;
  persist();
  resetForm();
  render();
  showToast("New card created.");
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
  const visibleCards = cards.filter((card) => fields.map((field) => card[field]).join(" ").toLowerCase().includes(query));
  elements.cardList.innerHTML = "";
  visibleCards.forEach((card) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `list-item${card.id === activeId ? " active" : ""}`;
    item.innerHTML = `<strong>${escapeHtml(card.name || "No name")}</strong><span>${escapeHtml(card.company || card.email || "No details")}</span>`;
    item.addEventListener("click", () => loadCard(card.id));
    elements.cardList.append(item);
  });
  if (!visibleCards.length) {
    const empty = document.createElement("div");
    empty.className = "list-item";
    empty.innerHTML = "<strong>No cards</strong><span>Try another search</span>";
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
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
