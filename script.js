// ==========================
// Firebase 初期化
// ==========================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get, update, onValue, push, remove }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBEWNu7AuQQ_oUQZR77xyGeRtgpIhNdJK4",
  authDomain: "trpg-system-ee177.firebaseapp.com",
  databaseURL: "https://trpg-system-ee177-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "trpg-system-ee177",
  storageBucket: "trpg-system-ee177.firebasestorage.app",
  messagingSenderId: "655219643861",
  appId: "1:655219643861:web:7bdebec9990e94e7cc595c"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ==========================
// 状態
// ==========================
let isGM = null;
let myPlayerId = null;
let roomId = null;

let scenarioData = {};
let currentNodeId = "start";
let charData = {
  name: "", job: "", age: "",
  skills: [
    { name: "聞き耳", base: 60, current: 60 },
    { name: "目星",   base: 50, current: 50 }
  ]
};

const defaultScenario = {
  start: {
    text: "古い屋敷の一室にいる。",
    gmText: "壁の向こうに隠し通路がある。",
    judge: { skill: "聞き耳", success: "secret", failure: "nothing" }
  },
  secret: { text: "隠し通路を発見した。", gmText: "この先に敵が潜んでいる。" },
  nothing: { text: "特に変わった様子はない。" }
};

// ==========================
// 画面管理
// ==========================
window.showScreen = function(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
};

function roomRef(path) {
  return ref(db, `rooms/${roomId}/${path}`);
}

// ==========================
// ルームID生成
// ==========================
function generateRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function showRoomId() {
  ["roomIdDisplay","roomIdDisplayPL","roomIdDisplayPlay","roomIdDisplayPLPlay"].forEach(elId => {
    const el = document.getElementById(elId);
    if (el) el.textContent = `ルームID：${roomId}`;
  });
}

// ==========================
// 初期化
// ==========================
window.onload = () => {
  scenarioData = JSON.parse(JSON.stringify(defaultScenario));

  document.getElementById("gmBtn").onclick = startAsGM;
  document.getElementById("plBtn").onclick = () => showScreen("screenJoinRoom");
  document.getElementById("joinRoomBtn").onclick = joinRoom;
  document.getElementById("gmStartBtn").onclick = startGMPlay;
  document.getElementById("plReadyBtn").onclick = startPLPlay;
  document.getElementById("judgeBtn").onclick = sendJudgeRequest;
  document.getElementById("skillSelect").onchange = onSkillChange;
  document.getElementById("loadFileInput").onchange = loadSaveFile;

  renderNodes();
  renderSkills();
};

// ==========================
// GM：ルーム作成
// ==========================
async function startAsGM() {
  isGM = true;
  roomId = generateRoomId();
  showRoomId();

  // Firebaseにルームを作成
  await set(ref(db, `rooms/${roomId}`), {
    status: "editing",
    currentNodeId: "start",
    scenario: scenarioData,
    log: "",
    players: {}
  });

  showScreen("screenGMEdit");
  addLog(`GMとしてルーム作成：${roomId}`);
}

// ==========================
// PL：ルーム参加
// ==========================
async function joinRoom() {
  const inputId = document.getElementById("roomIdInput").value.trim().toUpperCase();
  const errEl = document.getElementById("joinRoomError");
  errEl.textContent = "";

  if (!inputId) { errEl.textContent = "ルームIDを入力してください"; return; }

  const snap = await get(ref(db, `rooms/${inputId}`));
  if (!snap.exists()) {
    errEl.textContent = "ルームが見つかりません。IDを確認してください。";
    return;
  }

  roomId = inputId;
  isGM = false;
  myPlayerId = "pl_" + Date.now();
  showRoomId();

  // シナリオをFirebaseから読み込む
  const roomData = snap.val();
  if (roomData.scenario) scenarioData = roomData.scenario;

  showScreen("screenPLEdit");
}

// ==========================
// GM：プレイ開始
// ==========================
async function startGMPlay() {
  // 最新のシナリオをFirebaseに保存
  await update(ref(db, `rooms/${roomId}`), {
    scenario: scenarioData,
    status: "playing",
    currentNodeId: "start"
  });

  showScreen("screenGMPlay");
  setTurnStatus("🛠 GMモード：進行を開始してください", "gm");
  renderCurrentNode();
  listenRoom();
}

// ==========================
// PL：準備完了
// ==========================
async function startPLPlay() {
  saveCharFromFields();

  // PLをFirebaseに登録
  await set(ref(db, `rooms/${roomId}/players/${myPlayerId}`), {
    name: charData.name || "名無し",
    skills: charData.skills,
    joined: true
  });

  showScreen("screenPLPlay");
  setTurnStatus("🎭 PLモード", "pl");

  // 技能セレクト
  const skillSelect = document.getElementById("skillSelect");
  skillSelect.innerHTML = '<option value="">技能を選択</option>';
  charData.skills.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.name;
    opt.textContent = `${s.name} (${s.current})`;
    skillSelect.appendChild(opt);
  });
  skillSelect.disabled = false;

  document.getElementById("plDisabledReason").textContent = "技能を選択すると判定できます";

  addLog2(`参加：${charData.name}`);
  listenRoom();
}

// ==========================
// Firebase リアルタイム監視
// ==========================
function listenRoom() {
  // シーン更新を監視
  onValue(ref(db, `rooms/${roomId}/currentNodeId`), snap => {
    if (!snap.exists()) return;
    const nodeId = snap.val();
    if (!isGM && nodeId) {
      const node = scenarioData[nodeId];
      if (node) {
        document.getElementById("plStoryText").textContent = node.text || "";
        addLog2(`[シーン更新] ${node.text}`);
      }
    }
  });

  // ログ監視
  onValue(ref(db, `rooms/${roomId}/log`), snap => {
    if (!snap.exists()) return;
    // ログはGM/PL両方に反映
    if (isGM) {
      document.getElementById("logText").textContent = snap.val();
    }
  });

  // PL一覧監視（GMのみ）
  if (isGM) {
    onValue(ref(db, `rooms/${roomId}/players`), snap => {
      const plListEl = document.getElementById("plList");
      plListEl.innerHTML = "";
      if (!snap.exists()) return;
      Object.entries(snap.val()).forEach(([id, pl]) => {
        const div = document.createElement("div");
        div.className = "pl-list-item";
        div.textContent = `🎭 ${pl.name}`;
        plListEl.appendChild(div);
      });
    });

    // 判定キュー監視（GMのみ）
    onValue(ref(db, `rooms/${roomId}/judgeQueue`), snap => {
      renderJudgeQueueFromFirebase(snap.exists() ? snap.val() : {});
    });
  }

  // 判定結果監視（PLのみ）
  if (!isGM && myPlayerId) {
    onValue(ref(db, `rooms/${roomId}/judgeResults/${myPlayerId}`), snap => {
      if (!snap.exists()) return;
      const result = snap.val();
      if (result.resolved) {
        addLog2(`【${result.result}】${result.skill}：${result.roll}/${result.target}`);
        document.getElementById("judgeBtn").disabled = false;
        setPLEnabled();
        // 受け取ったら削除
        remove(ref(db, `rooms/${roomId}/judgeResults/${myPlayerId}`));
      }
    });
  }
}

// ==========================
// ターンステータス
// ==========================
function setTurnStatus(text, mode) {
  ["turnStatusGM","turnStatusPL"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = "turn-status";
    if (mode) el.classList.add("turn-" + mode);
  });
}

// ==========================
// ログ
// ==========================
function addLog(text) {
  const el = document.getElementById("logText");
  if (el) el.textContent += text + "\n";
  if (roomId && isGM) {
    const current = document.getElementById("logText")?.textContent || "";
    set(ref(db, `rooms/${roomId}/log`), current);
  }
}

function addLog2(text) {
  const el = document.getElementById("logText2");
  if (el) el.textContent += text + "\n";
}

// ==========================
// 技能選択
// ==========================
function onSkillChange() {
  const val = document.getElementById("skillSelect").value;
  document.getElementById("judgeBtn").disabled = !val;
}

// ==========================
// 判定リクエスト（PL → Firebase）
// ==========================
async function sendJudgeRequest() {
  const skillName = document.getElementById("skillSelect").value;
  if (!skillName || !myPlayerId) return;

  const skill = charData.skills.find(s => s.name === skillName);
  if (!skill) return;

  const roll = Math.floor(Math.random() * 100) + 1;
  const judgeId = "judge_" + Date.now();

  await set(ref(db, `rooms/${roomId}/judgeQueue/${judgeId}`), {
    judgeId,
    playerId: myPlayerId,
    playerName: charData.name || "名無し",
    skill: skill.name,
    roll,
    target: skill.current
  });

  document.getElementById("judgeBtn").disabled = true;
  setPLDisabled("GMの裁定を待っています...");
  addLog2(`判定送信：${skill.name} (${roll}/${skill.current})`);
}

// ==========================
// GM：判定キュー描画
// ==========================
function renderJudgeQueueFromFirebase(queueObj) {
  const div = document.getElementById("judgeQueue");
  div.innerHTML = "";

  Object.entries(queueObj).forEach(([judgeId, j]) => {
    const item = document.createElement("div");
    item.className = "judge-item";
    item.textContent = `${j.playerName}：${j.skill} ${j.roll}/${j.target}`;

    const ok = document.createElement("button");
    ok.className = "btn btn-outline";
    ok.style.marginLeft = "8px";
    ok.textContent = "✓ 成功";
    ok.onclick = () => resolveJudge(judgeId, j, "成功");

    const ng = document.createElement("button");
    ng.className = "btn btn-outline";
    ng.style.marginLeft = "4px";
    ng.textContent = "✗ 失敗";
    ng.onclick = () => resolveJudge(judgeId, j, "失敗");

    item.append(ok, ng);
    div.appendChild(item);
  });
}

async function resolveJudge(judgeId, j, result) {
  addLog(`${j.playerName}：${j.skill} → ${result}`);

  // 判定結果をPLへ通知
  await set(ref(db, `rooms/${roomId}/judgeResults/${j.playerId}`), {
    resolved: true,
    skill: j.skill,
    roll: j.roll,
    target: j.target,
    result
  });

  // キューから削除
  await remove(ref(db, `rooms/${roomId}/judgeQueue/${judgeId}`));

  // シナリオ分岐
  const node = scenarioData[currentNodeId];
  if (node?.judge) {
    const nextId = result === "成功" ? node.judge.success : node.judge.failure;
    if (nextId && scenarioData[nextId]) {
      setTimeout(() => goToNode(nextId), 500);
    }
  }
}

// ==========================
// GM：シーン遷移
// ==========================
function renderCurrentNode() {
  const node = scenarioData[currentNodeId];
  if (!node) return;

  document.getElementById("storyText").textContent = node.text || "";
  document.getElementById("gmOnlyText").textContent = node.gmText ? `【GM】${node.gmText}` : "";

  const nextArea = document.getElementById("gmNextArea");
  nextArea.innerHTML = "";

  if (!node.judge) {
    const nexts = Object.keys(scenarioData).filter(k => k !== currentNodeId);
    if (nexts.length > 0) {
      const label = document.createElement("div");
      label.className = "section-title";
      label.style.marginTop = "12px";
      label.textContent = "次のノードへ進む";
      nextArea.appendChild(label);
      nexts.forEach(nid => {
        const btn = document.createElement("button");
        btn.className = "btn btn-gm";
        btn.style.marginRight = "8px";
        btn.textContent = `→ ${nid}`;
        btn.onclick = () => goToNode(nid);
        nextArea.appendChild(btn);
      });
    }
  }

  addLog(`[ノード: ${currentNodeId}] ${node.text}`);
  update(ref(db, `rooms/${roomId}`), { currentNodeId });
}

async function goToNode(nodeId) {
  currentNodeId = nodeId;
  renderCurrentNode();
}

// ==========================
// PL操作UI
// ==========================
function setPLDisabled(reasonText) {
  document.getElementById("plPanel").classList.add("disabled-ui");
  document.getElementById("plDisabledReason").textContent = reasonText;
}

function setPLEnabled() {
  document.getElementById("plPanel").classList.remove("disabled-ui");
  document.getElementById("plDisabledReason").textContent = "";
}

// ==========================
// シナリオ編集
// ==========================
window.addNode = function() {
  const id = "場面_" + Date.now();
  scenarioData[id] = { text: "", gmText: "" };
  renderNodes();
  document.querySelectorAll(".node-card")[document.querySelectorAll(".node-card").length - 1]
    .scrollIntoView({ behavior: "smooth" });
};

function renderNodes() {
  const list = document.getElementById("nodeList");
  if (!list) return;
  list.innerHTML = "";
  Object.entries(scenarioData).forEach(([nodeId, node]) => {
    list.appendChild(createNodeCard(nodeId, node));
  });
}

function createNodeCard(nodeId, node) {
  const hasJudge = node.judge != null;
  const card = document.createElement("div");
  card.className = "node-card";
  card.dataset.nodeId = nodeId;
  card.innerHTML = `
    <div class="node-header">
      <span class="node-id-label">ID：</span>
      <input class="node-id-input" value="${nodeId}" data-orig="${nodeId}" onchange="renameNode(this)" />
      <button class="node-delete-btn" onclick="deleteNode('${nodeId}')">削除</button>
    </div>
    <div class="node-field">
      <label>PL向けテキスト</label>
      <textarea onchange="updateNode('${nodeId}', 'text', this.value)">${node.text || ""}</textarea>
    </div>
    <div class="node-field">
      <label>GM向けテキスト（GM専用）</label>
      <textarea onchange="updateNode('${nodeId}', 'gmText', this.value)">${node.gmText || ""}</textarea>
    </div>
    <div class="judge-section">
      <div class="judge-title">判定設定</div>
      <label class="judge-toggle">
        <input type="checkbox" ${hasJudge ? "checked" : ""} onchange="toggleJudge('${nodeId}', this.checked)" />
        このノードで判定を行う
      </label>
      <div class="judge-fields ${hasJudge ? "show" : ""}">
        <div class="node-row">
          <div class="node-field">
            <label>使用技能</label>
            <input value="${node.judge?.skill || ""}" onchange="updateJudge('${nodeId}', 'skill', this.value)" placeholder="例：聞き耳" />
          </div>
          <div class="node-field">
            <label>成功時の遷移先</label>
            <input value="${node.judge?.success || ""}" onchange="updateJudge('${nodeId}', 'success', this.value)" placeholder="例：secret" />
          </div>
          <div class="node-field">
            <label>失敗時の遷移先</label>
            <input value="${node.judge?.failure || ""}" onchange="updateJudge('${nodeId}', 'failure', this.value)" placeholder="例：nothing" />
          </div>
        </div>
      </div>
    </div>
  `;
  return card;
}

window.updateNode = (nodeId, field, value) => { if (scenarioData[nodeId]) scenarioData[nodeId][field] = value; };
window.updateJudge = (nodeId, field, value) => {
  if (!scenarioData[nodeId]) return;
  if (!scenarioData[nodeId].judge) scenarioData[nodeId].judge = {};
  scenarioData[nodeId].judge[field] = value;
};
window.toggleJudge = (nodeId, enabled) => {
  const card = document.querySelector(`[data-node-id="${nodeId}"]`);
  const fields = card.querySelector(".judge-fields");
  if (enabled) { scenarioData[nodeId].judge = { skill: "", success: "", failure: "" }; fields.classList.add("show"); }
  else { delete scenarioData[nodeId].judge; fields.classList.remove("show"); }
};
window.renameNode = (input) => {
  const oldId = input.dataset.orig;
  const newId = input.value.trim();
  if (!newId || newId === oldId || scenarioData[newId]) { input.value = oldId; return; }
  scenarioData[newId] = scenarioData[oldId];
  delete scenarioData[oldId];
  input.dataset.orig = newId;
  renderNodes();
};
window.deleteNode = (nodeId) => {
  if (!confirm(`ノード「${nodeId}」を削除しますか？`)) return;
  delete scenarioData[nodeId];
  renderNodes();
};
window.downloadScenario = () => download("scenario.json", scenarioData);
window.loadScenarioFile = (input) => {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try { scenarioData = JSON.parse(e.target.result); renderNodes(); }
    catch { alert("JSONの読み込みに失敗しました"); }
  };
  reader.readAsText(file);
};

// ==========================
// キャラシート編集
// ==========================
window.addSkill = () => {
  charData.skills.push({ name: "新しい技能", base: 30, current: 30 });
  renderSkills();
};

function renderSkills() {
  const tbody = document.getElementById("skillList");
  if (!tbody) return;
  tbody.innerHTML = "";
  charData.skills.forEach((skill, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input value="${skill.name}" onchange="updateSkill(${i}, 'name', this.value)" /></td>
      <td><input type="number" value="${skill.base}" min="1" max="100" onchange="updateSkill(${i}, 'base', +this.value)" /></td>
      <td><input type="number" value="${skill.current}" min="1" max="100" onchange="updateSkill(${i}, 'current', +this.value)" /></td>
      <td><button class="skill-del-btn" onclick="deleteSkill(${i})">×</button></td>
    `;
    tbody.appendChild(tr);
  });
}

window.updateSkill = (i, f, v) => { charData.skills[i][f] = v; };
window.deleteSkill = (i) => { charData.skills.splice(i, 1); renderSkills(); };

function saveCharFromFields() {
  charData.name = document.getElementById("charName").value;
  charData.job  = document.getElementById("charJob").value;
  charData.age  = document.getElementById("charAge").value;
}

// ==========================
// セーブ・ロード
// ==========================
window.saveGame = () => {
  saveCharFromFields();
  download("trpg_save.json", {
    version: 1, isGM, roomId, currentNodeId,
    scenarioData, charData,
    log:  document.getElementById("logText")?.textContent  || "",
    log2: document.getElementById("logText2")?.textContent || ""
  });
};

function loadSaveFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try { restoreGame(JSON.parse(e.target.result)); }
    catch { alert("セーブデータの読み込みに失敗しました"); }
  };
  reader.readAsText(file);
}

async function restoreGame(data) {
  isGM          = data.isGM;
  roomId        = data.roomId;
  currentNodeId = data.currentNodeId || "start";
  scenarioData  = data.scenarioData  || defaultScenario;
  charData      = data.charData      || charData;
  showRoomId();

  if (isGM) {
    showScreen("screenGMPlay");
    setTurnStatus("🛠 GMモード（再開）", "gm");
    renderCurrentNode();
    if (data.log) document.getElementById("logText").textContent = data.log;
    listenRoom();
  } else {
    myPlayerId = "pl_" + Date.now();
    showScreen("screenPLPlay");
    setTurnStatus("🎭 PLモード（再開）", "pl");
    if (data.log2) document.getElementById("logText2").textContent = data.log2;

    const skillSelect = document.getElementById("skillSelect");
    skillSelect.innerHTML = '<option value="">技能を選択</option>';
    charData.skills.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.name;
      opt.textContent = `${s.name} (${s.current})`;
      skillSelect.appendChild(opt);
    });
    skillSelect.disabled = false;
    document.getElementById("plDisabledReason").textContent = "技能を選択すると判定できます";
    listenRoom();
  }
}

// ==========================
// ユーティリティ
// ==========================
function download(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}