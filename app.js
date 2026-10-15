/* ============================================================
   app.js —— 班级热搜榜的逻辑
   ------------------------------------------------------------
   数据来源有两套：
     1) 配好了数据库（config.js 里填了值）→ 全部读写数据库
     2) 没配 → 自动退回本地示例数据，页面照样能看，但刷新不留痕
   两套走同一套渲染逻辑，所以页面长得一模一样。
   ============================================================ */

const CONFIG = {
  siteTitle: "班级热搜榜",
  className: "初三七班",            // 建议不写学校全称
  countdownLabel: "距离中考",        // 不想要倒计时就把 countdownDate 设为空字符串
  countdownDate: "2027-06-20",
  boardNote: "热度实时更新",
  maxLength: 30,
  minLength: 4,
  categories: ["日常", "学习", "活动", "大事", "心声"]
};

const LS_LIKES = "hotsearch.likes.v2";
const LS_NICK = "hotsearch.nickname.v1";
const LS_SNAP = "hotsearch.rankSnap.v1";

const state = {
  days: [],
  active: 0,
  likeKeys: new Set(),
  baseline: {},      // 上次查看时各条的排名，用来算升降箭头
  backendOk: false
};

/* ---------- 数据库连接层 ---------- */

const SB = window.HOTSEARCH_BACKEND || {};
const HAS_BACKEND = !!(SB.url && SB.anonKey);

function sbUrl(path) {
  return SB.url.replace(/\/+$/, "") + "/rest/v1/" + path;
}

async function sbFetch(path, opts) {
  const o = opts || {};
  const res = await fetch(sbUrl(path), {
    method: o.method || "GET",
    headers: Object.assign({
      "apikey": SB.anonKey,
      "Authorization": "Bearer " + SB.anonKey,
      "Content-Type": "application/json"
    }, o.headers || {}),
    body: o.body
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error("HTTP " + res.status + " " + t.slice(0, 160));
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function loadDaysFromBackend() {
  const rows = await sbFetch(
    SB.table + "?select=id,day,nickname,content,category,heat,likes" +
    "&order=day.desc,heat.desc&limit=800"
  );
  const map = new Map();
  (rows || []).forEach(function (r) {
    if (!map.has(r.day)) map.set(r.day, []);
    map.get(r.day).push({
      id: r.id,
      nickname: r.nickname,
      content: r.content,
      category: r.category,
      heat: r.heat,
      likes: r.likes
    });
  });
  const days = [];
  map.forEach(function (items, date) {
    days.push({ date: date, label: dayLabel(date), items: items });
  });
  days.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  return days;
}

async function submitToBackend(nickname, content, category) {
  const rows = await sbFetch(SB.table, {
    method: "POST",
    headers: { "Prefer": "return=representation" },
    body: JSON.stringify({ nickname: nickname, content: content, category: category })
  });
  return rows && rows[0];
}

async function likeOnBackend(id) {
  return await sbFetch("rpc/add_like", {
    method: "POST",
    body: JSON.stringify({ item_id: id })
  });
}

/* ---------- 小工具 ---------- */

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function toDateStr(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + dd;
}

function todayStr() { return toDateStr(new Date()); }

function dayLabel(dateStr) {
  if (dateStr === todayStr()) return "今天";
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (dateStr === toDateStr(y)) return "昨天";
  const p = String(dateStr).split("-");
  return Number(p[1]) + "月" + Number(p[2]) + "日";
}

function fmtDate(d) {
  return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() +
         "日 · " + WEEK[d.getDay()];
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  const target = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}

function fmtHeat(n) {
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  return String(n);
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

let toastTimer = null;
function toast(msg) {
  const box = document.getElementById("toast");
  box.textContent = msg;
  box.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { box.classList.remove("show"); }, 2800);
}

function readSnap() {
  try { return JSON.parse(localStorage.getItem(LS_SNAP) || "{}") || {}; }
  catch (e) { return {}; }
}

function writeSnap(map) {
  try { localStorage.setItem(LS_SNAP, JSON.stringify(map)); } catch (e) { /* 无痕模式忽略 */ }
}

/* ---------- 顶部信息 ---------- */

function renderHeader() {
  document.title = CONFIG.siteTitle;
  document.getElementById("siteTitle").textContent = CONFIG.siteTitle;
  document.getElementById("className").textContent = CONFIG.className;
  document.getElementById("boardNote").textContent = CONFIG.boardNote;
  document.getElementById("todayText").textContent = fmtDate(new Date());

  const left = daysUntil(CONFIG.countdownDate);
  const box = document.getElementById("countdownText");
  if (left === null || left < 0) {
    box.textContent = "";
  } else if (left === 0) {
    box.textContent = CONFIG.countdownLabel + "就是今天";
  } else {
    box.textContent = CONFIG.countdownLabel + "还有 " + left + " 天";
  }
}

/* ---------- 数据状态提示 ---------- */

function setNote(kind, text) {
  const box = document.getElementById("dataNote");
  if (!box) return;
  box.className = "note-box is-" + kind;
  box.textContent = text;
}

function refreshNote() {
  if (state.backendOk) {
    setNote("live", "已接入数据库。同学提交的内容会长期保存，换手机、换电脑都能看到。");
  }
}

/* ---------- 日期切换 ---------- */

function renderTabs() {
  const wrap = document.getElementById("dayTabs");
  wrap.innerHTML = "";
  state.days.forEach(function (day, i) {
    const btn = el("button", "tab", day.label);
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", i === state.active ? "true" : "false");
    btn.addEventListener("click", function () {
      state.active = i;
      renderTabs();
      renderList();
    });
    wrap.appendChild(btn);
  });
}

/* ---------- 榜单 ---------- */

const FLAME = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" aria-hidden="true">' +
  '<path d="M12 2.6c.4 2.6-.6 4.2-2 5.6-1.5 1.5-3.1 3-3.1 5.7a6.1 6.1 0 0 0 12.2 0c0-2.4-1.2-4-2.3-5.4-.6 1-1.4 1.5-2.1 1.7.7-2.6.1-5.5-2.7-7.6Z" ' +
  'stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

const HEART = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" aria-hidden="true">' +
  '<path d="M12 20s-7.5-4.6-7.5-9.6A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20Z" ' +
  'stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

function renderList() {
  const list = document.getElementById("rankList");
  const day = state.days[state.active];
  list.innerHTML = "";
  if (!day) return;

  if (day.items.length === 0) {
    const empty = el("li", "empty-state");
    empty.appendChild(el("p", "empty-title", "今天还没有人爆料"));
    empty.appendChild(el("p", "empty-sub", "在右边写一句，你就是第一条热搜。"));
    list.appendChild(empty);
    return;
  }

  day.items.forEach(function (item, idx) {
    const rank = idx + 1;
    const key = String(item.id);

    // 升降：和上次查看时的名次比
    let delta = 0;
    let isNew = false;
    if (state.baseline[key] != null) {
      delta = state.baseline[key] - rank;
    } else {
      isNew = true;
    }

    const li = el("li", "rank-item");
    if (rank <= 6) li.setAttribute("data-top", String(rank));
    if (isNew) li.classList.add("is-new-row");

    li.appendChild(el("div", "num", String(rank)));

    const body = el("div", "body");
    const titleLine = el("div", "title-line");
    titleLine.appendChild(el("p", "content", item.content));
    if (isNew) titleLine.appendChild(el("span", "badge-new", "新"));
    const cat = el("span", "cat", item.category);
    cat.setAttribute("data-cat", item.category);
    titleLine.appendChild(cat);
    body.appendChild(titleLine);

    const sub = el("div", "sub");

    const heat = el("span", "heat");
    heat.innerHTML = FLAME;
    heat.appendChild(document.createTextNode(" " + fmtHeat(item.heat)));
    sub.appendChild(heat);

    const d = el("span");
    if (isNew) {
      d.className = "delta up";
      d.textContent = "新上榜";
    } else if (delta > 0) {
      d.className = "delta up";
      d.textContent = "↑ " + delta;
    } else if (delta < 0) {
      d.className = "delta down";
      d.textContent = "↓ " + Math.abs(delta);
    } else {
      d.className = "delta flat";
      d.textContent = "— 持平";
    }
    sub.appendChild(d);

    sub.appendChild(el("span", "", "来自 " + item.nickname));
    body.appendChild(sub);
    li.appendChild(body);

    // 点赞
    const liked = state.likeKeys.has(key);
    const btn = el("button", "like");
    btn.type = "button";
    btn.setAttribute("aria-pressed", liked ? "true" : "false");
    btn.innerHTML = HEART;
    btn.appendChild(document.createTextNode(" " + item.likes));

    btn.addEventListener("click", function () {
      onLike(item, key, li, btn);
    });

    li.appendChild(btn);
    list.appendChild(li);
  });
}

/* ---------- 点赞 ---------- */

async function onLike(item, key, li, btn) {
  if (state.likeKeys.has(key)) {
    toast("你已经点过赞了");
    return;
  }

  if (state.backendOk) {
    btn.disabled = true;
    try {
      const newLikes = await likeOnBackend(item.id);
      item.likes = (typeof newLikes === "number") ? newLikes : item.likes + 1;
      item.heat += 10;
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      toast("点赞失败，检查一下网络再试");
      return;
    }
    btn.disabled = false;
  } else {
    item.likes += 1;
    item.heat += 10;
  }

  state.likeKeys.add(key);
  saveLikes();

  btn.setAttribute("aria-pressed", "true");
  btn.innerHTML = HEART;
  btn.appendChild(document.createTextNode(" " + item.likes));

  const h = li.querySelector(".heat");
  h.innerHTML = FLAME;
  h.appendChild(document.createTextNode(" " + fmtHeat(item.heat)));
}

function loadLikes() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_LIKES) || "[]");
    state.likeKeys = new Set(Array.isArray(raw) ? raw : []);
  } catch (e) {
    state.likeKeys = new Set();
  }
}

function saveLikes() {
  try {
    localStorage.setItem(LS_LIKES, JSON.stringify(Array.from(state.likeKeys)));
  } catch (e) { /* ignore */ }
}

/* ---------- 提交表单 ---------- */

let pickedCat = CONFIG.categories[0];
let submitting = false;

function renderCats() {
  const row = document.getElementById("catRow");
  row.innerHTML = "";
  CONFIG.categories.forEach(function (name, i) {
    const btn = el("button", "cat-pick", name);
    btn.type = "button";
    btn.setAttribute("aria-pressed", i === 0 ? "true" : "false");
    btn.addEventListener("click", function () {
      pickedCat = name;
      Array.from(row.children).forEach(function (c) {
        c.setAttribute("aria-pressed", "false");
      });
      btn.setAttribute("aria-pressed", "true");
    });
    row.appendChild(btn);
  });
}

function bindSubmit() {
  const nickInput = document.getElementById("nicknameInput");
  const contentInput = document.getElementById("contentInput");
  const counter = document.getElementById("counterNum");
  const submitBtn = document.getElementById("submitBtn");

  try {
    const saved = localStorage.getItem(LS_NICK);
    if (saved) nickInput.value = saved;
  } catch (e) { /* ignore */ }

  contentInput.addEventListener("input", function () {
    counter.textContent = String(contentInput.value.length);
  });

  submitBtn.addEventListener("click", async function () {
    if (submitting) return;

    const text = contentInput.value.trim();
    const nick = nickInput.value.trim() || "匿名同学";

    if (text.length < CONFIG.minLength) {
      toast("再多写两个字吧，太短了看不出发生了什么");
      contentInput.focus();
      return;
    }
    if (nick.length > 8) {
      toast("昵称最多 8 个字");
      nickInput.focus();
      return;
    }

    try { localStorage.setItem(LS_NICK, nick); } catch (e) { /* ignore */ }

    if (state.backendOk) {
      submitting = true;
      submitBtn.disabled = true;
      submitBtn.textContent = "提交中…";
      try {
        await submitToBackend(nick, text, pickedCat);
      } catch (err) {
        console.error(err);
        submitting = false;
        submitBtn.disabled = false;
        submitBtn.textContent = "提交上去";
        toast("提交失败，检查一下网络再试一次");
        return;
      }
      submitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "提交上去";
    } else {
      // 没有数据库时的本地演示，刷新即消失
      state.days[0].items.push({
        id: "local-" + Date.now(),
        nickname: nick,
        content: text,
        category: pickedCat,
        heat: 62 + Math.floor(Math.random() * 20),
        likes: 0
      });
    }

    contentInput.value = "";
    counter.textContent = "0";
    state.active = 0;

    if (state.backendOk) {
      try {
        await reload();
      } catch (err) {
        console.error(err);
      }
    } else {
      renderTabs();
      renderList();
    }

    toast("提交成功！热度攒够了就往上升");
  });
}

/* ---------- 加载 ---------- */

function mockDays() {
  const data = window.HOTSEARCH_MOCK;
  if (!data || !Array.isArray(data.days)) return [];
  return data.days.map(function (d) {
    return {
      date: d.date,
      label: d.label,
      items: d.items.map(function (it, i) {
        return {
          id: "mock-" + d.date + "-" + i,
          nickname: it.nickname,
          content: it.content,
          category: it.category,
          heat: it.heat,
          likes: it.likes
        };
      })
    };
  });
}

function ensureToday(days) {
  const t = todayStr();
  for (let i = 0; i < days.length; i++) {
    if (days[i].date === t) return days;
  }
  days.unshift({ date: t, label: "今天", items: [] });
  return days;
}

function captureBaseline() {
  // 读进上次记录的排名用于渲染箭头，同时把当前名次存下来供下次访问比较
  const prev = readSnap();
  const today = state.days[0];
  const cur = {};
  if (today) {
    today.items.forEach(function (it, i) { cur[String(it.id)] = i + 1; });
  }

  // 第一次访问没有历史可比，就按「名次没变化」处理，
  // 否则所有条目都会被标记成「新」，看着像出 bug。
  if (Object.keys(prev).length === 0) {
    state.baseline = Object.assign({}, cur);
  } else {
    state.baseline = prev;
  }

  writeSnap(cur);
}

async function reload() {
  const days = ensureToday(await loadDaysFromBackend());
  state.days = days;
  state.active = 0;
  captureBaseline();
  renderTabs();
  renderList();
}

async function boot() {
  renderHeader();
  loadLikes();
  renderCats();
  bindSubmit();

  if (HAS_BACKEND) {
    try {
      await reload();
      state.backendOk = true;
      refreshNote();
      return;
    } catch (err) {
      console.error(err);
      state.days = ensureToday(mockDays());
      setNote("error", "连接数据库失败，现在显示的是示例数据。错误信息：" + err.message);
    }
  } else {
    state.days = ensureToday(mockDays());
    setNote("preview",
      "当前是预览版：还没接数据库，提交的内容刷新就会消失，榜单上的也只是示例数据。");
  }

  captureBaseline();
  renderTabs();
  renderList();
}

document.addEventListener("DOMContentLoaded", boot);
