const $ = id => document.getElementById(id);
const state = { stream: null, timer: null, busy: false, file: null, mode: 'camera' };
const video = $('video'), preview = $('preview');

function status(message) { $('status').textContent = message; }
function tab(mode) {
  state.mode = mode;
  $('cameraPane').hidden = mode !== 'camera'; $('uploadPane').hidden = mode !== 'upload';
  $('cameraTab').classList.toggle('selected', mode === 'camera');
  $('uploadTab').classList.toggle('selected', mode === 'upload');
  if (mode === 'upload') stopCamera();
  status(mode === 'camera' ? 'Mở camera để quan sát dụng cụ.' : 'Chọn ảnh để phân tích.');
}
function clearOverlay() { for (const id of ['cameraOverlay', 'imageOverlay']) { const c = $(id); c.getContext('2d').clearRect(0, 0, c.width, c.height); } }
function stopCamera() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  if (state.stream) state.stream.getTracks().forEach(track => track.stop());
  state.stream = null; video.srcObject = null; clearOverlay();
  $('cameraEmpty').hidden = false; $('startCamera').disabled = false;
  $('stopCamera').disabled = true; $('capture').disabled = true;
  $('cameraState').textContent = 'Sẵn sàng';
}
async function startCamera() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Trình duyệt không hỗ trợ camera hoặc trang chưa dùng localhost/HTTPS.');
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = state.stream; await video.play();
    $('cameraEmpty').hidden = true; $('startCamera').disabled = true;
    $('stopCamera').disabled = false; $('capture').disabled = false;
    $('cameraState').textContent = 'Camera đang bật'; status('Camera đã sẵn sàng. Nhấn “Phân tích khung hình”.');
    updateAutoScan();
  } catch (error) { status(`Không mở được camera: ${error.message}`); stopCamera(); }
}
function updateAutoScan() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  if (state.stream && $('autoScan').checked) state.timer = setInterval(() => { if (!state.busy) capture(); }, 3000);
}
function draw(canvas, media, result) {
  canvas.width = result.width; canvas.height = result.height;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
  // The media uses object-fit: contain; canvas has the same intrinsic aspect ratio.
  ctx.lineWidth = Math.max(3, canvas.width / 250); ctx.font = `bold ${Math.max(15, canvas.width / 45)}px Segoe UI, sans-serif`;
  result.detections.forEach(item => {
    const [x1, y1, x2, y2] = item.box, label = `${item.label} ${Math.round(item.confidence * 100)}%`;
    ctx.strokeStyle = '#11d7a2'; ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    const width = ctx.measureText(label).width + 16, height = Math.max(25, canvas.width / 32);
    const top = y1 > height ? y1 - height : y1;
    ctx.fillStyle = '#0c765d'; ctx.fillRect(x1, top, width, height);
    ctx.fillStyle = '#fff'; ctx.fillText(label, x1 + 8, top + height * .72);
  });
}
function el(tag, text, className) { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }
function list(parent, heading, values, ordered = false) {
  parent.append(el('h4', heading)); const element = document.createElement(ordered ? 'ol' : 'ul');
  values.forEach(value => element.append(el('li', value))); parent.append(element);
}
function show(result, source) {
  $('resultEmpty').hidden = true; $('resultContent').hidden = false;
  const detectionRoot = $('detections'); detectionRoot.replaceChildren();
  if (!result.detections.length) detectionRoot.append(el('p', 'Chưa nhận diện được dụng cụ.'));
  result.detections.forEach(item => {
    const chip = el('span', `${item.label} · ${Math.round(item.confidence * 100)}%`, 'chip'); detectionRoot.append(chip);
  });
  const root = $('suggestion'); root.replaceChildren(); const suggestion = result.suggestion;
  if (!suggestion.title) { root.append(el('p', suggestion.message || 'Chưa có gợi ý.', 'source')); }
  else {
    const article = el('article', '', 'lesson'); article.append(el('h3', suggestion.title));
    article.append(el('p', suggestion.reason)); article.append(el('h4', 'Mục tiêu'));
    article.append(el('p', suggestion.objective)); list(article, 'Các bước tham khảo', suggestion.steps, true);
    list(article, 'An toàn khi thực hành', suggestion.safety);
    article.append(el('p', `Nguồn: ${suggestion.source}. ${result.data_notice}`, 'source'));
    root.append(article);
  }
  draw(source === 'camera' ? $('cameraOverlay') : $('imageOverlay'), source === 'camera' ? video : preview, result);
  status(result.detections.length ? `Đã nhận diện ${result.detections.length} vùng dụng cụ.` : 'Chưa thấy dụng cụ. Hãy thử ảnh rõ và đủ sáng hơn.');
}
async function analyze(blob, filename, source) {
  if (state.busy) return;
  state.busy = true; status('Đang nhận diện và tìm bài học…'); $('cameraState').textContent = 'Đang xử lý';
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45000);
  try {
    const data = new FormData(); data.append('file', blob, filename);
    const response = await fetch('/api/analyze', { method: 'POST', body: data, signal: controller.signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'Máy chủ chưa thể xử lý ảnh.');
    show(result, source);
  } catch (error) { status(error.name === 'AbortError' ? 'Quá thời gian xử lý. Hãy thử lại.' : `Có lỗi: ${error.message}`); }
  finally { clearTimeout(timer); state.busy = false; $('cameraState').textContent = state.stream ? 'Camera đang bật' : 'Sẵn sàng'; }
}
function capture() {
  if (!state.stream || !video.videoWidth || state.busy) return;
  const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  canvas.toBlob(blob => { if (blob) analyze(blob, 'camera.jpg', 'camera'); }, 'image/jpeg', .85);
}
$('cameraTab').onclick = () => tab('camera'); $('uploadTab').onclick = () => tab('upload');
$('startCamera').onclick = startCamera; $('stopCamera').onclick = stopCamera; $('capture').onclick = capture;
$('autoScan').onchange = updateAutoScan;
$('fileInput').onchange = event => {
  const file = event.target.files?.[0]; if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { status('Chọn ảnh JPG, PNG hoặc WebP dưới 10 MB.'); return; }
  state.file = file; const url = URL.createObjectURL(file);
  preview.onload = () => { URL.revokeObjectURL(url); clearOverlay(); };
  preview.src = url; preview.hidden = false; $('dropzone').hidden = true;
  $('analyzeUpload').disabled = false; status(`Đã chọn ${file.name}. Nhấn “Phân tích ảnh”.`);
};
$('analyzeUpload').onclick = () => { if (state.file) analyze(state.file, state.file.name, 'upload'); };
window.addEventListener('pagehide', stopCamera);
