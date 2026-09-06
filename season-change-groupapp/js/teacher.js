/**
 * teacher.js — 교사 대표 화면
 * 학급 탭을 전환하며 그 학급의 모둠×스테이션 진행 상황을 실시간으로 보여줍니다.
 */

document.getElementById("activityTitle").textContent = window.ACTIVITY_TITLE || "모둠 협력 문제풀이";
const modeBanner = document.getElementById("modeBanner");
Db.ready.then(() => {
  modeBanner.textContent = Db.getMode() === "firebase" ? "실시간 동기화 중 ✅" : "데모 모드 (같은 브라우저 탭끼리만 동기화)";
  modeBanner.className = "mode-banner" + (Db.getMode() === "firebase" ? "" : " demo");
});

document.getElementById("stationList").innerHTML = window.STATIONS.map(
  (s) => `<li><b>${s.title}</b> — <span class="muted">${s.reference}</span></li>`
).join("");

let currentClass = window.CLASSES[0];
let unsub = null;

function basePath(classId) {
  return `activities/${window.ACTIVITY_ID}/classes/${classId}`;
}

function renderTabs() {
  const tabBar = document.getElementById("classTabs");
  tabBar.innerHTML = window.CLASSES.map(
    (c) => `<button data-class="${c}" class="${c === currentClass ? "active" : ""}">${c}반</button>`
  ).join("");
  tabBar.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentClass = btn.dataset.class;
      renderTabs();
      subscribeClass();
    });
  });
}

function statusFromFinal(final) {
  if (!final) return { cls: "progress", label: "진행중" };
  if (final.status === "done-ok") return { cls: "done-ok", label: "정답 ✅" };
  if (final.status === "done-bad") return { cls: "done-bad", label: "오답 ❌" };
  return { cls: "done-ok", label: "완료 ✅" };
}

function stationStatus(group, station) {
  const cur = (group && group.currentStation) || 1;
  if (cur < station.id) return { cls: "wait", label: "대기" };
  const final = group?.stationData?.[station.id]?.final;
  if (cur > station.id) {
    return final ? statusFromFinal(final) : { cls: "done-ok", label: "완료" };
  }
  return final ? statusFromFinal(final) : { cls: "progress", label: "진행중" };
}

function renderBoard(groups) {
  const g = groups || {};
  const stations = window.STATIONS;
  const header = `<tr><th style="width:120px;">모둠</th>${stations
    .map((s) => `<th title="${s.title}">${s.id}</th>`)
    .join("")}</tr>`;

  const rows = Array.from({ length: window.GROUP_COUNT }, (_, i) => i + 1)
    .map((n) => {
      const group = g[n];
      const members = (group && group.members) || {};
      const memberSeats = Object.keys(members)
        .map(Number)
        .sort((a, b) => a - b);
      const nameList = memberSeats.map((seat) => members[seat].name || `${seat}번`).join(", ");
      const help = group && group.helpRequested;
      const cells = stations
        .map((s) => {
          const st = stationStatus(group, s);
          return `<td class="status-cell ${st.cls}">${st.label}</td>`;
        })
        .join("");
      return `<tr>
        <td class="group-cell ${help ? "help" : ""}">${n}모둠 ${help ? "🙋" : ""}<span class="member-count">${nameList || "접속 없음"}</span></td>
        ${cells}
      </tr>`;
    })
    .join("");

  return `<div style="overflow-x:auto;">
    <table class="board-table">${header}${rows}</table>
  </div>
  <div style="margin-top:16px; text-align:right;">
    <button class="btn danger" id="resetClassBtn">이 학급 초기화 (다음 교시 준비)</button>
  </div>`;
}

function subscribeClass() {
  if (unsub) unsub();
  const ref = Db.ref(`${basePath(currentClass)}/groups`);
  unsub = ref.onValue((groups) => {
    document.getElementById("boardArea").innerHTML = renderBoard(groups);
    const resetBtn = document.getElementById("resetClassBtn");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        if (!confirm(`${currentClass}반의 모든 모둠 진행 상황을 초기화할까요? (다음 교시 학생들이 새로 입장합니다)`)) return;
        Db.ref(`${basePath(currentClass)}/groups`).remove();
      });
    }
  });
}

(async function boot() {
  await Db.ready;
  renderTabs();
  subscribeClass();
})();
