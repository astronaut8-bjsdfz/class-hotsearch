/* ============================================================
   app.js —— 班级热搜榜的逻辑
   ------------------------------------------------------------
   配置都集中在 CONFIG 里，想改班级名、倒计时日期、栏目，
   只改这一段就够了。
   ============================================================ */

const CONFIG = {
  siteTitle: "班级热搜榜",
  className: "初三七班",            // 建议不写学校全称
  countdownLabel: "距离中考",        // 不想要倒计时就把 countdownDate 设为空字符串
  countdownDate: "2027-06-20",
  settleNote: "每日 20:00 结算 · 热度前 10 名上榜",
  maxLength: 30,
  categories: ["日常", "学习", "活动", "大事", "心声"],
  newItemHeat: 62                   // 新提交条目的初始热度
};

const LS_LIKES = "hotsearch.likes.v1";
const LS_NICK = "hotsearch.nickname.v1";

const state = {
  days: [],
  active: 0,
  likeKeys: new Set()
};

/* ---------- 小工具 ---------- */

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function fmtDate(d) {
  return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 · " + WEEK[d.getDay()];
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

function itemKey(day, idx) {
  return day.date + "#" + idx;
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
  toastTimer = setTimeout(() => box.classList.remove("show"), 2600);
}

/* ---------- 顶部信息 ---------- */

function renderHeader() {
  document.title = CONFIG.siteTitle;
  document.getElementById("siteTitle").textContent = CONFIG.siteTitle;
  document.getElementById("className").textContent = CONFIG.className;
  document.getElementById("settleNote").textContent = CONFIG.settleNote;

  document.getElementById("todayText").textContent = fmtDate(new Date());

  const left = daysUntil(CONFIG.countdownDate);
  const box = document.getElementById("countdownText");
  if (left === null) {
    box.textContent = "";
  } else if (left > 0) {
    box.textContent = CONFIG.countdownLabel + "还有 " + left + " 天";
  } else if (left === 0) {
    box.textContent = CONFIG.countdownLabel + "就是今天";
  } else {
    box.textContent = "";
  }
}

/* ---------- 日期切换 ---------- */

function renderTabs() {
  const wrap = document.getElementById("dayTabs");
  wrap.innerHTML = "";
  state.days.forEach((day, i) => {
    const btn = el("button", "tab", day.label);
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", i === state.active ? "true" : "false");
    btn.addEventListener("click", () => {
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

  day.items.forEach((item, idx) => {
    const rank = idx + 1;

    const li = el("li", "rank-item");
    if (rank <= 6) li.setAttribute("data-top", String(rank));
    if (item.isNew) li.classList.add("is-new-row");

    li.appendChild(el("div", "num", String(rank)));

    const body = el("div", "body");
    const titleLine = el("div", "title-line");
    titleLine.appendChild(el("p", "content", item.content));
    if (item.isNew) titleLine.appendChild(el("span", "badge-new", "新"));
    const cat = el("span", "cat", item.category);
    cat.setAttribute("data-cat", item.category);
    titleLine.appendChild(cat);
    body.appendChild(titleLine);

    const sub = el("div", "sub");

    const heat = el("span", "heat");
    heat.innerHTML = FLAME;
    heat.appendChild(document.createTextNode(" " + fmtHeat(item.heat)));
    sub.appendChild(heat);

    const delta = el("span");
    if (item.delta === null || item.delta === undefined) {
      delta.className = "delta up";
      delta.textContent = "新上榜";
    } else if (item.delta > 0) {
      delta.className = "delta up";
      delta.textContent = "↑ " + item.delta;
    } else if (item.delta < 0) {
      delta.className = "delta down";
      delta.textContent = "↓ " + Math.abs(item.delta);
    } else {
      delta.className = "delta flat";
      delta.textContent = "— 持平";
    }
    sub.appendChild(delta);

    sub.appendChild(el("span", "", "来自 " + item.nickname));
    body.appendChild(sub);
    li.appendChild(body);

    // 点赞
    const key = itemKey(day, idx);
    const liked = state.likeKeys.has(key);

    const btn = el("button", "like");
    btn.type = "button";
    btn.setAttribute("aria-pressed", liked ? "true" : "false");
    btn.innerHTML = HEART;
    btn.appendChild(document.createTextNode(" " + item.likes));

    btn.addEventListener("click", () => {
      if (state.likeKeys.has(key)) {
        state.likeKeys.delete(key);
        item.likes = Math.max(0, item.likes - 1);
        item.heat = Math.max(0, item.heat - 10);
      } else {
        state.likeKeys.add(key);
        item.likes += 1;
        item.heat += 10;
      }
      saveLikes();
      btn.setAttribute("aria-pressed", state.likeKeys.has(key) ? "true" : "false");
      btn.innerHTML = HEART;
      btn.appendChild(document.createTextNode(" " + item.likes));
      const h = li.querySelector(".heat");
      h.innerHTML = FLAME;
      h.appendChild(document.createTextNode(" " + fmtHeat(item.heat)));
    });

    li.appendChild(btn);
    list.appendChild(li);
  });
}

/* ---------- 点赞记录 ---------- */

function loadLikes() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_LIKES) || "[]");
    state.likeKeys = new Set(Array.isArray(raw) ? raw : []);
  } catch (e) {
    state.likeKeys = new Set();
  }
  state.likeKeys.forEach((key) => {
    const [date, idxStr] = key.split("#");
    const day = state.days.find((d) => d.date === date);
    if (!day) return;
    const item = day.items[Number(idxStr)];
    if (item) {
      item.likes += 1;
      item.heat += 10;
    }
  });
}

function saveLikes() {
  try {
    localStorage.setItem(LS_LIKES, JSON.stringify(Array.from(state.likeKeys)));
  } catch (e) { /* 无痕模式下忽略 */ }
}

/* ---------- 提交表单 ---------- */

let pickedCat = CONFIG.categories[0];

function renderCats() {
  const row = document.getElementById("catRow");
  row.innerHTML = "";
  CONFIG.categories.forEach((name, i) => {
    const btn = el("button", "cat-pick", name);
    btn.type = "button";
    btn.setAttribute("aria-pressed", i === 0 ? "true" : "false");
    btn.addEventListener("click", () => {
      pickedCat = name;
      Array.from(row.children).forEach((c) => c.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");
    });
    row.appendChild(btn);
  });
}

function bindSubmit() {
  const nickInput = document.getElementById("nicknameInput");
  const contentInput = document.getElementById("contentInput");
  const counter = document.getElementById("counterNum");

  try {
    const saved = localStorage.getItem(LS_NICK);
    if (saved) nickInput.value = saved;
  } catch (e) { /* ignore */ }

  contentInput.addEventListener("input", () => {
    counter.textContent = String(contentInput.value.length);
  });

  document.getElementById("submitBtn").addEventListener("click", () => {
    const text = contentInput.value.trim();
    const nick = nickInput.value.trim() || "匿名同学";

    if (text.length < 4) {
      toast("再多写两个字吧，太短了看不出发生了什么");
      contentInput.focus();
      return;
    }

    try { localStorage.setItem(LS_NICK, nick); } catch (e) { /* ignore */ }

    const today = state.days[0];
    today.items.push({
      nickname: nick,
      content: text,
      category: pickedCat,
      heat: CONFIG.newItemHeat + Math.floor(Math.random() * 20),
      delta: null,
      likes: 0,
      isNew: true
    });

    contentInput.value = "";
    counter.textContent = "0";

    state.active = 0;
    renderTabs();
    renderList();

    toast("已提交！等它攒够热度就能挤进前 10");
  });
}

/* ---------- 启动 ---------- */

function boot() {
  const data = window.HOTSEARCH_MOCK;
  if (!data || !Array.isArray(data.days) || data.days.length === 0) {
    document.getElementById("rankList").appendChild(
      el("li", "card-note", "还没有任何数据。")
    );
    return;
  }

  state.days = data.days.map((d) => ({
    date: d.date,
    label: d.label,
    items: d.items.map((it) => Object.assign({}, it))
  }));

  renderHeader();
  loadLikes();
  renderTabs();
  renderList();
  renderCats();
  bindSubmit();
}

document.addEventListener("DOMContentLoaded", boot);
