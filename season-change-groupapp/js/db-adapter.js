/**
 * db-adapter.js
 * ------------------------------------------------------------------
 * Firebase Realtime Database가 설정되어 있으면 그것을 쓰고,
 * 아니면 "같은 브라우저의 여러 탭"끼리만 동기화되는 데모용 저장소를
 * 자동으로 사용합니다. 어느 쪽이든 아래와 같은 동일한 인터페이스로
 * 사용할 수 있습니다.
 *
 *   const ref = Db.ref("activities/xxx/classes/6-1/groups/2");
 *   ref.set({...});                 // 전체 덮어쓰기
 *   ref.update({foo: 1});           // 일부만 병합
 *   ref.remove();                   // 삭제
 *   const unsub = ref.onValue(v => console.log(v)); // 실시간 구독
 *   unsub();                        // 구독 해제
 * ------------------------------------------------------------------
 */

const Db = (function () {
  let mode = "demo"; // "firebase" | "demo"
  let fbApp = null;
  let fbDb = null;

  const FIREBASE_APP_SRC = "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js";
  const FIREBASE_DB_SRC = "https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js";

  function looksConfigured(cfg) {
    return !!(cfg && cfg.apiKey && cfg.databaseURL);
  }

  // 정적 <script> 태그로 넣지 않고, 필요할 때만 동적으로 불러옵니다.
  // (설정이 없으면 네트워크 요청 자체를 하지 않고, 느린/막힌 네트워크에서도
  //  앱 전체가 멈추지 않도록 타임아웃을 둡니다)
  function loadScript(src, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => finish(true);
      s.onerror = () => finish(false);
      document.head.appendChild(s);
    });
  }

  // Db.ready: 모드(firebase/demo)가 확정되면 resolve되는 Promise.
  // 설정이 비어있으면(데모 모드) 네트워크 요청 없이 즉시 확정됩니다.
  const ready = (async () => {
    const cfg = window.FIREBASE_CONFIG;
    if (!looksConfigured(cfg)) {
      mode = "demo";
      return;
    }
    try {
      const ok1 = await loadScript(FIREBASE_APP_SRC, 6000);
      const ok2 = ok1 && (await loadScript(FIREBASE_DB_SRC, 6000));
      if (ok1 && ok2 && window.firebase) {
        fbApp = window.firebase.initializeApp(cfg);
        fbDb = window.firebase.database();
        mode = "firebase";
      } else {
        console.warn("[Db] Firebase 스크립트를 불러오지 못해 데모 모드로 전환합니다.");
        mode = "demo";
      }
    } catch (e) {
      console.warn("[Db] Firebase 초기화 실패, 데모 모드로 전환합니다.", e);
      mode = "demo";
    }
  })();

  // ---------------- 데모 모드 (localStorage + BroadcastChannel) ----------------
  const DEMO_KEY = "season_app_demo_db_root";
  const channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel("season-app-db")
      : null;
  const localListeners = new Map(); // path -> Set<callback>

  function demoGetRoot() {
    try {
      return JSON.parse(localStorage.getItem(DEMO_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }
  function demoSaveRoot(root) {
    localStorage.setItem(DEMO_KEY, JSON.stringify(root));
  }
  function splitPath(path) {
    return path.split("/").filter(Boolean);
  }
  function demoGetAt(root, path) {
    let node = root;
    for (const seg of splitPath(path)) {
      if (node == null || typeof node !== "object") return undefined;
      node = node[seg];
    }
    return node;
  }
  function demoSetAt(root, path, value) {
    const segs = splitPath(path);
    let node = root;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i];
      if (typeof node[seg] !== "object" || node[seg] === null) node[seg] = {};
      node = node[seg];
    }
    if (segs.length === 0) return value;
    node[segs[segs.length - 1]] = value;
    return root;
  }
  function demoUpdateAt(root, path, patch) {
    const existing = demoGetAt(root, path);
    const merged =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...existing, ...patch }
        : { ...patch };
    return demoSetAt(root, path, merged);
  }
  function demoRemoveAt(root, path) {
    const segs = splitPath(path);
    if (segs.length === 0) return {};
    let node = root;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i];
      if (typeof node[seg] !== "object" || node[seg] === null) return root;
      node = node[seg];
    }
    delete node[segs[segs.length - 1]];
    return root;
  }

  function notifyLocalListeners(changedPath) {
    for (const [path, callbacks] of localListeners.entries()) {
      // 부모/자식 어느 경로가 바뀌어도 서로 영향을 줄 수 있으므로,
      // 등록된 모든 리스너 값을 다시 계산해 알려준다 (교실 규모 데이터라
      // 비용이 크지 않음).
      const root = demoGetRoot();
      const value = demoGetAt(root, path);
      callbacks.forEach((cb) => cb(value === undefined ? null : value));
    }
  }

  if (channel) {
    channel.onmessage = () => notifyLocalListeners();
  }
  // 다른 탭이 localStorage를 바꾼 경우(BroadcastChannel 미지원 브라우저 대비)
  window.addEventListener("storage", (e) => {
    if (e.key === DEMO_KEY) notifyLocalListeners();
  });

  function demoRef(path) {
    return {
      path,
      async set(value) {
        const root = demoGetRoot();
        demoSetAt(root, path, value);
        demoSaveRoot(root);
        notifyLocalListeners();
        if (channel) channel.postMessage({ type: "change", path });
      },
      async update(patch) {
        const root = demoGetRoot();
        demoUpdateAt(root, path, patch);
        demoSaveRoot(root);
        notifyLocalListeners();
        if (channel) channel.postMessage({ type: "change", path });
      },
      async remove() {
        const root = demoGetRoot();
        demoRemoveAt(root, path);
        demoSaveRoot(root);
        notifyLocalListeners();
        if (channel) channel.postMessage({ type: "change", path });
      },
      async once() {
        const root = demoGetRoot();
        const v = demoGetAt(root, path);
        return v === undefined ? null : v;
      },
      onValue(cb) {
        if (!localListeners.has(path)) localListeners.set(path, new Set());
        localListeners.get(path).add(cb);
        // 최초 1회 즉시 호출
        const root = demoGetRoot();
        const v = demoGetAt(root, path);
        cb(v === undefined ? null : v);
        return () => {
          const set = localListeners.get(path);
          if (set) set.delete(cb);
        };
      },
    };
  }

  // ---------------- Firebase 모드 ----------------
  function firebaseRef(path) {
    const ref = fbDb.ref(path);
    return {
      path,
      async set(value) {
        await ref.set(value);
      },
      async update(patch) {
        await ref.update(patch);
      },
      async remove() {
        await ref.remove();
      },
      async once() {
        const snap = await ref.once("value");
        return snap.val();
      },
      onValue(cb) {
        const handler = (snap) => cb(snap.val());
        ref.on("value", handler);
        return () => ref.off("value", handler);
      },
    };
  }

  function ref(path) {
    return mode === "firebase" ? firebaseRef(path) : demoRef(path);
  }

  function getMode() {
    return mode;
  }

  return { ref, getMode, ready };
})();
