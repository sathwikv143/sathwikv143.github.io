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
};

const DEFAULT_TEAMS = {
  2: createTeams(2, "letter"),
  3: createTeams(3, "letter"),
  multi: createTeams(4, "number"),
};

let teams = structuredClone(DEFAULT_TEAMS["2"]);
let currentMode = "2";
let currentSet = 1;
let totalSets = 3;
let winningPoint = 21;
let scoresBySet = {};

function createTeams(count, naming) {
  return Array.from({ length: count }, (_, i) => ({
    name:
      naming === "letter" && i < TEAM_LETTERS.length
        ? `Team ${TEAM_LETTERS[i]}`
        : `Team ${i + 1}`,
    score: 0,
  }));
}

function defaultTeamName(index) {
  if (currentMode === "multi") return `Team ${index + 1}`;
  return index < TEAM_LETTERS.length
    ? `Team ${TEAM_LETTERS[index]}`
    : `Team ${index + 1}`;
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

function parseWinningPoint(value) {
  const digits = sanitizeDigits(value);
  return digits ? Math.min(parseInt(digits, 10), 999) : 0;
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

  let max = 0;
  let second = 0;
  for (const { score } of teams) {
    if (score >= max) {
      second = max;
      max = score;
    } else if (score > second) {
      second = score;
    }
  }

  for (let i = 0; i < teams.length; i++) {
    const score = teams[i].score;
    let rival = 0;
    for (let j = 0; j < teams.length; j++) {
      if (j !== i) rival = Math.max(rival, teams[j].score);
    }
    if (score >= winningPoint && score - rival >= 2) winners.add(i);
  }

  const deuce =
    winners.size === 0 && max >= winningPoint - 1 && max - second < 2;

  return { winners, deuce, gameOver: winners.size > 0 };
}

function teamCardClass(index, state) {
  const classes = ["team-card"];
  if (state.winners.has(index)) classes.push("team-card--winner");
  else if (state.deuce && teams[index].score >= winningPoint - 1) {
    classes.push("team-card--deuce");
  }
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

function initWinningPoint() {
  const saved = localStorage.getItem("scoreboard-winning-point");
  if (saved !== null) {
    winningPoint = parseWinningPoint(saved);
    syncWinningPointInput();
  }
}

function setWinningPoint(value) {
  winningPoint = parseWinningPoint(value);
  syncWinningPointInput();
  localStorage.setItem("scoreboard-winning-point", String(winningPoint));
  updateSetDisplay();
  syncGameUi();
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
  $.scoreboard.querySelectorAll(".team-card").forEach((card) => {
    const index = Number(card.dataset.index);
    const inDeuce = state.deuce && teams[index].score >= winningPoint - 1;
    card.classList.toggle("team-card--winner", state.winners.has(index));
    card.classList.toggle(
      "team-card--deuce",
      !state.winners.has(index) && inDeuce
    );
  });

  $.scoreboard.querySelectorAll(".score-btn").forEach((btn) => {
    btn.disabled = state.gameOver;
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
      </div>
      <div class="score-actions">
        <button type="button" class="score-btn score-btn--minus" data-action="decrement" data-index="${index}" aria-label="Decrease ${label} score">−</button>
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
}

function setMode(mode) {
  currentMode = mode;
  teams = structuredClone(DEFAULT_TEAMS[mode]);
  currentSet = 1;
  scoresBySet = {};
  $.multiControls.classList.toggle("hidden", mode !== "multi");
  updateSetDisplay();
  render();
}

function updateScore(index, delta) {
  if (computeGameState().gameOver) return;

  teams[index].score = Math.max(0, teams[index].score + delta);
  saveCurrentSetScores();

  const display = $.scoreboard.querySelector(
    `.team-card[data-index="${index}"] .score-display`
  );
  if (display) display.textContent = teams[index].score;

  syncGameUi();
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

function goToSet(set) {
  if (set < 1 || set > totalSets || set === currentSet) return;
  saveCurrentSetScores();
  currentSet = set;
  loadSetScores();
  updateSetDisplay();
  render();
}

function setTotalSets(count) {
  totalSets = count;
  $.totalSets.value = String(count);
  pruneScoresBySet();

  if (currentSet > totalSets || (totalSets === 1 && currentSet !== 1)) {
    saveCurrentSetScores();
    currentSet = totalSets === 1 ? 1 : totalSets;
    loadSetScores();
    render();
  }

  updateSetDisplay();
}

function resetScores() {
  teams.forEach((team) => {
    team.score = 0;
  });
  saveCurrentSetScores();
  render();
}

function updateMultiButtons() {
  if (currentMode !== "multi") return;
  $.addTeamBtn.disabled = teams.length >= MAX_MULTI_TEAMS;
  $.removeTeamBtn.disabled = teams.length <= MIN_MULTI_TEAMS;
}

function commitTeamName(input) {
  const index = Number(input.closest(".team-card").dataset.index);
  const name = sanitizeTeamName(input.value.trim()) || defaultTeamName(index);
  teams[index].name = name;
  input.value = name;
  return name;
}

function bindEvents() {
  $.gameType.addEventListener("change", (e) => setMode(e.target.value));

  $.scoreboard.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || btn.disabled) return;
    updateScore(
      Number(btn.dataset.index),
      btn.dataset.action === "increment" ? 1 : -1
    );
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
  $.totalSets.addEventListener("change", (e) =>
    setTotalSets(Number(e.target.value))
  );

  const commitWinningPoint = () => setWinningPoint($.winningPoint.value);
  $.winningPoint.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || NAV_KEYS.has(e.key)) return;
    if (!/^\d$/.test(e.key)) e.preventDefault();
  });
  $.winningPoint.addEventListener("input", () =>
    applySanitizedValue($.winningPoint, sanitizeDigits)
  );
  $.winningPoint.addEventListener("paste", (e) => {
    e.preventDefault();
    $.winningPoint.value = sanitizeDigits(getClipboardText(e));
  });
  $.winningPoint.addEventListener("change", commitWinningPoint);
  $.winningPoint.addEventListener("blur", commitWinningPoint);

  $.addTeamBtn.addEventListener("click", () => {
    if (teams.length >= MAX_MULTI_TEAMS) return;
    teams.push({ name: defaultTeamName(teams.length), score: 0 });
    saveCurrentSetScores();
    render();
  });

  $.removeTeamBtn.addEventListener("click", () => {
    if (teams.length <= MIN_MULTI_TEAMS) return;
    teams.pop();
    saveCurrentSetScores();
    render();
  });

  $.themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    applyTheme(current === "dark" ? "light" : "dark");
  });
}

bindEvents();
initTheme();
initWinningPoint();
setTotalSets(3);
setMode("2");
