const MIN_MULTI_TEAMS = 2;
const MAX_MULTI_TEAMS = 12;
const TEAM_LETTERS = ["A", "B", "C"];
const NAV_KEYS = new Set([
  "Backspace",
  "Delete",
  "Tab",
  "Escape",
  "Enter",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);
const TEAM_NAME_PATTERN = /[^\p{L}\p{N} @#_.\-]/gu;
const DIGIT_PATTERN = /\D/g;

const $ = {
  gameType: document.getElementById("gameType"),
  scoreboard: document.getElementById("scoreboard"),
  multiControls: document.getElementById("multiControls"),
  teamsSetsDivider: document.querySelector(".toolbar-divider--teams"),
  teamCount: document.getElementById("teamCount"),
  addTeamBtn: document.getElementById("addTeamBtn"),
  removeTeamBtn: document.getElementById("removeTeamBtn"),
  resetBtn: document.getElementById("resetBtn"),
  themeToggle: document.getElementById("themeToggle"),
  setBar: document.getElementById("setBar"),
  setNav: document.getElementById("setNav"),
  setNumber: document.getElementById("setNumber"),
  setPrev: document.getElementById("setPrev"),
  setNext: document.getElementById("setNext"),
  gameStatus: document.getElementById("gameStatus"),
  totalSets: document.getElementById("totalSets"),
  winningPoint: document.getElementById("winningPoint"),
  scoreIncrement: document.getElementById("scoreIncrement"),
  scoreDecrement: document.getElementById("scoreDecrement"),
  scorePenalty: document.getElementById("scorePenalty"),
  allowNegative: document.getElementById("allowNegative"),
};

const DEFAULT_TEAMS = {
  2: createTeams(2, "letter"),
  3: createTeams(3, "letter"),
  multi: createTeams(4, "number"),
};

const SCORE_DELTAS = {
  increment: () => scoreIncrement,
  decrement: () => -scoreDecrement,
  penalty: () => (isPenaltyEnabled() ? -scorePenalty : null),
};

const NUMERIC_INPUTS = [
  { el: () => $.totalSets, maxLen: 2, commit: () => setTotalSets($.totalSets.value) },
  { el: () => $.winningPoint, maxLen: 3, commit: () => setWinningPoint($.winningPoint.value) },
  {
    el: () => $.scoreIncrement,
    maxLen: 2,
    commit: () => setScoreStep("increment", $.scoreIncrement.value),
  },
  {
    el: () => $.scoreDecrement,
    maxLen: 2,
    commit: () => setScoreStep("decrement", $.scoreDecrement.value),
  },
  {
    el: () => $.scorePenalty,
    maxLen: 2,
    commit: () => setScoreStep("penalty", $.scorePenalty.value),
  },
];

const STORED_SETTINGS = [
  {
    key: "scoreboard-winning-point",
    apply(raw) {
      winningPoint = parseBoundedInt(raw, { maxLen: 3, fallback: 0, max: 999 });
      syncWinningPointInput();
    },
  },
  {
    key: "scoreboard-increment",
    apply(raw) {
      applyScoreStep("increment", parseStepValue(raw));
    },
  },
  {
    key: "scoreboard-decrement",
    apply(raw) {
      applyScoreStep("decrement", parseStepValue(raw));
    },
  },
  {
    key: "scoreboard-penalty",
    apply(raw) {
      applyScoreStep("penalty", parsePenaltyValue(raw));
    },
  },
  {
    key: "scoreboard-allow-negative",
    apply(raw) {
      setAllowNegative(raw === "1");
    },
  },
  {
    key: "scoreboard-total-sets",
    apply(raw) {
      totalSets = parseTotalSets(raw);
      $.totalSets.value = String(totalSets);
    },
  },
];

let teams = structuredClone(DEFAULT_TEAMS["2"]);
let currentMode = "2";
let currentSet = 1;
let totalSets = 3;
let winningPoint = 21;
let scoreIncrement = 1;
let scoreDecrement = 1;
let scorePenalty = 1;
let allowNegative = false;
let scoresBySet = {};
let fitFrame = 0;

function createTeams(count, naming) {
  return Array.from({ length: count }, (_, i) => ({
    name: teamNameForIndex(i, naming === "letter"),
    score: 0,
  }));
}

function teamNameForIndex(index, preferLetters = currentMode !== "multi") {
  if (preferLetters && index < TEAM_LETTERS.length) {
    return `Team ${TEAM_LETTERS[index]}`;
  }
  return `Team ${index + 1}`;
}

function defaultTeamName(index) {
  return teamNameForIndex(index);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeTeamName(raw) {
  return String(raw).replace(TEAM_NAME_PATTERN, "");
}

function sanitizeDigits(raw, maxLen = 3) {
  return String(raw).replace(DIGIT_PATTERN, "").slice(0, maxLen);
}

function parseBoundedInt(value, { maxLen = 3, fallback, min = 0, max = 999 }) {
  const digits = sanitizeDigits(value, maxLen);
  if (!digits) return fallback;
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function parseWinningPoint(value) {
  return parseBoundedInt(value, { maxLen: 3, fallback: 0, max: 999 });
}

function parseStepValue(value) {
  return parseBoundedInt(value, { maxLen: 2, fallback: 1, min: 1, max: 99 });
}

function parsePenaltyValue(value) {
  return parseBoundedInt(value, { maxLen: 2, fallback: 1, max: 99 });
}

function parseTotalSets(value) {
  return parseBoundedInt(value, { maxLen: 2, fallback: 3, max: 99 });
}

function isPenaltyEnabled() {
  return scorePenalty > 1;
}

function syncStepInput(input, value) {
  input.value = value === 1 ? "" : String(value);
}

function applySanitizedValue(input, sanitizer, value = input.value) {
  const sanitized = sanitizer(value);
  if (input.value !== sanitized) input.value = sanitized;
  return sanitized;
}

function getClipboardText(event) {
  return (event.clipboardData || window.clipboardData).getData("text");
}

function computeGameState() {
  const winners = new Set();
  if (!winningPoint || teams.length < 2) {
    return { winners, deuce: false, gameOver: false };
  }

  let max = -Infinity;
  let second = -Infinity;
  for (const { score } of teams) {
    if (score >= max) {
      second = max;
      max = score;
    } else if (score > second) {
      second = score;
    }
  }
  if (second === -Infinity) second = max;

  for (let i = 0; i < teams.length; i++) {
    const score = teams[i].score;
    const rival = score >= max ? second : max;
    if (score >= winningPoint && score - rival >= 2) winners.add(i);
  }

  const deuce =
    winners.size === 0 && max >= winningPoint - 1 && max - second < 2;

  return { winners, deuce, gameOver: winners.size > 0 };
}

function teamCardFlags(index, state) {
  const winner = state.winners.has(index);
  const deuce =
    !winner && state.deuce && teams[index].score >= winningPoint - 1;
  return { winner, deuce };
}

function teamCardClass(index, state) {
  const { winner, deuce } = teamCardFlags(index, state);
  const classes = ["team-card"];
  if (winner) classes.push("team-card--winner");
  else if (deuce) classes.push("team-card--deuce");
  return classes.join(" ");
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("scoreboard-theme", theme);
}

function initTheme() {
  const saved = localStorage.getItem("scoreboard-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));
}

function syncWinningPointInput() {
  $.winningPoint.value = winningPoint > 0 ? String(winningPoint) : "";
}

function initScoreSettings() {
  for (const { key, apply } of STORED_SETTINGS) {
    const saved = localStorage.getItem(key);
    if (saved !== null) apply(saved);
  }
}

function clampScore(value) {
  return allowNegative ? value : Math.max(0, value);
}

function setWinningPoint(value) {
  winningPoint = parseWinningPoint(value);
  syncWinningPointInput();
  localStorage.setItem("scoreboard-winning-point", String(winningPoint));
  updateSetDisplay();
  syncGameUi();
}

function applyScoreStep(step, value) {
  if (step === "increment") scoreIncrement = value;
  else if (step === "decrement") scoreDecrement = value;
  else scorePenalty = value;

  const input = $[`score${step[0].toUpperCase()}${step.slice(1)}`];
  syncStepInput(input, value);
}

function setScoreStep(step, rawValue) {
  const parse = step === "penalty" ? parsePenaltyValue : parseStepValue;
  const value = parse(rawValue);
  applyScoreStep(step, value);
  localStorage.setItem(`scoreboard-${step}`, String(value));
  if (step === "penalty") syncGameUi();
}

function setAllowNegative(checked) {
  allowNegative = checked;
  $.allowNegative.checked = checked;
  localStorage.setItem("scoreboard-allow-negative", checked ? "1" : "0");
}

function bindNumericInput(input, { maxLen = 3, onCommit }) {
  input.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || NAV_KEYS.has(e.key)) return;
    if (!/^\d$/.test(e.key)) e.preventDefault();
  });
  input.addEventListener("input", () =>
    applySanitizedValue(input, (v) => sanitizeDigits(v, maxLen))
  );
  input.addEventListener("paste", (e) => {
    e.preventDefault();
    input.value = sanitizeDigits(getClipboardText(e), maxLen);
  });
  input.addEventListener("change", onCommit);
  input.addEventListener("blur", onCommit);
}

function multiGridLayout(count) {
  if (count <= 3) return { cols: count, rows: 1 };
  if (count === 4) return { cols: 2, rows: 2 };
  if (count <= 6) return { cols: 3, rows: 2 };
  if (count <= 9) return { cols: 3, rows: 3 };
  return { cols: 4, rows: 3 };
}

function saveCurrentSetScores() {
  scoresBySet[currentSet] = teams.map((t) => t.score);
}

function fitScoreDisplay(el) {
  const zone = el.closest(".score-zone");
  if (!zone) return;

  el.style.removeProperty("font-size");

  const maxW = zone.clientWidth;
  const maxH = zone.clientHeight;
  if (maxW <= 0 || maxH <= 0) return;

  let size = parseFloat(getComputedStyle(el).fontSize);
  if (!Number.isFinite(size) || size <= 0) return;

  el.style.fontSize = `${size}px`;

  const minSize = Math.max(12, size * 0.25);
  while ((el.scrollWidth > maxW || el.scrollHeight > maxH) && size > minSize) {
    size *= 0.92;
    el.style.fontSize = `${size}px`;
  }
}

function fitAllScoreDisplays() {
  $.scoreboard.querySelectorAll(".score-display").forEach(fitScoreDisplay);
}

function scheduleFitScoreDisplays() {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => {
    fitFrame = requestAnimationFrame(fitAllScoreDisplays);
  });
}

function loadSetScores() {
  const saved = scoresBySet[currentSet];
  teams.forEach((team, i) => {
    team.score = saved?.[i] ?? 0;
  });
}

function hideGameStatus() {
  $.gameStatus.classList.add("hidden");
  $.gameStatus.textContent = "";
  $.gameStatus.removeAttribute("data-state");
}

function updateGameStatus(state = computeGameState()) {
  if (!winningPoint || state.gameOver) {
    hideGameStatus();
    return;
  }

  $.gameStatus.classList.remove("hidden");
  if (state.deuce) {
    $.gameStatus.textContent = "DEUCE — win by 2";
    $.gameStatus.dataset.state = "deuce";
  } else {
    $.gameStatus.textContent = `First to ${winningPoint}`;
    $.gameStatus.dataset.state = "play";
  }
}

function syncGameUi(state = computeGameState()) {
  const penaltyOff = state.gameOver || !isPenaltyEnabled();

  $.scoreboard.querySelectorAll(".team-card").forEach((card) => {
    const index = Number(card.dataset.index);
    const { winner, deuce } = teamCardFlags(index, state);
    card.classList.toggle("team-card--winner", winner);
    card.classList.toggle("team-card--deuce", deuce);
  });

  $.scoreboard.querySelectorAll(".score-btn").forEach((btn) => {
    btn.disabled = btn.classList.contains("score-btn--penalty")
      ? penaltyOff
      : state.gameOver;
  });

  updateGameStatus(state);
}

function updateBoardLayout() {
  const boardClass =
    currentMode === "multi" ? "board--multi" : `board--${currentMode}`;
  $.scoreboard.className = `board ${boardClass}`;
  $.scoreboard.dataset.teams = String(teams.length);

  if (currentMode === "multi") {
    const { cols, rows } = multiGridLayout(teams.length);
    $.scoreboard.style.setProperty("--cols", cols);
    $.scoreboard.style.setProperty("--rows", rows);
  } else {
    $.scoreboard.style.removeProperty("--cols");
    $.scoreboard.style.removeProperty("--rows");
  }
}

function renderTeamCard(team, index, state) {
  const label = escapeHtml(team.name);
  const removeBtn =
    teams.length > MIN_MULTI_TEAMS
      ? `<button type="button" class="team-remove" data-action="remove-team" data-index="${index}" aria-label="Remove ${label}">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z"/>
        </svg>
      </button>`
      : "";

  return `
    <article class="${teamCardClass(index, state)}" data-index="${index}">
      <input
        type="text"
        class="team-name"
        value="${label}"
        aria-label="Team ${index + 1} name"
        maxlength="32"
      />
      <div class="score-zone">
        <div class="score-display" aria-live="polite">${team.score}</div>
        ${removeBtn}
      </div>
      <div class="score-actions">
        <button type="button" class="score-btn score-btn--minus" data-action="decrement" data-index="${index}" aria-label="Decrease ${label} score">−</button>
        <button type="button" class="score-btn score-btn--penalty" data-action="penalty" data-index="${index}" aria-label="Penalty ${label}">P</button>
        <button type="button" class="score-btn score-btn--plus" data-action="increment" data-index="${index}" aria-label="Increase ${label} score">+</button>
      </div>
    </article>`;
}

function render() {
  updateBoardLayout();
  const state = computeGameState();
  $.scoreboard.innerHTML = teams
    .map((team, index) => renderTeamCard(team, index, state))
    .join("");
  updateMultiButtons();
  syncGameUi(state);
  scheduleFitScoreDisplays();
}

function setMultiControlsVisible(visible) {
  $.multiControls.classList.toggle("hidden", !visible);
  $.teamsSetsDivider?.classList.toggle("hidden", !visible);
}

function setMode(mode) {
  currentMode = mode;
  teams = structuredClone(DEFAULT_TEAMS[mode]);
  currentSet = 1;
  scoresBySet = {};
  setMultiControlsVisible(mode === "multi");
  updateSetDisplay();
  render();
}

function updateScore(index, action) {
  const state = computeGameState();
  if (state.gameOver) return;

  const deltaFn = SCORE_DELTAS[action];
  if (!deltaFn) return;

  const delta = deltaFn();
  if (delta === null) return;

  teams[index].score = clampScore(teams[index].score + delta);
  saveCurrentSetScores();

  const display = $.scoreboard.querySelector(
    `.team-card[data-index="${index}"] .score-display`
  );
  if (display) {
    display.textContent = teams[index].score;
    fitScoreDisplay(display);
  }

  syncGameUi(computeGameState());
}

function updateSetDisplay() {
  const showSetNav = totalSets > 1;
  const showBar = showSetNav || winningPoint > 0;

  $.setBar.classList.toggle("hidden", !showBar);
  $.setNav.classList.toggle("hidden", !showSetNav);

  if (showSetNav) {
    $.setNumber.textContent = `${currentSet} / ${totalSets}`;
    $.setPrev.disabled = currentSet <= 1;
    $.setNext.disabled = currentSet >= totalSets;
  }

  updateGameStatus();
}

function pruneScoresBySet() {
  for (const key of Object.keys(scoresBySet)) {
    if (Number(key) > totalSets) delete scoresBySet[key];
  }
}

function switchToSet(set) {
  saveCurrentSetScores();
  currentSet = set;
  loadSetScores();
  updateSetDisplay();
  render();
}

function goToSet(set) {
  if (set < 1 || set > totalSets || set === currentSet) return;
  switchToSet(set);
}

function setTotalSets(value) {
  totalSets = parseTotalSets(value);
  $.totalSets.value = String(totalSets);
  localStorage.setItem("scoreboard-total-sets", String(totalSets));
  pruneScoresBySet();

  if (totalSets < 1 && currentSet !== 1) switchToSet(1);
  else if (totalSets >= 1 && currentSet > totalSets) switchToSet(totalSets);
  else updateSetDisplay();
}

function resetScores() {
  teams.forEach((team) => {
    team.score = 0;
  });
  saveCurrentSetScores();
  render();
}

function resizeScoresBySet(count) {
  for (const key of Object.keys(scoresBySet)) {
    const saved = scoresBySet[key];
    if (!saved) continue;
    if (saved.length < count) {
      scoresBySet[key] = saved.concat(Array(count - saved.length).fill(0));
    } else if (saved.length > count) {
      scoresBySet[key] = saved.slice(0, count);
    }
  }
}

function addTeam() {
  if (currentMode !== "multi" || teams.length >= MAX_MULTI_TEAMS) return;
  teams.push({ name: defaultTeamName(teams.length), score: 0 });
  resizeScoresBySet(teams.length);
  saveCurrentSetScores();
  render();
}

function removeTeamAt(index) {
  if (teams.length <= MIN_MULTI_TEAMS) return;
  teams.splice(index, 1);
  for (const key of Object.keys(scoresBySet)) {
    const saved = scoresBySet[key];
    if (saved) scoresBySet[key] = saved.filter((_, i) => i !== index);
  }
  saveCurrentSetScores();
  render();
}

function removeTeam() {
  removeTeamAt(teams.length - 1);
}

function updateMultiButtons() {
  if ($.teamCount) $.teamCount.textContent = String(teams.length);

  const multi = currentMode === "multi";
  $.addTeamBtn.disabled = multi && teams.length >= MAX_MULTI_TEAMS;
  $.removeTeamBtn.disabled = multi && teams.length <= MIN_MULTI_TEAMS;
}

function commitTeamName(input) {
  const index = Number(input.closest(".team-card").dataset.index);
  const name = sanitizeTeamName(input.value.trim()) || defaultTeamName(index);
  teams[index].name = name;
  input.value = name;
}

function bindEvents() {
  $.gameType.addEventListener("change", (e) => setMode(e.target.value));

  $.scoreboard.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || btn.disabled) return;

    const { action, index } = btn.dataset;
    if (action === "remove-team") removeTeamAt(Number(index));
    else updateScore(Number(index), action);
  });

  $.scoreboard.addEventListener("focusin", (e) => {
    if (!e.target.matches(".team-name")) return;
    const input = e.target;
    const index = Number(input.closest(".team-card").dataset.index);
    input.dataset.editing = "true";
    input.value = teams[index].name;
    requestAnimationFrame(() => input.select());
  });

  $.scoreboard.addEventListener("input", (e) => {
    if (!e.target.matches(".team-name")) return;
    applySanitizedValue(e.target, sanitizeTeamName);
  });

  $.scoreboard.addEventListener("paste", (e) => {
    if (!e.target.matches(".team-name")) return;
    e.preventDefault();
    const input = e.target;
    const pasted = sanitizeTeamName(getClipboardText(e));
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = sanitizeTeamName(
      input.value.slice(0, start) + pasted + input.value.slice(end)
    );
  });

  $.scoreboard.addEventListener("focusout", (e) => {
    if (!e.target.matches(".team-name") || e.target.dataset.editing !== "true") {
      return;
    }
    delete e.target.dataset.editing;
    commitTeamName(e.target);
  });

  $.resetBtn.addEventListener("click", resetScores);
  $.setPrev.addEventListener("click", () => goToSet(currentSet - 1));
  $.setNext.addEventListener("click", () => goToSet(currentSet + 1));

  for (const { el, maxLen, commit } of NUMERIC_INPUTS) {
    bindNumericInput(el(), { maxLen, onCommit: commit });
  }

  $.allowNegative.addEventListener("change", (e) =>
    setAllowNegative(e.target.checked)
  );

  $.multiControls.addEventListener("click", (e) => {
    const target = e.target.closest("#addTeamBtn, #removeTeamBtn");
    if (!target || target.disabled) return;
    e.preventDefault();
    if (target.id === "addTeamBtn") addTeam();
    else removeTeam();
  });

  $.themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    applyTheme(current === "dark" ? "light" : "dark");
  });

  new ResizeObserver(scheduleFitScoreDisplays).observe($.scoreboard);
}

bindEvents();
initTheme();
initScoreSettings();
setTotalSets(3);
setMode("2");
