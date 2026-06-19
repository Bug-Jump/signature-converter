const canvas = document.getElementById("signatureCanvas");
const frame = document.getElementById("signatureFrame");
const ctx = canvas.getContext("2d");

const modeButtons = [...document.querySelectorAll(".mode-button")];
const toolButtons = [...document.querySelectorAll(".tool-button")];
const typePanel = document.getElementById("typePanel");
const drawToolSwitch = document.getElementById("drawToolSwitch");
const drawActions = document.getElementById("drawActions");
const signatureText = document.getElementById("signatureText");
const exportWidth = document.getElementById("exportWidth");
const exportHeight = document.getElementById("exportHeight");
const penColor = document.getElementById("penColor");
const backgroundColor = document.getElementById("backgroundColor");
const penWidth = document.getElementById("penWidth");
const penWidthValue = document.getElementById("penWidthValue");
const exportFormat = document.getElementById("exportFormat");
const autoCrop = document.getElementById("autoCrop");
const transparentPng = document.getElementById("transparentPng");
const transparentPngRow = document.getElementById("transparentPngRow");
const clearButton = document.getElementById("clearButton");
const undoButton = document.getElementById("undoButton");
const redoButton = document.getElementById("redoButton");
const downloadButton = document.getElementById("downloadButton");
const previewModal = document.getElementById("previewModal");
const previewImage = document.getElementById("previewImage");
const previewMeta = document.getElementById("previewMeta");
const previewStage = document.getElementById("previewStage");
const previewCloseButton = document.getElementById("previewCloseButton");
const previewCancelButton = document.getElementById("previewCancelButton");
const previewDownloadButton = document.getElementById("previewDownloadButton");

const DEFAULT_TOOL_WIDTHS = {
  write: 6,
  erase: 25,
};
const DEFAULT_EXPORT_SIZE = {
  width: 1600,
  height: 900,
};
const CROP_PADDING = 8;
const ALPHA_THRESHOLD = 8;
const COLOR_THRESHOLD = 12;

const state = {
  mode: "type",
  tool: "write",
  exportSizeAuto: false,
  toolWidths: { ...DEFAULT_TOOL_WIDTHS },
  strokes: [],
  redoStrokes: [],
  activeStroke: null,
  clearSerial: 0,
};

let lastCanvasWidth = 0;
let lastCanvasHeight = 0;
let pendingExport = null;
let previewReturnFocus = null;

const signatureFont =
  '"STXingkai", "Xingkai SC", "Kaiti SC", "KaiTi", "STKaiti", "Songti SC", serif';

function clampNumber(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function roundToStep(value, step) {
  return Math.max(step, Math.round(value / step) * step);
}

function resizeCanvas() {
  const rect = frame.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  if (width === lastCanvasWidth && height === lastCanvasHeight) {
    render();
    return;
  }

  lastCanvasWidth = width;
  lastCanvasHeight = height;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  render();
}

function getCanvasLogicalSize() {
  const ratio = window.devicePixelRatio || 1;
  return {
    width: canvas.width ? canvas.width / ratio : lastCanvasWidth,
    height: canvas.height ? canvas.height / ratio : lastCanvasHeight,
  };
}

function getExportSize() {
  return {
    width: clampNumber(exportWidth.value, 64, 4096, DEFAULT_EXPORT_SIZE.width),
    height: clampNumber(exportHeight.value, 64, 4096, DEFAULT_EXPORT_SIZE.height),
  };
}

function getResponsiveInitialExportSize() {
  const frameWidth = frame.getBoundingClientRect().width || frame.parentElement?.clientWidth || window.innerWidth;
  const frameTop = frame.getBoundingClientRect().top || 0;
  const pagePadding = window.matchMedia("(max-width: 860px)").matches ? 14 : 24;
  const availableHeight = Math.max(260, window.innerHeight - frameTop - pagePadding);
  const naturalAspect = frameWidth / availableHeight;
  const aspect = Math.min(2.4, Math.max(0.75, naturalAspect || DEFAULT_EXPORT_SIZE.width / DEFAULT_EXPORT_SIZE.height));
  const longEdge = DEFAULT_EXPORT_SIZE.width;

  if (aspect >= 1) {
    return {
      width: longEdge,
      height: roundToStep(longEdge / aspect, 10),
    };
  }

  return {
    width: roundToStep(longEdge * aspect, 10),
    height: longEdge,
  };
}

function applyResponsiveInitialExportSize() {
  if (!state.exportSizeAuto) return;

  const { width, height } = getResponsiveInitialExportSize();
  exportWidth.value = width;
  exportHeight.value = height;
  syncFrameAspectRatio();
}

function syncFrameAspectRatio() {
  const { width, height } = getExportSize();
  frame.style.setProperty("--signature-aspect-ratio", `${width} / ${height}`);
  resizeCanvas();
}

function clearCanvas(targetCtx, width, height, fill) {
  targetCtx.clearRect(0, 0, width, height);
  if (!fill) return;
  targetCtx.fillStyle = fill;
  targetCtx.fillRect(0, 0, width, height);
}

function drawSmoothStroke(targetCtx, points, width, height, color, lineWidth, compositeOperation = "source-over") {
  if (!points.length) return;

  targetCtx.save();
  targetCtx.globalCompositeOperation = compositeOperation;
  targetCtx.strokeStyle = color;
  targetCtx.lineWidth = Math.max(1, lineWidth);
  targetCtx.lineCap = "round";
  targetCtx.lineJoin = "round";

  targetCtx.beginPath();
  targetCtx.moveTo(points[0].x * width, points[0].y * height);

  if (points.length === 1) {
    targetCtx.lineTo(points[0].x * width + 0.01, points[0].y * height + 0.01);
  } else {
    for (let i = 1; i < points.length - 1; i += 1) {
      const current = points[i];
      const next = points[i + 1];
      const cx = (current.x + next.x) * 0.5 * width;
      const cy = (current.y + next.y) * 0.5 * height;
      targetCtx.quadraticCurveTo(current.x * width, current.y * height, cx, cy);
    }
    const last = points[points.length - 1];
    targetCtx.lineTo(last.x * width, last.y * height);
  }

  targetCtx.stroke();
  targetCtx.restore();
}

function getTargetPixelRatio(targetCtx) {
  const transform = targetCtx.getTransform?.();
  if (!transform) return 1;
  return Math.max(1, Math.abs(transform.a) || 1, Math.abs(transform.d) || 1);
}

function getTypedFontSize(text, width, height) {
  const baseSize = Math.min(height * 0.48, width / Math.max(text.length * 0.72, 2));
  return Math.max(34, Math.min(baseSize, height * 0.62));
}

function drawTypedSignature(targetCtx, width, height) {
  const text = signatureText.value.trim();
  if (!text) return;

  targetCtx.save();
  targetCtx.fillStyle = penColor.value;
  targetCtx.textAlign = "center";
  targetCtx.textBaseline = "middle";

  const fontSize = getTypedFontSize(text, width, height);
  targetCtx.font = `${fontSize}px ${signatureFont}`;
  targetCtx.fillText(text, width / 2, height / 2 + fontSize * 0.04);
  targetCtx.restore();
}

function drawStrokes(targetCtx, width, height) {
  const displayWidth = lastCanvasWidth || canvas.getBoundingClientRect().width || width;
  const displayHeight = lastCanvasHeight || canvas.getBoundingClientRect().height || height;
  const displayMin = Math.min(displayWidth, displayHeight) || Math.min(width, height);
  const targetMin = Math.min(width, height);
  const pixelRatio = getTargetPixelRatio(targetCtx);
  const layer = document.createElement("canvas");
  layer.width = Math.max(1, Math.round(width * pixelRatio));
  layer.height = Math.max(1, Math.round(height * pixelRatio));
  const layerCtx = layer.getContext("2d");
  layerCtx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  const drawStroke = (stroke) => {
    const isErase = stroke.tool === "erase";
    const strokeBaseMin = stroke.baseMin || displayMin;
    const scale = targetMin / strokeBaseMin;
    drawSmoothStroke(
      layerCtx,
      stroke.points,
      width,
      height,
      isErase ? "#000000" : stroke.color,
      stroke.width * scale,
      isErase ? "destination-out" : "source-over",
    );
  };

  state.strokes.forEach(drawStroke);

  if (state.activeStroke) {
    drawStroke(state.activeStroke);
  }

  targetCtx.drawImage(layer, 0, 0, layer.width, layer.height, 0, 0, width, height);
}

function renderToContext(targetCtx, width, height, options = {}) {
  clearCanvas(targetCtx, width, height, options.transparentBackground ? "" : backgroundColor.value);

  if (state.mode === "type") {
    drawTypedSignature(targetCtx, width, height);
  } else {
    drawStrokes(targetCtx, width, height);
  }
}

function render() {
  const { width, height } = getCanvasLogicalSize();
  if (!width || !height) return;
  renderToContext(ctx, width, height);
}

function setMode(mode) {
  state.mode = mode;
  typePanel.classList.toggle("hidden", mode !== "type");
  drawToolSwitch.classList.toggle("hidden", mode !== "draw");
  drawActions.classList.toggle("hidden", mode !== "draw");
  updateCanvasCursor();

  modeButtons.forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  updateHistoryButtons();
  render();
}

function setDrawTool(tool) {
  state.toolWidths[state.tool] = Number(penWidth.value);
  state.tool = tool;
  toolButtons.forEach((button) => {
    const active = button.dataset.tool === tool;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  syncPenWidthControl();
  updateCanvasCursor();
}

function updateCanvasCursor() {
  if (state.mode !== "draw") {
    canvas.style.cursor = "default";
    return;
  }

  canvas.style.cursor = state.tool === "erase" ? "cell" : "crosshair";
}

function syncPenWidthControl() {
  const width = state.toolWidths[state.tool] ?? DEFAULT_TOOL_WIDTHS[state.tool];
  penWidth.value = String(width);
  penWidthValue.value = String(width);
}

function updateHistoryButtons() {
  const canUseHistory = state.mode === "draw";
  undoButton.disabled = !canUseHistory || !state.strokes.length;
  redoButton.disabled = !canUseHistory || !state.redoStrokes.length;
}

function undoStroke() {
  if (state.mode !== "draw" || !state.strokes.length) return;
  const stroke = state.strokes.pop();
  state.redoStrokes.push(stroke);
  updateHistoryButtons();
  render();
}

function redoStroke() {
  if (state.mode !== "draw" || !state.redoStrokes.length) return;
  const stroke = state.redoStrokes.pop();
  state.strokes.push(stroke);
  updateHistoryButtons();
  render();
}

function pointerToPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  };
}

function beginStroke(event) {
  if (state.mode !== "draw") return;
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  const logicalSize = getCanvasLogicalSize();
  state.redoStrokes = [];
  state.activeStroke = {
    baseMin: Math.max(1, Math.min(logicalSize.width, logicalSize.height)),
    color: penColor.value,
    pointerId: event.pointerId,
    serial: state.clearSerial,
    tool: state.tool,
    width: state.toolWidths[state.tool] ?? DEFAULT_TOOL_WIDTHS[state.tool],
    points: [pointerToPoint(event)],
  };
  updateHistoryButtons();
  render();
}

function moveStroke(event) {
  if (state.mode !== "draw" || !state.activeStroke || state.activeStroke.serial !== state.clearSerial) return;
  event.preventDefault();
  state.activeStroke.points.push(pointerToPoint(event));
  render();
}

function endStroke(event) {
  if (state.mode !== "draw" || !state.activeStroke || state.activeStroke.serial !== state.clearSerial) return;
  event.preventDefault();
  state.activeStroke.points.push(pointerToPoint(event));
  state.strokes.push(state.activeStroke);
  state.activeStroke = null;
  updateHistoryButtons();
  render();
}

function blockSignatureBrowserGestures(event) {
  if (event.target === canvas || frame.contains(event.target)) {
    event.preventDefault();
  }
}

let lastSignatureTouchEnd = 0;

function blockSignatureDoubleTap(event) {
  if (!(event.target === canvas || frame.contains(event.target))) return;

  const now = Date.now();
  if (now - lastSignatureTouchEnd < 350) {
    event.preventDefault();
  }
  lastSignatureTouchEnd = now;
}

function resetCanvasSurface() {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, lastCanvasWidth || Math.round(frame.getBoundingClientRect().width));
  const height = Math.max(1, lastCanvasHeight || Math.round(frame.getBoundingClientRect().height));

  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  lastCanvasWidth = width;
  lastCanvasHeight = height;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  clearCanvas(ctx, canvas.width / ratio, canvas.height / ratio, backgroundColor.value);
}

function clearCurrent() {
  state.clearSerial += 1;

  if (state.activeStroke?.pointerId !== undefined && canvas.hasPointerCapture?.(state.activeStroke.pointerId)) {
    canvas.releasePointerCapture(state.activeStroke.pointerId);
  }

  if (state.mode === "draw") {
    state.strokes = [];
    state.redoStrokes = [];
    state.activeStroke = null;
    updateHistoryButtons();
    resetCanvasSurface();
    const clearSerial = state.clearSerial;
    requestAnimationFrame(() => {
      if (state.mode === "draw" && state.clearSerial === clearSerial && !state.activeStroke && !state.strokes.length) {
        resetCanvasSurface();
      }
    });
  } else {
    signatureText.value = "";
    signatureText.focus();
    render();
  }
}

function selectDefaultSignatureText() {
  if (signatureText.value !== "张三") return;

  requestAnimationFrame(() => {
    signatureText.select();
  });
}

function getExportOptions() {
  const format = exportFormat.value;
  return {
    format,
    autoCrop: autoCrop.checked,
    transparentBackground: format === "png" && transparentPng.checked,
  };
}

function syncExportOptionAvailability() {
  const pngSelected = exportFormat.value === "png";
  transparentPng.disabled = !pngSelected;
  transparentPngRow.classList.toggle("disabled", !pngSelected);
}

function hexToRgb(value) {
  const hex = value.replace("#", "").trim();
  if (hex.length !== 6) return { r: 255, g: 255, b: 255 };
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function getContentBounds(sourceCanvas, options) {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const sourceCtx = sourceCanvas.getContext("2d");
  const pixels = sourceCtx.getImageData(0, 0, width, height).data;
  const background = hexToRgb(backgroundColor.value);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = pixels[index + 3];
      const isContent = options.transparentBackground
        ? alpha > ALPHA_THRESHOLD
        : alpha > ALPHA_THRESHOLD &&
          Math.abs(pixels[index] - background.r) +
            Math.abs(pixels[index + 1] - background.g) +
            Math.abs(pixels[index + 2] - background.b) >
            COLOR_THRESHOLD;

      if (!isContent) continue;

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < 0 || maxY < 0) return null;

  const x = Math.max(0, minX - CROP_PADDING);
  const y = Math.max(0, minY - CROP_PADDING);
  const right = Math.min(width - 1, maxX + CROP_PADDING);
  const bottom = Math.min(height - 1, maxY + CROP_PADDING);

  return {
    x,
    y,
    width: right - x + 1,
    height: bottom - y + 1,
  };
}

function cropCanvas(sourceCanvas, bounds) {
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = bounds.width;
  outputCanvas.height = bounds.height;
  const outputCtx = outputCanvas.getContext("2d");
  outputCtx.drawImage(
    sourceCanvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height,
  );
  return outputCanvas;
}

function createExportCanvas(options = getExportOptions()) {
  const { width, height } = getExportSize();
  exportWidth.value = width;
  exportHeight.value = height;

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outputCtx = outputCanvas.getContext("2d");
  renderToContext(outputCtx, width, height, {
    transparentBackground: options.transparentBackground,
  });

  const bounds = options.autoCrop ? getContentBounds(outputCanvas, options) : null;
  const finalCanvas = bounds ? cropCanvas(outputCanvas, bounds) : outputCanvas;

  return {
    canvas: finalCanvas,
    width: finalCanvas.width,
    height: finalCanvas.height,
    bounds,
    cropped: Boolean(bounds && (bounds.x || bounds.y || bounds.width !== width || bounds.height !== height)),
    sourceWidth: width,
    sourceHeight: height,
  };
}

function pointsToSvgPath(points, width, height) {
  if (!points.length) return "";
  if (points.length === 1) {
    const x = points[0].x * width;
    const y = points[0].y * height;
    return `M ${x.toFixed(2)} ${y.toFixed(2)} L ${(x + 0.01).toFixed(2)} ${(y + 0.01).toFixed(2)}`;
  }

  const commands = [`M ${(points[0].x * width).toFixed(2)} ${(points[0].y * height).toFixed(2)}`];
  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    const cx = ((current.x + next.x) * 0.5 * width).toFixed(2);
    const cy = ((current.y + next.y) * 0.5 * height).toFixed(2);
    commands.push(`Q ${(current.x * width).toFixed(2)} ${(current.y * height).toFixed(2)} ${cx} ${cy}`);
  }

  const last = points[points.length - 1];
  commands.push(`L ${(last.x * width).toFixed(2)} ${(last.y * height).toFixed(2)}`);
  return commands.join(" ");
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function createSvg(options = getExportOptions(), cropBounds = null) {
  const { width: sourceWidth, height: sourceHeight } = getExportSize();
  const viewX = cropBounds?.x ?? 0;
  const viewY = cropBounds?.y ?? 0;
  const viewWidth = cropBounds?.width ?? sourceWidth;
  const viewHeight = cropBounds?.height ?? sourceHeight;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${viewWidth}" height="${viewHeight}" viewBox="${viewX} ${viewY} ${viewWidth} ${viewHeight}">`,
  ];

  if (!options.transparentBackground) {
    parts.push(`<rect x="${viewX}" y="${viewY}" width="${viewWidth}" height="${viewHeight}" fill="${backgroundColor.value}"/>`);
  }

  if (state.mode === "type") {
    const text = escapeXml(signatureText.value.trim());
    if (text) {
      const fontSize = getTypedFontSize(text, sourceWidth, sourceHeight);
      parts.push(
        `<text x="${(sourceWidth / 2).toFixed(2)}" y="${(sourceHeight / 2 + fontSize * 0.04).toFixed(2)}" text-anchor="middle" dominant-baseline="middle" fill="${penColor.value}" font-size="${fontSize.toFixed(2)}" font-family="${escapeXml(signatureFont)}">${text}</text>`,
      );
    }
  } else {
    const displayMin =
      Math.min(lastCanvasWidth || sourceWidth, lastCanvasHeight || sourceHeight) || Math.min(sourceWidth, sourceHeight);
    const targetMin = Math.min(sourceWidth, sourceHeight);
    const visibleStrokes = state.activeStroke ? [...state.strokes, state.activeStroke] : state.strokes;
    const operations = visibleStrokes
      .map((stroke, index) => ({
        d: pointsToSvgPath(stroke.points, sourceWidth, sourceHeight),
        index,
        stroke,
        width: (stroke.width * (targetMin / (stroke.baseMin || displayMin))).toFixed(2),
      }))
      .filter((operation) => operation.d);

    let maskIndex = 0;

    operations.forEach((operation) => {
      if (operation.stroke.tool === "erase") return;

      const laterErasers = operations.filter(
        (candidate) => candidate.index > operation.index && candidate.stroke.tool === "erase",
      );
      const maskId = laterErasers.length ? `erase-mask-${maskIndex}` : "";
      maskIndex += 1;

      if (laterErasers.length) {
        parts.push(
          `<mask id="${maskId}" x="0" y="0" width="${sourceWidth}" height="${sourceHeight}" maskUnits="userSpaceOnUse">`,
          `<rect x="0" y="0" width="${sourceWidth}" height="${sourceHeight}" fill="white"/>`,
          ...laterErasers.map(
            (eraser) =>
              `<path d="${eraser.d}" fill="none" stroke="black" stroke-width="${eraser.width}" stroke-linecap="round" stroke-linejoin="round"/>`,
          ),
          `</mask>`,
        );
      }

      parts.push(
        `<path d="${operation.d}" fill="none" stroke="${operation.stroke.color || penColor.value}" stroke-width="${operation.width}" stroke-linecap="round" stroke-linejoin="round"${maskId ? ` mask="url(#${maskId})"` : ""}/>`,
      );
    });
  }

  parts.push("</svg>");
  return parts.join("");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function canvasToBlob(outputCanvas, mime, quality) {
  return new Promise((resolve) => {
    outputCanvas.toBlob(resolve, mime, quality);
  });
}

function createTimestamp() {
  return new Date().toISOString().slice(0, 19).replaceAll(":", "-");
}

function getFormatLabel(format) {
  return format === "jpeg" ? "JPEG" : format.toUpperCase();
}

function getFileExtension(format) {
  if (format === "jpeg") return "jpg";
  return format;
}

function releasePendingExport() {
  if (pendingExport?.url) {
    URL.revokeObjectURL(pendingExport.url);
  }
  pendingExport = null;
}

async function prepareExportArtifact() {
  const options = getExportOptions();
  const timestamp = createTimestamp();

  if (options.format === "svg") {
    const exportResult = createExportCanvas({
      ...options,
      transparentBackground: false,
    });
    const svg = createSvg(options, exportResult.bounds);
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });

    return {
      ...exportResult,
      autoCrop: options.autoCrop,
      blob,
      filename: `signature-${timestamp}.svg`,
      format: options.format,
      transparentBackground: false,
      url: URL.createObjectURL(blob),
    };
  }

  const exportResult = createExportCanvas(options);
  const mime = options.format === "jpeg" ? "image/jpeg" : "image/png";
  const blob = await canvasToBlob(exportResult.canvas, mime, 0.94);
  if (!blob) throw new Error("无法生成导出图片。");

  return {
    ...exportResult,
    autoCrop: options.autoCrop,
    blob,
    filename: `signature-${timestamp}.${getFileExtension(options.format)}`,
    format: options.format,
    transparentBackground: options.transparentBackground,
    url: URL.createObjectURL(blob),
  };
}

function getPreviewMetaText(artifact) {
  const cropState = artifact.autoCrop ? (artifact.cropped ? "已裁切" : "保留原尺寸") : "未裁切";
  const transparentState = artifact.transparentBackground ? "透明背景" : `背景 ${backgroundColor.value.toUpperCase()}`;
  return `${getFormatLabel(artifact.format)} · ${artifact.width} × ${artifact.height}px · ${cropState} · ${transparentState}`;
}

function showExportPreview(artifact) {
  releasePendingExport();
  pendingExport = artifact;
  previewReturnFocus = document.activeElement;
  previewImage.src = artifact.url;
  previewStage.classList.toggle("transparent", artifact.transparentBackground);
  previewMeta.textContent = getPreviewMetaText(artifact);
  previewModal.classList.remove("hidden");
  previewDownloadButton.focus();
}

function closeExportPreview() {
  previewModal.classList.add("hidden");
  previewImage.removeAttribute("src");
  releasePendingExport();
  previewReturnFocus?.focus?.();
  previewReturnFocus = null;
}

async function downloadSignature() {
  downloadButton.disabled = true;
  downloadButton.setAttribute("aria-busy", "true");

  try {
    const artifact = await prepareExportArtifact();
    showExportPreview(artifact);
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "导出预览生成失败。");
  } finally {
    downloadButton.disabled = false;
    downloadButton.removeAttribute("aria-busy");
  }
}

function confirmPreviewDownload() {
  if (!pendingExport) return;
  downloadBlob(pendingExport.blob, pendingExport.filename);
  closeExportPreview();
}

function isTextEntryTarget(target) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function handleGlobalKeydown(event) {
  if (event.key === "Escape" && !previewModal.classList.contains("hidden")) {
    event.preventDefault();
    closeExportPreview();
    return;
  }

  if (isTextEntryTarget(event.target) || !(event.metaKey || event.ctrlKey)) return;

  const key = event.key.toLowerCase();
  if (key === "z") {
    event.preventDefault();
    if (event.shiftKey) {
      redoStroke();
    } else {
      undoStroke();
    }
  } else if (key === "y") {
    event.preventDefault();
    redoStroke();
  }
}

modeButtons.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

toolButtons.forEach((button) => {
  button.addEventListener("click", () => setDrawTool(button.dataset.tool));
});

canvas.addEventListener("pointerdown", beginStroke);
canvas.addEventListener("pointermove", moveStroke);
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);
canvas.addEventListener("pointerleave", endStroke);
frame.addEventListener("contextmenu", blockSignatureBrowserGestures);
frame.addEventListener("selectstart", blockSignatureBrowserGestures);
frame.addEventListener("dragstart", blockSignatureBrowserGestures);
frame.addEventListener("touchend", blockSignatureDoubleTap, { passive: false });
frame.addEventListener("gesturestart", blockSignatureBrowserGestures);
frame.addEventListener("gesturechange", blockSignatureBrowserGestures);

[signatureText, penColor, backgroundColor].forEach((input) => {
  input.addEventListener("input", render);
});

signatureText.addEventListener("focus", selectDefaultSignatureText);
signatureText.addEventListener("click", selectDefaultSignatureText);

[exportWidth, exportHeight].forEach((input) => {
  input.addEventListener("input", (event) => {
    if (event.isTrusted) state.exportSizeAuto = false;
    syncFrameAspectRatio();
  });
  input.addEventListener("change", (event) => {
    if (event.isTrusted) state.exportSizeAuto = false;
    const { width, height } = getExportSize();
    exportWidth.value = width;
    exportHeight.value = height;
    syncFrameAspectRatio();
  });
});

penWidth.addEventListener("input", () => {
  state.toolWidths[state.tool] = Number(penWidth.value);
  penWidthValue.value = penWidth.value;
});

clearButton.addEventListener("click", clearCurrent);
undoButton.addEventListener("click", undoStroke);
redoButton.addEventListener("click", redoStroke);
downloadButton.addEventListener("click", downloadSignature);
exportFormat.addEventListener("change", syncExportOptionAvailability);
previewCloseButton.addEventListener("click", closeExportPreview);
previewCancelButton.addEventListener("click", closeExportPreview);
previewDownloadButton.addEventListener("click", confirmPreviewDownload);
previewModal.addEventListener("click", (event) => {
  if (event.target === previewModal) {
    closeExportPreview();
  }
});
document.addEventListener("keydown", handleGlobalKeydown);
window.addEventListener("resize", () => {
  if (state.exportSizeAuto) {
    applyResponsiveInitialExportSize();
    return;
  }

  resizeCanvas();
});

if ("ResizeObserver" in window) {
  new ResizeObserver(resizeCanvas).observe(frame);
}

if (document.fonts?.ready) {
  document.fonts.ready.then(render);
}

syncExportOptionAvailability();
setDrawTool("write");
setMode("type");
syncFrameAspectRatio();
resizeCanvas();
