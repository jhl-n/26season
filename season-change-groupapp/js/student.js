/**
 * student.js — 학생 화면 로직
 * 화면 흐름: 학급 선택 → 모둠 선택 → 이름 입력 → 순서번호(좌석) 선택 → 스테이션 활동
 *
 * 모둠 안에는 정해진 역할이 없습니다. 모든 스테이션에서 모든 학생이:
 *   1) 문항 전체에 스스로 답을 입력해 제출 (개인 답)
 *   2) 모둠원의 개인 답을 서로 비교
 *   3) 모둠이 하나의 최종 답으로 합의해 아무나 제출
 * 순서로 진행됩니다. (제출·수정은 모둠원 누구나 할 수 있습니다)
 */

// sessionStorage(탭 단위)를 씁니다 — localStorage를 쓰면 같은 브라우저에서
// 여러 탭(데모 모드 테스트, 혹은 한 교실에서 여러 학생이 우연히 같은
// 브라우저를 공유하는 경우)을 열었을 때 아이디(학급·모둠·번호)가
// 서로 덮어써지는 문제가 생깁니다. 새로고침에는 살아남고, 탭을 완전히
// 닫으면 사라집니다(다시 선택하면 됨).
const STORAGE_KEY = "season_app_identity_v1";
const app = document.getElementById("app");
const idLine = document.getElementById("idLine");
const modeBanner = document.getElementById("modeBanner");
const resetLink = document.getElementById("resetLink");

Db.ready.then(() => {
  modeBanner.textContent = Db.getMode() === "firebase" ? "실시간 동기화 중 ✅" : "데모 모드 (같은 브라우저 탭끼리만 동기화)";
  modeBanner.className = "mode-banner" + (Db.getMode() === "firebase" ? "" : " demo");
});

function freshState() {
  return {
    classId: null,
    groupNum: null,
    studentName: null,
    seat: null,
    groupsUnsub: null, // 학급 전체 모둠 목록(모둠 선택 화면용)
    membersUnsub: null, // 특정 모둠의 좌석 현황(좌석 선택 화면용)
    groupUnsub: null, // 활동 화면에서 쓰는 모둠 전체 구독
    latestGroup: null,
    localAnswers: {}, // 아직 제출 안 한 "내 개인 답" 임시 저장 {stationId: {itemId: value}}
    editingIndividual: {}, // {stationId: true} — 제출한 개인 답을 다시 수정 중인지
    editingFinal: {}, // {stationId: true} — 모둠 최종 답을 다시 논의/수정 중인지
    finalEdits: {}, // {stationId: {itemId: value}} — 최종 답 임시 입력값
  };
}

let state = freshState();

function basePath() {
  return `activities/${window.ACTIVITY_ID}/classes/${state.classId}`;
}
function groupPath(g) {
  return `${basePath()}/groups/${g == null ? state.groupNum : g}`;
}

function saveIdentity() {
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      activityId: window.ACTIVITY_ID,
      classId: state.classId,
      groupNum: state.groupNum,
      studentName: state.studentName,
      seat: state.seat,
    })
  );
}
function loadIdentity() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    if (raw && raw.activityId === window.ACTIVITY_ID) return raw;
  } catch (e) {}
  return null;
}
function clearIdentity() {
  sessionStorage.removeItem(STORAGE_KEY);
}

function updateIdLine() {
  if (state.classId && state.groupNum && state.seat) {
    idLine.textContent = `${state.classId}반 · ${state.groupNum}모둠 · ${state.studentName || ""} (${state.seat}번)`;
    resetLink.style.display = "inline";
  } else if (state.classId && state.groupNum && state.studentName) {
    idLine.textContent = `${state.classId}반 · ${state.groupNum}모둠 · ${state.studentName} · 순서번호 선택 중`;
    resetLink.style.display = "inline";
  } else if (state.classId && state.groupNum) {
    idLine.textContent = `${state.classId}반 · ${state.groupNum}모둠 · 이름 입력 중`;
    resetLink.style.display = "inline";
  } else if (state.classId) {
    idLine.textContent = `${state.classId}반 · 모둠 선택 중`;
    resetLink.style.display = "inline";
  } else {
    idLine.textContent = "";
    resetLink.style.display = "none";
  }
}

/** 그룹 데이터에서 좌석 번호로 이름을 찾아옵니다. 이름이 없으면 "n번"으로 대체합니다. */
function nameForSeat(seat) {
  const m = state.latestGroup && state.latestGroup.members && state.latestGroup.members[seat];
  return m && m.name ? m.name : `${seat}번`;
}

function escapeHtml(s) {
  return (s || "")
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

resetLink.addEventListener("click", (e) => {
  e.preventDefault();
  if (!confirm("처음부터 다시 선택할까요? (내 좌석은 비워집니다)")) return;
  teardownAll();
  if (state.classId && state.groupNum && state.seat) {
    Db.ref(`${groupPath()}/members/${state.seat}`).remove();
  }
  clearIdentity();
  state = freshState();
  updateIdLine();
  renderClassScreen();
});

function teardownAll() {
  [state.groupsUnsub, state.membersUnsub, state.groupUnsub].forEach((u) => u && u());
  state.groupsUnsub = state.membersUnsub = state.groupUnsub = null;
}

// ------------------------------------------------------------------
// 화면 1: 학급 선택
// ------------------------------------------------------------------
function renderClassScreen() {
  teardownAll();
  app.innerHTML = `
    <div class="card">
      <h2>1️⃣ 우리 학급을 선택하세요</h2>
      <div class="grid-btns">
        ${window.CLASSES.map((c) => `<button class="btn" data-class="${c}">${c}반</button>`).join("")}
      </div>
    </div>
  `;
  app.querySelectorAll("[data-class]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.classId = btn.dataset.class;
      updateIdLine();
      renderGroupScreen();
    });
  });
}

// ------------------------------------------------------------------
// 화면 2: 모둠 선택 (실시간 인원수 표시)
// ------------------------------------------------------------------
function renderGroupScreen() {
  teardownAll();
  app.innerHTML = `
    <div class="card">
      <h2>2️⃣ 우리 모둠을 선택하세요 <span class="muted small">(${state.classId}반)</span></h2>
      <div class="grid-btns" id="groupBtns"></div>
      <p class="small muted" style="margin-top:14px;"><a href="#" id="backToClass">← 학급 다시 선택</a></p>
    </div>
  `;
  document.getElementById("backToClass").addEventListener("click", (e) => {
    e.preventDefault();
    state.classId = null;
    updateIdLine();
    renderClassScreen();
  });

  const groupsRef = Db.ref(`${basePath()}/groups`);
  state.groupsUnsub = groupsRef.onValue((groups) => {
    const box = document.getElementById("groupBtns");
    if (!box) return;
    const g = groups || {};
    box.innerHTML = Array.from({ length: window.GROUP_COUNT }, (_, i) => i + 1)
      .map((n) => {
        const members = (g[n] && g[n].members) || {};
        const count = Object.keys(members).length;
        return `<button class="btn secondary" data-group="${n}" style="position:relative;">
          ${n}모둠<br/><span class="small muted">${count}명 접속</span>
        </button>`;
      })
      .join("");
    box.querySelectorAll("[data-group]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.groupNum = Number(btn.dataset.group);
        updateIdLine();
        renderNameScreen();
      });
    });
  });
}

// ------------------------------------------------------------------
// 화면 3: 이름 입력 (교사가 답을 낸 사람을 구분할 수 있도록)
// ------------------------------------------------------------------
function renderNameScreen() {
  teardownAll();
  app.innerHTML = `
    <div class="card">
      <h2>3️⃣ 이름을 입력하세요 <span class="muted small">(${state.classId}반 ${state.groupNum}모둠)</span></h2>
      <p class="muted small">선생님이 누구의 답인지 확인할 수 있도록 실명을 입력해주세요.</p>
      <div class="field">
        <input type="text" id="nameInput" placeholder="이름 (예: 홍길동)" maxlength="10" style="font-size:1.2rem; padding:14px;" />
      </div>
      <button class="btn" id="nameNextBtn">다음 →</button>
      <p class="small muted" style="margin-top:14px;"><a href="#" id="backToGroupFromName">← 모둠 다시 선택</a></p>
    </div>
  `;
  document.getElementById("backToGroupFromName").addEventListener("click", (e) => {
    e.preventDefault();
    state.groupNum = null;
    updateIdLine();
    renderGroupScreen();
  });

  const input = document.getElementById("nameInput");
  input.value = state.studentName || "";
  input.focus();

  function submitName() {
    const val = input.value.trim();
    if (!val) {
      alert("이름을 입력해주세요.");
      return;
    }
    state.studentName = val;
    updateIdLine();
    renderSeatScreen();
  }
  document.getElementById("nameNextBtn").addEventListener("click", submitName);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitName();
  });
}

// ------------------------------------------------------------------
// 화면 4: 좌석(순서번호) 선택
// ------------------------------------------------------------------
function renderSeatScreen() {
  teardownAll();
  app.innerHTML = `
    <div class="card">
      <h2>4️⃣ 내 순서번호를 선택하세요 <span class="muted small">(${state.classId}반 ${state.groupNum}모둠 · ${state.studentName})</span></h2>
      <p class="muted small">이미 선택된 번호는 고를 수 없어요. 결석한 친구가 있으면 그만큼 번호가 비어있어도 괜찮습니다.</p>
      <div class="grid-btns" id="seatBtns"></div>
      <p class="small muted" style="margin-top:14px;"><a href="#" id="backToName">← 이름 다시 입력</a></p>
    </div>
  `;
  document.getElementById("backToName").addEventListener("click", (e) => {
    e.preventDefault();
    renderNameScreen();
  });

  const membersRef = Db.ref(`${groupPath()}/members`);
  state.membersUnsub = membersRef.onValue((members) => {
    const box = document.getElementById("seatBtns");
    if (!box) return;
    const m = members || {};
    box.innerHTML = Array.from({ length: window.MAX_SEATS_PER_GROUP }, (_, i) => i + 1)
      .map((seat) => {
        const taken = m[seat];
        return `<button class="seat-btn ${taken ? "taken" : ""}" data-seat="${seat}" ${taken ? "disabled" : ""}>
          ${seat}번${taken ? `<br/><span class='small'>${escapeHtml(taken.name || "참여중")}</span>` : ""}
        </button>`;
      })
      .join("");
    box.querySelectorAll("[data-seat]:not(.taken)").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.seat = Number(btn.dataset.seat);
        Db.ref(`${groupPath()}/members/${state.seat}`).set({ name: state.studentName, joinedAt: Date.now() });
        saveIdentity();
        updateIdLine();
        renderActivityScreen();
      });
    });
  });
}

// ------------------------------------------------------------------
// 유틸: 채점
// ------------------------------------------------------------------
// 비교 전 정리: 동그라미 기호(㉠㉡㉢...)를 ㄱㄴㄷ...으로 바꾸고, 공백·괄호·
// 조사 "의"를 지웁니다. ("태양고도" = "태양의 고도", "㉠㉡" 입력 시 "ㄱㄴ"도 정답)
const CIRCLED_CONSONANTS = "ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ";
function normalize(s) {
  if (s === null || s === undefined) return "";
  let t = s.toString();
  t = t.replace(/[㉠-㉭]/g, (ch) => CIRCLED_CONSONANTS[ch.codePointAt(0) - 0x3260] || ch);
  t = t.replace(/[()\[\]{}]/g, "");
  t = t.replace(/\s+/g, "");
  t = t.replace(/의/g, "");
  return t.toLowerCase();
}
/** 정규화한 두 문자열이 같은지, 완전히 같지 않다면 글자 구성(순서 무관)이라도 같은지 확인 */
function sameNormalized(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.split("").sort().join("") === b.split("").sort().join("");
}
function gradeField(item, value) {
  if (!item.answerKey) return null; // 채점 대상이 아닌 문항(글쓰기·토의)
  const norm = normalize(value);
  if (!norm) return false;
  const keys = [item.answerKey, ...(item.acceptable || [])].map(normalize);
  return keys.some((k) => sameNormalized(norm, k));
}
function gradeStation(station, values) {
  const gradedItems = station.items.filter((it) => it.answerKey);
  if (!gradedItems.length) return "done"; // 정답이 없는 스테이션 — 제출 완료로만 표시
  const allCorrect = gradedItems.every((it) => gradeField(it, values[it.id]));
  return allCorrect ? "done-ok" : "done-bad";
}

// ------------------------------------------------------------------
// 화면 5: 스테이션 활동
// ------------------------------------------------------------------
function renderActivityScreen() {
  teardownAll();
  const gRef = Db.ref(groupPath());
  state.groupUnsub = gRef.onValue((group) => {
    state.latestGroup = group || { members: {}, currentStation: 1 };
    renderStationBody();
  });
}

function renderProgressBar(currentIdx) {
  return `<div class="progress-bar">${window.STATIONS.map((s, i) => {
    let cls = "progress-seg";
    if (i < currentIdx) cls += " done";
    else if (i === currentIdx) cls += " current";
    return `<div class="${cls}" title="${s.title}"></div>`;
  }).join("")}</div>`;
}

function renderStationBody() {
  const group = state.latestGroup;
  const stationIdx = (group.currentStation || 1) - 1;
  const station = window.STATIONS[stationIdx];
  const helpOn = !!group.helpRequested;

  if (!station) {
    app.innerHTML = `
      <div class="card" style="text-align:center;">
        <h2>🎉 모든 스테이션을 완료했어요!</h2>
        <p class="muted">선생님의 다음 안내를 기다려주세요.</p>
      </div>
    `;
    renderHelpFab(helpOn);
    return;
  }

  const stationData = (group.stationData && group.stationData[station.id]) || {};
  const bodyHtml = renderStation(station, stationData);

  app.innerHTML = `
    ${renderProgressBar(stationIdx)}
    <div class="card">
      <h2>${station.title}</h2>
      <p class="muted small">${station.reference}</p>
      <p>${station.prompt}</p>
      ${bodyHtml}
    </div>
  `;
  attachHandlers(station);
  renderHelpFab(helpOn);
}

function renderHelpFab(helpOn) {
  let fab = document.getElementById("helpFab");
  if (!fab) {
    fab = document.createElement("button");
    fab.id = "helpFab";
    fab.className = "btn accent help-fab";
    document.body.appendChild(fab);
    fab.addEventListener("click", () => {
      const cur = !!(state.latestGroup && state.latestGroup.helpRequested);
      Db.ref(`${groupPath()}/helpRequested`).set(!cur);
    });
  }
  fab.textContent = helpOn ? "🙋 도움 요청 취소" : "🙋 도움 요청하기";
  fab.className = "btn accent help-fab" + (helpOn ? " active" : "");
}

// ---------- 공용: 참고 사진 ----------
function renderImages(images) {
  if (!images || !images.length) return "";
  return `<div class="station-images">${images
    .map(
      (img) => `
      <figure class="station-figure">
        <img src="${img.src}" alt="${escapeHtml(img.alt || "")}" loading="lazy" />
        ${img.caption ? `<figcaption>${escapeHtml(img.caption)}</figcaption>` : ""}
      </figure>`
    )
    .join("")}</div>`;
}

// ---------- 공용: 문항 입력 UI ----------
function renderFieldInput(it, value) {
  if (it.kind === "ox") {
    return `
    <div class="field" data-field="${it.id}" data-kind="ox">
      <label>${it.label}</label>
      <div class="ox-btns">
        <button type="button" class="ox-choice ${value === "O" ? "selected o" : ""}" data-val="O">O</button>
        <button type="button" class="ox-choice ${value === "X" ? "selected x" : ""}" data-val="X">X</button>
      </div>
    </div>`;
  }
  const safeVal = escapeHtml(value || "");
  if (it.kind === "textarea") {
    return `
    <div class="field" data-field="${it.id}" data-kind="textarea">
      <label>${it.label}</label>
      <textarea data-val placeholder="답을 입력하세요">${safeVal}</textarea>
    </div>`;
  }
  return `
  <div class="field" data-field="${it.id}" data-kind="text">
    <label>${it.label}</label>
    <input type="text" data-val value="${safeVal}" placeholder="답을 입력하세요" />
  </div>`;
}

function bindFieldInputs(containerSelector, targetBucket) {
  document.querySelectorAll(`${containerSelector} .ox-choice`).forEach((btn) => {
    btn.addEventListener("click", () => {
      const field = btn.closest(".field");
      field.querySelectorAll(".ox-choice").forEach((b) => b.classList.remove("selected", "o", "x"));
      btn.classList.add("selected", btn.dataset.val === "O" ? "o" : "x");
      targetBucket[field.dataset.field] = btn.dataset.val;
    });
  });
  document.querySelectorAll(`${containerSelector} [data-val]`).forEach((el) => {
    if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return;
    el.addEventListener("input", () => {
      const field = el.closest(".field");
      targetBucket[field.dataset.field] = el.value;
    });
  });
}

// ---------- 모둠원 답 비교 ----------
function renderCompare(station, individual) {
  const seats = Object.keys(individual)
    .map(Number)
    .sort((a, b) => a - b);
  if (!seats.length) return "";
  const hasLong = station.items.some((it) => it.kind === "textarea");

  if (!hasLong) {
    const rows = seats
      .map((seat) => {
        const ans = individual[seat];
        return `<tr><th>${escapeHtml(nameForSeat(seat))}<br/><span class="small muted">${seat}번</span></th>${station.items
          .map((it) => `<td>${escapeHtml((ans.values[it.id] ?? "").toString()) || "-"}</td>`)
          .join("")}</tr>`;
      })
      .join("");
    return `<h3 style="margin-top:20px;">모둠원 답 비교</h3>
       <div style="overflow-x:auto;"><table class="compare-table">
        <tr><th>이름</th>${station.items.map((it) => `<th>${it.id}</th>`).join("")}</tr>
        ${rows}
       </table></div>`;
  }

  const cards = seats
    .map((seat) => {
      const ans = individual[seat];
      return `<div class="field">
        <strong>${escapeHtml(nameForSeat(seat))} <span class="small muted">(${seat}번)</span></strong>
        ${station.items
          .map(
            (it) =>
              `<p style="margin:8px 0 0; white-space:pre-wrap;"><span class="muted small">${escapeHtml(it.label)}</span><br/>${
                escapeHtml((ans.values[it.id] ?? "").toString()) || "-"
              }</p>`
          )
          .join("")}
      </div>`;
    })
    .join("");
  return `<h3 style="margin-top:20px;">모둠원 답 비교</h3>${cards}`;
}

// ---------- 스테이션 본문 (개인 답 → 비교 → 모둠 최종 답) ----------
const STATUS_INFO = {
  "done-ok": { label: "정답이에요! ✅", cls: "ok" },
  "done-bad": { label: "아쉽지만 오답이에요 ❌ 다시 논의해보세요", cls: "bad" },
  done: { label: "제출 완료 ✅", cls: "ok" },
};

function renderStation(station, stationData) {
  const individual = stationData.individual || {};
  const mine = individual[state.seat];
  const final = stationData.final;
  const editingMine = !mine || !!state.editingIndividual[station.id];
  const editingFinal = !!state.editingFinal[station.id];

  const individualFieldsHtml = station.items
    .map((it) => {
      if (!editingMine) {
        const shown = (mine.values[it.id] ?? "").toString();
        return `<div class="field"><label>${it.label}</label><p style="margin:0; white-space:pre-wrap;"><b>${escapeHtml(shown) || "-"}</b></p></div>`;
      }
      const val = state.localAnswers[station.id]?.[it.id] ?? "";
      return renderFieldInput(it, val);
    })
    .join("");

  const mineControlsHtml = !editingMine
    ? `<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:8px;">
        <span class="pill ok">✅ 내 답 제출 완료</span>
        <button class="btn secondary" id="editMine">✏️ 내 답 수정하기</button>
      </div>`
    : `<button class="btn" id="submitMine" style="margin-top:8px;">${mine ? "수정한 답 다시 제출" : "내 답 제출"}</button>`;

  const compareHtml = renderCompare(station, individual);

  let finalHtml = "";
  if (final && !editingFinal) {
    const st = STATUS_INFO[final.status] || STATUS_INFO.done;
    finalHtml = `<div class="field" style="margin-top:18px; background:#f4f0e4;">
        <strong>모둠 최종 답 (${escapeHtml(nameForSeat(final.submittedBySeat))} 제출)</strong>
        ${station.items
          .map(
            (it) =>
              `<p style="margin:8px 0 0; white-space:pre-wrap;"><span class="muted small">${escapeHtml(it.label)}</span><br/><b>${
                escapeHtml((final.values[it.id] ?? "").toString()) || "-"
              }</b></p>`
          )
          .join("")}
        <span id="finalStatusPill" class="pill ${st.cls}" style="font-size:1rem; padding:8px 14px; margin-top:8px; display:inline-block;">${st.label}</span>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;">
        <button class="btn secondary" id="reviseFinal">↩️ 모둠 답 다시 논의하고 수정하기</button>
        <button class="btn accent" id="goNext">다음 스테이션으로 이동 ▶</button>
      </div>`;
  } else {
    const editFieldsHtml = station.items
      .map((it) => {
        const val = state.finalEdits[station.id]?.[it.id] ?? (final ? final.values[it.id] : mine ? mine.values[it.id] : "") ?? "";
        return renderFieldInput(it, val);
      })
      .join("");
    const guide =
      station.finalPrompt || (mine ? "모둠원과 상의한 답을 입력하세요. (내 답이 기본값으로 채워져 있어요)" : "모둠원과 상의한 답을 입력하세요.");
    finalHtml = `<div style="margin-top:20px;">
      <h3>✍️ 모둠 최종 답 ${final ? "수정" : "제출"}</h3>
      <p class="small muted">${guide}</p>
      <div id="finalEditFields">${editFieldsHtml}</div>
      <div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap;">
        <button class="btn accent" id="submitFinal">${final ? "수정한 답 다시 제출" : "모둠 최종 답 제출하기"}</button>
        ${final ? `<button class="btn secondary" id="cancelReviseFinal">취소</button>` : ""}
      </div>
    </div>`;
  }

  return `${renderImages(station.images)}<div id="individualFields">${individualFieldsHtml}</div>${mineControlsHtml}${compareHtml}${finalHtml}`;
}

// ------------------------------------------------------------------
// 다음 스테이션 이동 (버튼을 눌러야만 이동 — 자동으로 넘어가지 않음)
// ------------------------------------------------------------------
function advanceStation(stationIdx) {
  const nextStation = stationIdx + 2; // 1-based 다음 번호
  const g = state.latestGroup;
  if ((g.currentStation || 1) === stationIdx + 1) {
    Db.ref(`${groupPath()}/currentStation`).set(nextStation);
  }
}

function attachHandlers(station) {
  const stationIdx = station.id - 1;
  state.localAnswers[station.id] = state.localAnswers[station.id] || {};
  state.finalEdits[station.id] = state.finalEdits[station.id] || {};
  bindFieldInputs("#individualFields", state.localAnswers[station.id]);
  bindFieldInputs("#finalEditFields", state.finalEdits[station.id]);

  const submitMine = document.getElementById("submitMine");
  if (submitMine) {
    submitMine.addEventListener("click", () => {
      const values = {};
      station.items.forEach((it) => (values[it.id] = state.localAnswers[station.id]?.[it.id] || ""));
      const missing = station.items.some((it) => !values[it.id] || !values[it.id].toString().trim());
      if (missing) {
        alert("모든 문항에 답을 입력해주세요.");
        return;
      }
      Db.ref(`${groupPath()}/stationData/${station.id}/individual/${state.seat}`).set({ values, at: Date.now() });
      state.editingIndividual[station.id] = false;
      renderStationBody();
    });
  }
  const editMine = document.getElementById("editMine");
  if (editMine) {
    editMine.addEventListener("click", () => {
      const ind = state.latestGroup.stationData?.[station.id]?.individual || {};
      const mineNow = ind[state.seat];
      state.editingIndividual[station.id] = true;
      state.localAnswers[station.id] = mineNow ? { ...mineNow.values } : {};
      renderStationBody();
    });
  }

  const submitFinal = document.getElementById("submitFinal");
  if (submitFinal) {
    submitFinal.addEventListener("click", () => {
      const individualNow = state.latestGroup.stationData?.[station.id]?.individual || {};
      const mineNow = individualNow[state.seat];
      const finalNow = state.latestGroup.stationData?.[station.id]?.final;
      const values = {};
      station.items.forEach((it) => {
        values[it.id] =
          state.finalEdits[station.id]?.[it.id] ?? (finalNow ? finalNow.values[it.id] : mineNow ? mineNow.values[it.id] : "") ?? "";
      });
      const missing = station.items.some((it) => !values[it.id] || !values[it.id].toString().trim());
      if (missing) {
        alert("모둠 최종 답을 모두 입력해주세요. (내 답을 먼저 제출하면 자동으로 채워집니다)");
        return;
      }
      const status = gradeStation(station, values);
      Db.ref(`${groupPath()}/stationData/${station.id}/final`).set({
        values,
        status,
        submittedBySeat: state.seat,
        submittedAt: Date.now(),
      });
      state.editingFinal[station.id] = false;
      state.finalEdits[station.id] = {};
      renderStationBody();
    });
  }
  const reviseFinal = document.getElementById("reviseFinal");
  if (reviseFinal) {
    reviseFinal.addEventListener("click", () => {
      state.editingFinal[station.id] = true;
      state.finalEdits[station.id] = {};
      renderStationBody();
    });
  }
  const cancelReviseFinal = document.getElementById("cancelReviseFinal");
  if (cancelReviseFinal) {
    cancelReviseFinal.addEventListener("click", () => {
      state.editingFinal[station.id] = false;
      state.finalEdits[station.id] = {};
      renderStationBody();
    });
  }
  const goNext = document.getElementById("goNext");
  if (goNext) goNext.addEventListener("click", () => advanceStation(stationIdx));
}

// ------------------------------------------------------------------
// 시작: 저장된 정체성 복원 시도
// ------------------------------------------------------------------
(async function boot() {
  await Db.ready;
  const saved = loadIdentity();
  if (saved && saved.classId && saved.groupNum && saved.seat && saved.studentName) {
    state.classId = saved.classId;
    state.groupNum = saved.groupNum;
    state.studentName = saved.studentName;
    state.seat = saved.seat;
    updateIdLine();
    renderActivityScreen();
  } else {
    renderClassScreen();
  }
})();
