const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const rowsInput = document.getElementById("rows");
const ballsInput = document.getElementById("balls");
const startBtn = document.getElementById("start");
const resetBtn = document.getElementById("reset");
const statusEl = document.getElementById("status");
const dropColumnEl = document.getElementById("drop-column");
const droppedEl = document.getElementById("dropped");

const STAT_CELLS = [
  { totalEl: document.getElementById("stat-unhit-pegs-total"), currentEl: document.getElementById("stat-unhit-pegs"), total: (s) => s.totalPegs, current: (s) => s.unhitPegs },
  { totalEl: document.getElementById("stat-empty-bins-total"), currentEl: document.getElementById("stat-empty-bins"), total: (s) => s.totalBins, current: (s) => s.emptyBins },
  { totalEl: document.getElementById("stat-hit-pegs-total"), currentEl: document.getElementById("stat-hit-pegs"), total: (s) => s.totalPegs, current: (s) => s.hitPegs },
  { totalEl: document.getElementById("stat-filled-bins-total"), currentEl: document.getElementById("stat-filled-bins"), total: (s) => s.totalBins, current: (s) => s.filledBins },
];

const PADDING = { top: 40, right: 30, bottom: 90, left: 30 };
const BALL_RADIUS = 5;
const PEG_RADIUS = 4;
const BIN_GAP = 2;
const FUNNEL_HIT_RADIUS = 24;
const MIN_BIN_PATH_BALLS = 2;
const LAST_N_PATH_COUNT = 10;
const REPLAY_SPEED = 5;
const UNTOUCHED_PEG_COLOR = "#94a3b8";

const TRACE_STYLE = {
  cyan: { color: "#22d3ee", glow: "rgba(34, 211, 238, 0.28)", lineWidth: 2 },
  pink: { color: "#f472b6", glow: "rgba(244, 114, 182, 0.28)", lineWidth: 2 },
};

let rows = 12;
let dropColumn = 6;
let pegs = [];
let bins = [];
let activeBalls = [];
let droppedCount = 0;
let animationId = null;
let isDraggingDrop = false;
let dropPointerMoved = false;
let boardWidth = 0;
let boardHeight = 0;
let pegSpacingX = 0;
let pegSpacingY = 0;
let binWidth = 0;
let hoveredPeg = null;
let selectedBin = null;
let binTraceMode = "most-common";
let replayState = null;
let replayAnimationId = null;

const pegHitCounts = new Map();
const binPathStats = new Map();
const binPathHistory = new Map();
const binRowPegCounts = new Map();
const binTransitionCounts = new Map();

// --- Geometry ----------------------------------------------------------------

function boardCenterX() {
  return PADDING.left + (pegSpacingX * (rows + 2)) / 2;
}

function centerDropColumn() {
  return Math.round(rows / 2);
}

function dropX() {
  return dropColumn === centerDropColumn() ? boardCenterX() : binCenterX(dropColumn);
}

function clampDropColumn(col) {
  return Math.max(0, Math.min(rows, col));
}

function columnFromX(x) {
  return clampDropColumn(Math.round((x - PADDING.left) / pegSpacingX - 1));
}

function binCenterX(binIndex) {
  return PADDING.left + pegSpacingX * (binIndex + 1);
}

function binLeftX(binIndex) {
  return binCenterX(binIndex) - binWidth / 2;
}

function binTopY() {
  return PADDING.top + pegSpacingY * (rows + 1) + 10;
}

function pegKey(row, col) {
  return `${row},${col}`;
}

function parsePegKey(key) {
  const [row, col] = key.split(",").map(Number);
  return { row, col };
}

function isFirstPeg(row, col) {
  return row === 0 && col === 0;
}

function pegFromKey(key) {
  const { row, col } = parsePegKey(key);
  return pegs.find((p) => p.row === row && p.col === col);
}

function keysToPegs(keys) {
  return keys.map((key) => pegFromKey(key)).filter(Boolean);
}

function buildBoardGeometry() {
  rows = Number(rowsInput.value);
  const numBins = rows + 1;
  const innerWidth = boardWidth - PADDING.left - PADDING.right;
  const innerHeight = boardHeight - PADDING.top - PADDING.bottom;

  pegSpacingX = innerWidth / (rows + 2);
  pegSpacingY = innerHeight / (rows + 1);
  binWidth = pegSpacingX - BIN_GAP;

  pegs = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= r; c++) {
      pegs.push({
        x: PADDING.left + pegSpacingX * (c + 1 + (rows - r) / 2),
        y: PADDING.top + pegSpacingY * (r + 1),
        row: r,
        col: c,
      });
    }
  }

  dropColumn = clampDropColumn(dropColumn);
  updateDropColumnLabel();

  if (bins.length !== numBins) {
    bins = Array.from({ length: numBins }, () => 0);
  }
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const displayWidth = canvas.clientWidth;
  const displayHeight = Math.round(displayWidth * 0.85);

  canvas.width = displayWidth * dpr;
  canvas.height = displayHeight * dpr;
  canvas.style.height = `${displayHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  boardWidth = displayWidth;
  boardHeight = displayHeight;
  buildBoardGeometry();
  draw();
}

// --- Map helpers -------------------------------------------------------------

function incrementCount(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function getOrCreateNestedMap(outerMap, outerKey) {
  if (!outerMap.has(outerKey)) outerMap.set(outerKey, new Map());
  return outerMap.get(outerKey);
}

function tallyPegKeys(entries) {
  const counts = new Map();
  entries.forEach(({ pegPath }) => {
    pegPath.forEach((key) => incrementCount(counts, key));
  });
  return counts;
}

// --- Peg statistics ----------------------------------------------------------

function recordPegHit(row, col) {
  if (!isFirstPeg(row, col)) incrementCount(pegHitCounts, pegKey(row, col));
}

function getPegHits(row, col) {
  return pegHitCounts.get(pegKey(row, col)) || 0;
}

function getPegHeatRange() {
  let max = 0;
  let min = Infinity;

  pegHitCounts.forEach((count) => {
    if (count > max) max = count;
    if (count > 0 && count < min) min = count;
  });

  return { peak: max, low: min === Infinity ? 0 : min };
}

function getBoardStatistics() {
  let unhitPegs = 0;
  let hitPegs = 0;

  pegs.forEach(({ row, col }) => {
    if (isFirstPeg(row, col)) return;
    if (getPegHits(row, col) === 0) unhitPegs += 1;
    else hitPegs += 1;
  });

  let emptyBins = 0;
  let filledBins = 0;
  bins.forEach((count) => {
    if (count === 0) emptyBins += 1;
    else filledBins += 1;
  });

  const totalPegs = pegs.filter((peg) => !isFirstPeg(peg.row, peg.col)).length;
  return { unhitPegs, hitPegs, emptyBins, filledBins, totalPegs, totalBins: bins.length };
}

function updateStatisticsTable() {
  const stats = getBoardStatistics();
  STAT_CELLS.forEach(({ totalEl, currentEl, total, current }) => {
    totalEl.textContent = String(total(stats));
    currentEl.textContent = String(current(stats));
  });
}

function getHottestPegPerRow() {
  return Array.from({ length: rows }, (_, r) => {
    const rowPegs = pegs.filter((peg) => peg.row === r);
    return rowPegs.reduce((best, peg) =>
      getPegHits(peg.row, peg.col) > getPegHits(best.row, best.col) ? peg : best
    );
  });
}

// --- Path tracking -----------------------------------------------------------

function trackBallPeg(ball, row, col) {
  ball.pegPath.push(pegKey(row, col));
}

function recordBinPath(binIndex, pegPath, sourceDropColumn) {
  if (pegPath.length === 0) return;

  const pathKey = pegPath.join("|");
  incrementCount(getOrCreateNestedMap(binPathStats, binIndex), pathKey);

  if (!binPathHistory.has(binIndex)) binPathHistory.set(binIndex, []);
  binPathHistory.get(binIndex).push({ pegPath: [...pegPath], dropColumn: sourceDropColumn });

  const rowCounts = getOrCreateNestedMap(binRowPegCounts, binIndex);
  pegPath.forEach((key) => incrementCount(rowCounts, key));

  const transitions = getOrCreateNestedMap(binTransitionCounts, binIndex);
  for (let i = 0; i < pegPath.length - 1; i++) {
    incrementCount(transitions, `${pegPath[i]}->${pegPath[i + 1]}`);
  }
}

function clearPathData() {
  pegHitCounts.clear();
  binPathStats.clear();
  binPathHistory.clear();
  binRowPegCounts.clear();
  binTransitionCounts.clear();
}

function getFilteredHistory(binIndex) {
  return (binPathHistory.get(binIndex) || []).filter((entry) => entry.dropColumn === dropColumn);
}

function buildPathCountsFromHistory(history) {
  const counts = new Map();
  history.forEach(({ pegPath }) => incrementCount(counts, pegPath.join("|")));
  return counts;
}

function getPathCountsForMode(binIndex) {
  return binTraceMode === "drop-column"
    ? buildPathCountsFromHistory(getFilteredHistory(binIndex))
    : binPathStats.get(binIndex) || new Map();
}

function pickPathFromCounts(pathCounts, pick = "max", minBalls = 1) {
  if (pathCounts.size === 0) return { pegs: [], count: 0, pathKey: null };

  let chosenKey = null;
  let chosenCount = pick === "max" ? -1 : Infinity;

  pathCounts.forEach((count, pathKey) => {
    const isBetter = pick === "max" ? count > chosenCount : count < chosenCount;
    if (isBetter) {
      chosenCount = count;
      chosenKey = pathKey;
    }
  });

  const keys = chosenKey ? chosenKey.split("|") : [];
  const belowMin = pick === "max" && chosenCount < minBalls;
  return {
    pegs: belowMin ? [] : keysToPegs(keys),
    count: chosenCount === Infinity ? 0 : chosenCount,
    pathKey: chosenKey,
  };
}

function getPerRowConsensusFromRowCounts(rowCounts) {
  const path = [];

  for (let r = 0; r < rows; r++) {
    let bestKey = null;
    let bestCount = -1;

    rowCounts.forEach((count, key) => {
      if (parsePegKey(key).row !== r || count <= bestCount) return;
      bestCount = count;
      bestKey = key;
    });

    const peg = bestKey ? pegFromKey(bestKey) : null;
    if (peg) path.push(peg);
  }

  return path;
}

function getPerRowConsensusPath(binIndex) {
  const rowCounts =
    binTraceMode === "drop-column"
      ? tallyPegKeys(getFilteredHistory(binIndex))
      : binRowPegCounts.get(binIndex) || new Map();
  return getPerRowConsensusFromRowCounts(rowCounts);
}

function getAveragePath(binIndex) {
  const history = binTraceMode === "drop-column" ? getFilteredHistory(binIndex) : binPathHistory.get(binIndex) || [];
  if (history.length === 0) return [];

  const path = [];
  for (let r = 0; r < rows; r++) {
    let weightedCol = 0;
    let totalWeight = 0;

    history.forEach(({ pegPath }) => {
      const key = pegPath.find((entry) => parsePegKey(entry).row === r);
      if (!key) return;
      weightedCol += parsePegKey(key).col;
      totalWeight += 1;
    });

    if (totalWeight === 0) continue;

    const col = Math.min(r, Math.round(weightedCol / totalWeight));
    const peg = pegs.find((p) => p.row === r && p.col === col);
    if (peg) path.push(peg);
  }

  return path;
}

function getMarkovPath(binIndex) {
  const start = pickPathFromCounts(getPathCountsForMode(binIndex), "max", 1);
  if (start.pegs.length === 0) return [];

  const path = [start.pegs[0]];
  const transitions = binTransitionCounts.get(binIndex) || new Map();

  while (path[path.length - 1].row < rows - 1) {
    const current = path[path.length - 1];
    const prefix = `${pegKey(current.row, current.col)}->`;
    let bestNextKey = null;
    let bestCount = -1;

    transitions.forEach((count, transitionKey) => {
      if (!transitionKey.startsWith(prefix) || count <= bestCount) return;
      bestCount = count;
      bestNextKey = transitionKey.slice(prefix.length);
    });

    if (bestNextKey) {
      const nextPeg = pegFromKey(bestNextKey);
      if (nextPeg) {
        path.push(nextPeg);
        continue;
      }
    }

    const next = getPerRowConsensusPath(binIndex).find((peg) => peg.row > current.row);
    if (!next || path.some((peg) => peg.row === next.row && peg.col === next.col)) break;
    path.push(next);
  }

  return path;
}

function pathScore(keys) {
  return keys.reduce((sum, key) => sum + parsePegKey(key).col, 0);
}

function getExtremePath(binIndex, direction) {
  const pathCounts = getPathCountsForMode(binIndex);
  if (pathCounts.size === 0) return { pegs: [], count: 0 };

  let chosenKey = null;
  let chosenCount = 0;
  let chosenScore = direction === "shortest" ? Infinity : -Infinity;

  pathCounts.forEach((count, pathKey) => {
    const score = pathScore(pathKey.split("|"));
    const isBetter = direction === "shortest" ? score < chosenScore : score > chosenScore;
    if (isBetter) {
      chosenScore = score;
      chosenKey = pathKey;
      chosenCount = count;
    }
  });

  return { pegs: keysToPegs(chosenKey.split("|")), count: chosenCount };
}

function getLastNConsensusPath(binIndex) {
  const recent = (binPathHistory.get(binIndex) || []).slice(-LAST_N_PATH_COUNT);
  return getPerRowConsensusFromRowCounts(tallyPegKeys(recent));
}

function getOverlayPaths(binIndex) {
  const pathCounts = getPathCountsForMode(binIndex);
  let maxCount = 0;
  pathCounts.forEach((count) => {
    if (count > maxCount) maxCount = count;
  });

  const traces = [];
  pathCounts.forEach((count, pathKey) => {
    const pegPath = keysToPegs(pathKey.split("|"));
    if (pegPath.length === 0) return;
    const weight = maxCount > 0 ? count / maxCount : 0;
    traces.push({
      pegs: pegPath,
      opacity: 0.12 + weight * 0.55,
      lineWidth: 1 + weight * 2,
    });
  });

  return traces;
}

function appendBinEndpoint(binIndex, pegPath) {
  if (pegPath.length === 0) return [];
  return [...pegPath, { x: binCenterX(binIndex), y: binTopY() + 10 }];
}

function addHighlightKeys(targetSet, pegPath) {
  pegPath.forEach((peg) => {
    if (peg.row !== undefined) targetSet.add(pegKey(peg.row, peg.col));
  });
}

function pushTrace(render, binIndex, pegPath, style, tooltip) {
  if (pegPath.length === 0) return false;
  render.traces.push({ points: appendBinEndpoint(binIndex, pegPath), ...style });
  addHighlightKeys(render.highlightKeys, pegPath);
  if (tooltip) render.tooltip = tooltip;
  return true;
}

function ballLabel(count) {
  return `${count} ball${count === 1 ? "" : "s"}`;
}

function getBinTraceRender(binIndex) {
  const totalInBin = bins[binIndex];
  const render = {
    traces: [],
    highlightKeys: new Set(),
    tooltip: `Bin ${binIndex} · drop balls to trace paths`,
  };

  if (totalInBin === 0) return render;

  const pathCounts = getPathCountsForMode(binIndex);
  const handlers = {
    "most-common": () => {
      const { pegs: pegPath, count } = pickPathFromCounts(pathCounts, "max", MIN_BIN_PATH_BALLS);
      if (pushTrace(render, binIndex, pegPath, TRACE_STYLE.cyan, `Most common exact · ${count}/${totalInBin} balls`)) return;
      if (count === 1) render.tooltip = `Need ${MIN_BIN_PATH_BALLS}+ balls on same path`;
    },
    "per-row": () => {
      pushTrace(render, binIndex, getPerRowConsensusPath(binIndex), TRACE_STYLE.cyan, `Per-row consensus · ${totalInBin} balls`);
    },
    average: () => {
      pushTrace(render, binIndex, getAveragePath(binIndex), TRACE_STYLE.cyan, `Average path · ${totalInBin} balls`);
    },
    overlay: () => {
      getOverlayPaths(binIndex).forEach(({ pegs: pegPath, opacity, lineWidth }) => {
        render.traces.push({
          points: appendBinEndpoint(binIndex, pegPath),
          color: `rgba(34, 211, 238, ${opacity})`,
          glow: `rgba(34, 211, 238, ${opacity * 0.35})`,
          lineWidth,
        });
      });
      addHighlightKeys(render.highlightKeys, getPerRowConsensusPath(binIndex));
      render.tooltip = `Weighted overlay · ${pathCounts.size} paths`;
    },
    markov: () => {
      pushTrace(render, binIndex, getMarkovPath(binIndex), TRACE_STYLE.cyan, `Markov probable · ${totalInBin} balls`);
    },
    shortest: () => {
      const { pegs: pegPath, count } = getExtremePath(binIndex, "shortest");
      pushTrace(render, binIndex, pegPath, TRACE_STYLE.cyan, `Shortest route · ${ballLabel(count)}`);
    },
    longest: () => {
      const { pegs: pegPath, count } = getExtremePath(binIndex, "longest");
      pushTrace(render, binIndex, pegPath, TRACE_STYLE.cyan, `Longest route · ${ballLabel(count)}`);
    },
    "last-n": () => {
      const used = Math.min(LAST_N_PATH_COUNT, (binPathHistory.get(binIndex) || []).length);
      pushTrace(render, binIndex, getLastNConsensusPath(binIndex), TRACE_STYLE.cyan, `Last ${used} balls consensus`);
    },
    replay: () => {
      const { pegs: pegPath, count } = pickPathFromCounts(pathCounts, "max", 1);
      if (pegPath.length > 0) {
        addHighlightKeys(render.highlightKeys, pegPath);
        render.tooltip = `Animated replay · ${ballLabel(count)}`;
      }
    },
    compare: () => {
      const common = pickPathFromCounts(pathCounts, "max", 1);
      const rare = pickPathFromCounts(pathCounts, "min", 1);
      pushTrace(render, binIndex, common.pegs, TRACE_STYLE.cyan);
      if (rare.pegs.length > 0 && rare.pathKey !== common.pathKey) {
        pushTrace(render, binIndex, rare.pegs, TRACE_STYLE.pink);
      }
      render.tooltip = `Most (${common.count}) vs rarest (${rare.count})`;
    },
    "drop-column": () => {
      const filteredCount = getFilteredHistory(binIndex).length;
      const pegPath = getPerRowConsensusPath(binIndex);
      if (pegPath.length > 0 && filteredCount > 0) {
        pushTrace(render, binIndex, pegPath, TRACE_STYLE.cyan, `Drop column ${dropColumn} · ${filteredCount} balls`);
      } else {
        render.tooltip = `No paths from drop column ${dropColumn}`;
      }
    },
  };

  (handlers[binTraceMode] || handlers["most-common"])();
  return render;
}

// --- Rendering ---------------------------------------------------------------

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function lerpColor(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function pegHeatColor(hits, minHits, maxHits) {
  if (hits === 0) return UNTOUCHED_PEG_COLOR;
  if (maxHits === minHits) return "#ef4444";
  const t = (hits - minHits) / (maxHits - minHits);
  return lerpColor("#22c55e", "#ef4444", t);
}

function getPegVisuals(peg, heatRange) {
  const hits = getPegHits(peg.row, peg.col);
  const heat = heatRange.peak > 0 && hits > 0
    ? (hits - heatRange.low) / Math.max(heatRange.peak - heatRange.low, 1)
    : 0;

  return {
    hits,
    heat,
    radius: hits > 0 ? PEG_RADIUS + heat * 3 : PEG_RADIUS,
    fill: isFirstPeg(peg.row, peg.col) || hits === 0 ? UNTOUCHED_PEG_COLOR : pegHeatColor(hits, heatRange.low, heatRange.peak),
  };
}

function drawTooltip(label, centerX, topY, strokeColor) {
  ctx.font = "12px system-ui, sans-serif";
  const padX = 8;
  const boxW = ctx.measureText(label).width + padX * 2;
  const boxH = 22;
  const boxX = Math.max(4, Math.min(boardWidth - boxW - 4, centerX - boxW / 2));
  const boxY = Math.max(4, topY);

  ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#f8fafc";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, boxX + boxW / 2, boxY + boxH / 2);
}

function drawPathTrace(path, color, glowColor, lineWidth = 2) {
  if (path.length < 2) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);

  ctx.strokeStyle = glowColor;
  ctx.lineWidth = lineWidth + 6;
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}

function drawBall(x, y, fill, stroke) {
  ctx.beginPath();
  ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawPegHeatLegend(peakHits) {
  const legendX = PADDING.left;
  const legendY = 14;
  const legendW = 120;
  const legendH = 8;

  for (let i = 0; i < legendW; i++) {
    ctx.fillStyle = lerpColor("#22c55e", "#ef4444", i / (legendW - 1));
    ctx.fillRect(legendX + i, legendY, 1, legendH);
  }

  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 1;
  ctx.strokeRect(legendX, legendY, legendW, legendH);

  ctx.font = "10px system-ui, sans-serif";
  ctx.fillStyle = "#22c55e";
  ctx.textAlign = "left";
  ctx.fillText("Low", legendX, legendY - 4);
  ctx.fillStyle = "#ef4444";
  ctx.textAlign = "right";
  ctx.fillText(peakHits > 0 ? `High (${peakHits})` : "High", legendX + legendW, legendY - 4);
}

function draw() {
  updateStatisticsTable();
  ctx.clearRect(0, 0, boardWidth, boardHeight);

  const binTop = binTopY();
  const maxBinCount = Math.max(...bins, 1);
  const heatRange = getPegHeatRange();
  const binTraceRender = selectedBin !== null ? getBinTraceRender(selectedBin) : null;
  const hottestKeys = new Set(getHottestPegPerRow().map((peg) => pegKey(peg.row, peg.col)));

  bins.forEach((count, i) => {
    const x = binLeftX(i);
    const barHeight = (count / maxBinCount) * 60;
    const isSelectedBin = selectedBin === i;
    const isDropColumn = i === dropColumn;

    ctx.fillStyle = isSelectedBin ? "#0ea5e9" : isDropColumn ? "#2563eb" : "#1d4ed8";
    ctx.fillRect(x, binTop + 20 - barHeight, binWidth, barHeight);

    ctx.strokeStyle = isSelectedBin ? "#22d3ee" : isDropColumn ? "#60a5fa" : "#334155";
    ctx.lineWidth = isSelectedBin ? 2 : 1;
    ctx.strokeRect(x, binTop, binWidth, 20);

    ctx.fillStyle = "#64748b";
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(count, x + binWidth / 2, binTop + 55);
  });

  if (heatRange.peak > 0) {
    drawPathTrace(getHottestPegPerRow(), "#fbbf24", "rgba(251, 191, 36, 0.3)");
  }

  binTraceRender?.traces.forEach((trace) => {
    if (trace.points.length > 1) drawPathTrace(trace.points, trace.color, trace.glow, trace.lineWidth);
  });

  pegs.forEach((peg) => {
    const { hits, heat, radius, fill } = getPegVisuals(peg, heatRange);
    const key = pegKey(peg.row, peg.col);
    const isOnBinPath = binTraceRender?.highlightKeys.has(key);
    const isOnHeatTrace = hottestKeys.has(key);

    ctx.beginPath();
    ctx.arc(peg.x, peg.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();

    if (hits > 0) {
      ctx.strokeStyle = lerpColor("#22c55e", "#ef4444", heat);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (isOnBinPath || (isOnHeatTrace && heatRange.peak > 0 && !isFirstPeg(peg.row, peg.col))) {
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = isOnBinPath ? "#22d3ee" : "#fbbf24";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  });

  drawPegHeatLegend(heatRange.peak);

  if (hoveredPeg) {
    const { radius } = getPegVisuals(hoveredPeg, heatRange);
    const hits = getPegHits(hoveredPeg.row, hoveredPeg.col);
    const label = isFirstPeg(hoveredPeg.row, hoveredPeg.col)
      ? "Top peg (not tracked)"
      : `${hits} hit${hits === 1 ? "" : "s"}`;
    drawTooltip(label, hoveredPeg.x, hoveredPeg.y - radius - 32, "#64748b");
  } else if (selectedBin !== null && binTraceRender) {
    drawTooltip(binTraceRender.tooltip, binCenterX(selectedBin), binTop + 62, "#22d3ee");
  }

  if (replayState) drawBall(replayState.x, replayState.y, "#a855f7", "#e9d5ff");
  activeBalls.forEach((ball) => drawBall(ball.x, ball.y, "#f97316", "#fdba74"));

  const funnelX = dropX();
  const funnelY = PADDING.top - 10;

  ctx.beginPath();
  ctx.moveTo(funnelX - 14, 8);
  ctx.lineTo(funnelX + 14, 8);
  ctx.lineTo(funnelX, funnelY);
  ctx.closePath();
  ctx.fillStyle = isDraggingDrop ? "#64748b" : "#475569";
  ctx.fill();
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(funnelX, funnelY);
  ctx.lineTo(funnelX, binTop);
  ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(funnelX, 8, 5, 0, Math.PI * 2);
  ctx.fillStyle = "#38bdf8";
  ctx.fill();
}

// --- Simulation --------------------------------------------------------------

function findPegHit(laneX, prevY, nextY) {
  const hitHalfWidth = pegSpacingX * 0.42;
  let hitPeg = null;

  pegs.forEach((peg) => {
    if (peg.y < prevY - BALL_RADIUS || peg.y > nextY + BALL_RADIUS) return;
    if (Math.abs(laneX - peg.x) >= hitHalfWidth) return;
    if (!hitPeg || peg.y < hitPeg.y) hitPeg = peg;
  });

  return hitPeg;
}

function routeFromPeg(ball) {
  if (Math.random() < 0.5) ball.col += 1;

  if (ball.pegRow < rows - 1) {
    ball.pegRow += 1;
    const nextPeg = pegs.find((p) => p.row === ball.pegRow && p.col === ball.col);
    ball.targetX = nextPeg.x;
    ball.targetY = nextPeg.y;
    ball.phase = "toPeg";
  } else {
    ball.phase = "toBin";
    ball.targetX = binCenterX(ball.col);
    ball.targetY = binTopY() + 10;
  }
}

function handlePegContact(ball, row, col) {
  trackBallPeg(ball, row, col);
  recordPegHit(row, col);
  routeFromPeg(ball);
}

function createBall() {
  const x = dropX();
  return {
    x,
    y: 18,
    laneX: x,
    col: 0,
    pegRow: -1,
    phase: "freefall",
    targetX: x,
    targetY: 0,
    speed: 4,
    pegPath: [],
    dropColumnAtLaunch: dropColumn,
  };
}

function finishBall(ball) {
  const binIndex = ball.phase === "toBin" ? ball.col : columnFromX(ball.laneX);
  bins[binIndex] += 1;
  recordBinPath(binIndex, ball.pegPath, ball.dropColumnAtLaunch);
  droppedCount += 1;
  droppedEl.textContent = `Dropped: ${droppedCount}`;

  if (binTraceMode === "replay" && selectedBin === binIndex) startReplayAnimation();
  return true;
}

function advanceBall(ball) {
  if (ball.phase === "freefall") {
    const prevY = ball.y;
    ball.y += ball.speed;
    ball.x = ball.laneX;

    const hitPeg = findPegHit(ball.laneX, prevY, ball.y);
    if (hitPeg) {
      ball.y = hitPeg.y;
      ball.pegRow = hitPeg.row;
      ball.col = hitPeg.col;
      handlePegContact(ball, hitPeg.row, hitPeg.col);
      return false;
    }

    if (ball.y >= binTopY()) {
      ball.phase = "missed";
      return finishBall(ball);
    }

    return false;
  }

  const dx = ball.targetX - ball.x;
  const dy = ball.targetY - ball.y;
  const dist = Math.hypot(dx, dy);

  if (dist > ball.speed) {
    ball.x += (dx / dist) * ball.speed;
    ball.y += (dy / dist) * ball.speed;
    return false;
  }

  ball.x = ball.targetX;
  ball.y = ball.targetY;

  if (ball.phase === "toBin") return finishBall(ball);

  handlePegContact(ball, ball.pegRow, ball.col);
  return false;
}

function animate() {
  const finished = [];

  activeBalls.forEach((ball, index) => {
    if (advanceBall(ball)) finished.push(index);
  });

  for (let i = finished.length - 1; i >= 0; i--) activeBalls.splice(finished[i], 1);

  draw();

  if (activeBalls.length > 0) {
    animationId = requestAnimationFrame(animate);
  } else {
    animationId = null;
    statusEl.textContent = "Complete";
    startBtn.disabled = false;
    canvas.classList.add("can-drag-drop");
  }
}

function dropBalls() {
  const numBalls = Number(ballsInput.value);
  if (numBalls < 1 || rows < 4) return;

  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  buildBoardGeometry();
  activeBalls = [];
  statusEl.textContent = "Dropping...";
  startBtn.disabled = true;
  canvas.classList.remove("can-drag-drop", "dragging-drop");

  let launched = 0;
  const launchNext = () => {
    if (launched >= numBalls) return;
    activeBalls.push(createBall());
    launched += 1;
    if (!animationId) animationId = requestAnimationFrame(animate);
    setTimeout(launchNext, 80);
  };

  launchNext();
}

function resetBoard() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  activeBalls = [];
  droppedCount = 0;
  selectedBin = null;
  stopReplayAnimation();
  clearPathData();
  bins = Array.from({ length: Number(rowsInput.value) + 1 }, () => 0);
  droppedEl.textContent = "Dropped: 0";
  statusEl.textContent = "Ready";
  startBtn.disabled = false;
  buildBoardGeometry();
  dropColumn = centerDropColumn();
  updateDropColumnLabel();
  draw();
  canvas.classList.add("can-drag-drop");
}

// --- Replay ------------------------------------------------------------------

function stopReplayAnimation() {
  if (replayAnimationId) {
    cancelAnimationFrame(replayAnimationId);
    replayAnimationId = null;
  }
  replayState = null;
}

function getReplayPoints(binIndex) {
  const history = binPathHistory.get(binIndex) || [];
  const latest = history[history.length - 1];
  if (!latest) return [];
  return appendBinEndpoint(binIndex, keysToPegs(latest.pegPath));
}

function startReplayAnimation() {
  stopReplayAnimation();
  if (binTraceMode !== "replay" || selectedBin === null) return;

  const points = getReplayPoints(selectedBin);
  if (points.length < 2) return;

  replayState = { points, targetIndex: 1, x: points[0].x, y: points[0].y };

  const loop = () => {
    if (!replayState) return;

    const target = replayState.points[replayState.targetIndex];
    const dx = target.x - replayState.x;
    const dy = target.y - replayState.y;
    const dist = Math.hypot(dx, dy);

    if (dist <= REPLAY_SPEED) {
      replayState.x = target.x;
      replayState.y = target.y;

      if (replayState.targetIndex >= replayState.points.length - 1) {
        replayState.targetIndex = 1;
        replayState.x = replayState.points[0].x;
        replayState.y = replayState.points[0].y;
      } else {
        replayState.targetIndex += 1;
      }
    } else {
      replayState.x += (dx / dist) * REPLAY_SPEED;
      replayState.y += (dy / dist) * REPLAY_SPEED;
    }

    draw();
    replayAnimationId = requestAnimationFrame(loop);
  };

  replayAnimationId = requestAnimationFrame(loop);
}

// --- Input -------------------------------------------------------------------

function updateDropColumnLabel() {
  dropColumnEl.textContent = `Drop column: ${dropColumn}`;
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const touch = event.changedTouches?.[0] || event.touches?.[0];
  const clientX = touch ? touch.clientX : event.clientX;
  const clientY = touch ? touch.clientY : event.clientY;
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function findPegAtPoint(x, y) {
  const heatRange = getPegHeatRange();
  let closest = null;
  let closestDist = Infinity;

  pegs.forEach((peg) => {
    const { radius } = getPegVisuals(peg, heatRange);
    const dist = Math.hypot(x - peg.x, y - peg.y);
    if (dist <= radius + 6 && dist < closestDist) {
      closest = peg;
      closestDist = dist;
    }
  });

  return closest;
}

function findBinAtPoint(x, y) {
  const binTop = binTopY();
  if (y < binTop - 62 || y > binTop + 66) return null;

  for (let i = 0; i < bins.length; i++) {
    const left = binLeftX(i);
    if (x >= left && x <= left + binWidth) return i;
  }

  return null;
}

function isNearDropPoint(x, y) {
  return Math.hypot(x - dropX(), y - 8) <= FUNNEL_HIT_RADIUS;
}

function setDropColumnFromX(x) {
  const nextColumn = columnFromX(x);
  if (nextColumn === dropColumn) return;
  dropColumn = nextColumn;
  updateDropColumnLabel();
  draw();
}

function updateHover(point) {
  const peg = findPegAtPoint(point.x, point.y);
  const prevKey = hoveredPeg ? pegKey(hoveredPeg.row, hoveredPeg.col) : null;
  const nextKey = peg ? pegKey(peg.row, peg.col) : null;
  if (prevKey === nextKey) return;
  hoveredPeg = peg;
  if (!animationId) draw();
}

function updateCanvasCursor(point) {
  if (hoveredPeg || findBinAtPoint(point.x, point.y) !== null) {
    canvas.classList.remove("can-drag-drop");
    canvas.style.cursor = "pointer";
    return;
  }

  canvas.style.cursor = "";
  canvas.classList.toggle("can-drag-drop", !animationId && isNearDropPoint(point.x, point.y));
}

function toggleBinSelection(point) {
  if (isNearDropPoint(point.x, point.y)) return;

  const bin = findBinAtPoint(point.x, point.y);
  selectedBin = bin !== null ? (selectedBin === bin ? null : bin) : null;

  if (selectedBin === null) stopReplayAnimation();
  else startReplayAnimation();

  draw();
}

function setBinTraceMode(mode) {
  binTraceMode = mode;
  startReplayAnimation();
  draw();
}

function startDropDrag(event) {
  if (animationId) return;
  const point = canvasPoint(event);
  if (!isNearDropPoint(point.x, point.y)) return;

  isDraggingDrop = true;
  dropPointerMoved = false;
  canvas.classList.add("dragging-drop");
  setDropColumnFromX(point.x);
  event.preventDefault();
}

function moveDropDrag(event) {
  if (!isDraggingDrop) return;
  dropPointerMoved = true;
  setDropColumnFromX(canvasPoint(event).x);
  event.preventDefault();
}

function endDropDrag() {
  if (!isDraggingDrop) return;
  isDraggingDrop = false;
  canvas.classList.remove("dragging-drop");
  draw();
}

function handleCanvasClick(point) {
  if (dropPointerMoved) {
    dropPointerMoved = false;
    return;
  }
  toggleBinSelection(point);
}

startBtn.addEventListener("click", dropBalls);
resetBtn.addEventListener("click", resetBoard);
rowsInput.addEventListener("change", resetBoard);
window.addEventListener("resize", resizeCanvas);

document.querySelectorAll('input[name="trace-mode"]').forEach((input) => {
  input.addEventListener("change", (event) => {
    if (event.target.checked) setBinTraceMode(event.target.value);
  });
});

canvas.addEventListener("mousedown", startDropDrag);
canvas.addEventListener("mousemove", (event) => {
  if (isDraggingDrop) {
    moveDropDrag(event);
    return;
  }
  const point = canvasPoint(event);
  updateHover(point);
  updateCanvasCursor(point);
});
canvas.addEventListener("mouseleave", () => {
  if (!hoveredPeg) return;
  hoveredPeg = null;
  canvas.style.cursor = "";
  if (!animationId) draw();
});
canvas.addEventListener("click", (event) => handleCanvasClick(canvasPoint(event)));
window.addEventListener("mouseup", endDropDrag);

canvas.addEventListener("touchstart", startDropDrag, { passive: false });
canvas.addEventListener("touchmove", moveDropDrag, { passive: false });
canvas.addEventListener("touchend", (event) => {
  endDropDrag();
  handleCanvasClick(canvasPoint(event));
}, { passive: false });

resizeCanvas();
canvas.classList.add("can-drag-drop");
