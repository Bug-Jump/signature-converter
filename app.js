const canvas = document.getElementById("signatureCanvas");
const frame = document.getElementById("signatureFrame");
const ctx = canvas.getContext("2d");

const modeButtons = [...document.querySelectorAll(".mode-button")];
const toolButtons = [...document.querySelectorAll(".tool-button")];
const typePanel = document.getElementById("typePanel");
const drawToolSwitch = document.getElementById("drawToolSwitch");
const signatureText = document.getElementById("signatureText");
const exportWidth = document.getElementById("exportWidth");
const exportHeight = document.getElementById("exportHeight");
const penColor = document.getElementById("penColor");
const backgroundColor = document.getElementById("backgroundColor");
const penWidth = document.getElementById("penWidth");
const penWidthValue = document.getElementById("penWidthValue");
const exportFormat = document.getElementById("exportFormat");
const clearButton = document.getElementById("clearButton");
const downloadButton = document.getElementById("downloadButton");

const DEFAULT_TOOL_WIDTHS = {
  write: 6,
  erase: 25,
};
const DEFAULT_EXPORT_SIZE = {
  width: 1200,
  height: 600,
};

const state = {
  mode: "type",
  tool: "write",
  exportSizeAuto: true,
  toolWidths: { ...DEFAULT_TOOL_WIDTHS },
  strokes: [],
  activeStroke: null,
  clearSerial: 0,
};

let lastCanvasWidth = 0;
let lastCanvasHeight = 0;

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

function drawTypedSignature(targetCtx, width, height) {
  const text = signatureText.value.trim();
  if (!text) return;

  targetCtx.save();
  targetCtx.fillStyle = penColor.value;
  targetCtx.textAlign = "center";
  targetCtx.textBaseline = "middle";

  const baseSize = Math.min(height * 0.48, width / Math.max(text.length * 0.72, 2));
  const fontSize = Math.max(34, Math.min(baseSize, height * 0.62));
  targetCtx.font = `${fontSize}px ${signatureFont}`;
  targetCtx.fillText(text, width / 2, height / 2 + fontSize * 0.04);
  targetCtx.restore();
}

function drawStrokes(targetCtx, width, height) {
  const displayWidth = lastCanvasWidth || canvas.getBoundingClientRect().width || width;
  const displayHeight = lastCanvasHeight || canvas.getBoundingClientRect().height || height;
  const scale = Math.min(width, height) / Math.min(displayWidth, displayHeight);
  const pixelRatio = getTargetPixelRatio(targetCtx);
  const layer = document.createElement("canvas");
  layer.width = Math.max(1, Math.round(width * pixelRatio));
  layer.height = Math.max(1, Math.round(height * pixelRatio));
  const layerCtx = layer.getContext("2d");
  layerCtx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  const drawStroke = (stroke) => {
    const isErase = stroke.tool === "erase";
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

function renderToContext(targetCtx, width, height) {
  clearCanvas(targetCtx, width, height, backgroundColor.value);

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
  updateCanvasCursor();

  modeButtons.forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

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
  state.activeStroke = {
    color: penColor.value,
    pointerId: event.pointerId,
    serial: state.clearSerial,
    tool: state.tool,
    width: state.toolWidths[state.tool] ?? DEFAULT_TOOL_WIDTHS[state.tool],
    points: [pointerToPoint(event)],
  };
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
    state.activeStroke = null;
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

function createExportCanvas() {
  const { width, height } = getExportSize();
  exportWidth.value = width;
  exportHeight.value = height;

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outputCtx = outputCanvas.getContext("2d");
  renderToContext(outputCtx, width, height);
  return outputCanvas;
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

function createSvg() {
  const { width, height } = getExportSize();
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="${backgroundColor.value}"/>`,
  ];

  if (state.mode === "type") {
    const text = escapeXml(signatureText.value.trim());
    if (text) {
      const fontSize = Math.max(34, Math.min(Math.min(height * 0.48, width / Math.max(text.length * 0.72, 2)), height * 0.62));
      parts.push(
        `<text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" fill="${penColor.value}" font-size="${fontSize.toFixed(2)}" font-family="${escapeXml(signatureFont)}">${text}</text>`,
      );
    }
  } else {
    const displayMin = Math.min(lastCanvasWidth || width, lastCanvasHeight || height) || Math.min(width, height);
    const scale = Math.min(width, height) / displayMin;
    const operations = state.strokes
      .map((stroke, index) => ({
        d: pointsToSvgPath(stroke.points, width, height),
        index,
        stroke,
        width: (stroke.width * scale).toFixed(2),
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
          `<mask id="${maskId}" maskUnits="userSpaceOnUse">`,
          `<rect width="100%" height="100%" fill="white"/>`,
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
  URL.revokeObjectURL(url);
}

function downloadSignature() {
  const format = exportFormat.value;
  const timestamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");

  if (format === "svg") {
    const svg = createSvg();
    downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `signature-${timestamp}.svg`);
    return;
  }

  const outputCanvas = createExportCanvas();
  const mime = format === "jpeg" ? "image/jpeg" : "image/png";
  outputCanvas.toBlob(
    (blob) => {
      if (!blob) return;
      downloadBlob(blob, `signature-${timestamp}.${format === "jpeg" ? "jpg" : "png"}`);
    },
    mime,
    0.94,
  );
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
downloadButton.addEventListener("click", downloadSignature);
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

setDrawTool("write");
setMode("type");
applyResponsiveInitialExportSize();
resizeCanvas();
