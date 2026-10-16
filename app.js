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
  className: "高一8班",             // 建议不写学校全称
  countdownLabel: "距离期中考试",     // 不想要倒计时就把 countdownDate 设为空字符串
  countdownDate: "2026-11-04",
  boardNote: "热度实时更新",
  maxLength: 30,
  minLength: 4,
  categories: ["日常", "学习", "活动", "大事", "心声"]
};

const LS_LIKES = "hotsearch.likes.v2";
const LS_NICK = "hotsearch.nickname.v1";
// v2：以前存的是「某一天的排名」，现在改成「每个周各存一份排名」
const LS_SNAP = "hotsearch.rankSnap.v2";
const SNAP_KEEP = 12;   // 只保留最近 12 周的名次快照，别让本地存储无限长大

const state = {
  weeks: [],
  active: 0,
  likeKeys: new Set(),
  baselineByWeek: {},  // 每个周各自的「上次查看时的名次」，用来算升降箭头
  backendOk: false,
  // 公告栏
  announce: [],
  announceAdmin: false,        // 是否处于管理模式
  announceLoginOpen: false,    // 是否正在显示口令输入框
  announceOpen: false,         // 通知列表是否展开
  announceFormOpen: false,     // 发布表单是否展开
  announceEditingId: null,     // 正在编辑哪一条（null = 新建）
  adminToken: ""
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

/* 同一个周里，热度高的排前面；热度一样时，后提交的排前面 */
function sortItems(items) {
  return items.sort(function (a, b) {
    if (b.heat !== a.heat) return b.heat - a.heat;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });
}

async function loadWeeksFromBackend() {
  const rows = await sbFetch(
    SB.table + "?select=id,day,nickname,content,category,heat,likes" +
    "&order=day.desc,heat.desc&limit=1000"
  );

  // 数据库里每条都带着自己那天的日期（day），按它归并成周。
  // 所以榜单是「按周看」还是「按天看」纯属显示方式，数据完全不用改。
  const map = new Map();
  (rows || []).forEach(function (r) {
    const wk = weekStartOf(r.day);
    if (!map.has(wk)) map.set(wk, []);
    map.get(wk).push({
      id: r.id,
      nickname: r.nickname,
      content: r.content,
      category: r.category,
      heat: r.heat,
      likes: r.likes
    });
  });

  const weeks = [];
  map.forEach(function (items, monday) {
    // 接口按「日期倒序 + 同日内热度倒序」返回，跨天的那部分得自己再排一次
    weeks.push(makeWeek(monday, sortItems(items)));
  });
  weeks.sort(function (a, b) { return a.key < b.key ? 1 : -1; });
  return weeks;
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

// 取消点赞。跟加赞一样必须走数据库函数 ——
// 网页端本来就没有修改数据的权限。
async function unlikeOnBackend(id) {
  return await sbFetch("rpc/remove_like", {
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

/* ---------- 周的计算 ----------
   一个周从周一算到周日（周日是这一周的收尾）。
   数据库里每条记录都带着自己那天的日期，所以「这条属于第几周」
   是现算出来的，不用额外存字段，也不用改数据库。 */

function parseDate(s) {
  const p = String(s).split("-").map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

/* 传任意一天，返回它所在那一周的周一 */
function weekStartOf(dateStr) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toDateStr(d);
}

function weekEndOf(monday) {
  const d = parseDate(monday);
  d.setDate(d.getDate() + 6);
  return d;
}

/* 完整日期段：10月12日–10月18日 */
function weekRange(monday) {
  const a = parseDate(monday);
  const b = weekEndOf(monday);
  return (a.getMonth() + 1) + "月" + a.getDate() + "日–" +
         (b.getMonth() + 1) + "月" + b.getDate() + "日";
}

/* 标签用的紧凑写法：10.12–10.18 */
function weekTile(monday) {
  const a = parseDate(monday);
  const b = weekEndOf(monday);
  return (a.getMonth() + 1) + "." + a.getDate() + "–" +
         (b.getMonth() + 1) + "." + b.getDate();
}

/* 最近两周用「本周 / 上周」这种更好认的说法，更早的才用日期 */
function isThisWeek(monday) { return monday === weekStartOf(todayStr()); }

function isLastWeek(monday) {
  const d = parseDate(weekStartOf(todayStr()));
  d.setDate(d.getDate() - 7);
  return monday === toDateStr(d);
}

function weekLabel(monday) {
  if (isThisWeek(monday)) return "本周";
  if (isLastWeek(monday)) return "上周";
  return weekTile(monday);
}

function weekHeading(monday) {
  if (isThisWeek(monday)) return "本周热搜";
  if (isLastWeek(monday)) return "上周热搜";
  return "热搜榜";
}

function makeWeek(monday, items) {
  return {
    key: monday,                    // 这一周周一的日期，当唯一标识
    label: weekLabel(monday),       // 标签上显示的
    range: weekRange(monday),       // 右上角的完整日期段
    heading: weekHeading(monday),   // 榜单大标题
    items: items || []
  };
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
  // 榜单标题和右上角的日期段会跟着选中的周变，交给 renderBoardHead() 处理
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

/* ---------- 页面自检 ---------- */
// 网页、样式、脚本是分开的四个文件，浏览器对它们的缓存又各管各的，
// 偶尔会出现「网页是新的、脚本是旧的」这种错配。
// 提前查一遍必需的元素在不在，好给出人话提示，而不是甩一串英文报错。
const REQUIRED_IDS = [
  "weekTabs", "rankList", "boardHeading", "boardNote",
  "catRow", "nicknameInput", "contentInput", "submitBtn", "dataNote"
];

function missingParts() {
  return REQUIRED_IDS.filter(function (id) {
    return !document.getElementById(id);
  });
}

/* ---------- 周切换 ---------- */

function renderTabs() {
  const wrap = document.getElementById("weekTabs");
  wrap.innerHTML = "";
  state.weeks.forEach(function (wk, i) {
    const btn = el("button", "tab", wk.label);
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.title = wk.range;   // 鼠标悬停能看到完整日期段
    btn.setAttribute("aria-selected", i === state.active ? "true" : "false");
    btn.addEventListener("click", function () {
      if (state.active === i) return;
      state.active = i;
      renderTabs();
      renderList();
    });
    wrap.appendChild(btn);
  });
}

/* 榜单大标题 + 右上角日期段，都跟着当前选中的那一周走 */
function renderBoardHead() {
  const wk = state.weeks[state.active];
  document.getElementById("boardHeading").textContent =
    wk ? wk.heading : "热搜榜";
  document.getElementById("boardNote").textContent =
    wk ? (wk.range + " · " + CONFIG.boardNote) : CONFIG.boardNote;
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
  const wk = state.weeks[state.active];
  renderBoardHead();
  list.innerHTML = "";
  if (!wk) return;

  // 升降箭头按周算：本周的条目跟「上次看本周时」比，
  // 上周的条目就跟「上次看上周时」比，互不干扰。
  const base = baselineFor(wk.key, wk.items);

  if (wk.items.length === 0) {
    const empty = el("li", "empty-state");
    empty.appendChild(el("p", "empty-title", "这周还没有人爆料"));
    empty.appendChild(el("p", "empty-sub", "写一句，你就是这周的第一条热搜。"));
    list.appendChild(empty);
    return;
  }

  wk.items.forEach(function (item, idx) {
    const rank = idx + 1;
    const key = String(item.id);

    // 升降：和上次查看时的名次比
    let delta = 0;
    let isNew = false;
    if (base[key] != null) {
      delta = base[key] - rank;
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

    // 点赞（再点一次就取消）
    const liked = state.likeKeys.has(key);
    const btn = el("button", "like");
    btn.type = "button";
    btn.setAttribute("aria-pressed", liked ? "true" : "false");
    btn.title = liked ? "再点一次取消点赞" : "点一下点赞";
    btn.innerHTML = HEART;
    btn.appendChild(document.createTextNode(" " + item.likes));

    btn.addEventListener("click", function () {
      toggleLike(item, key, li, btn);
    });

    li.appendChild(btn);
    list.appendChild(li);
  });
}

/* ---------- 点赞 / 取消点赞 ---------- */

/* 按一下赞，再按一下取消。
   只看按钮的红色填充和数字变化就能看出当前是哪一态。 */
async function toggleLike(item, key, li, btn) {
  const liked = state.likeKeys.has(key);   // 之前点过没

  if (state.backendOk) {
    btn.disabled = true;                   // 防手快连点，中途不许重复提交
    try {
      const n = liked ? await unlikeOnBackend(item.id)
                      : await likeOnBackend(item.id);
      // 服务端可能返回 null（比如取消时它那边已经是 0 了），那就本地算
      item.likes = (typeof n === "number")
        ? n
        : Math.max(item.likes + (liked ? -1 : 1), 0);
      item.heat = liked ? Math.max(item.heat - 10, 60) : item.heat + 10;
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      toast(liked ? "取消失败，检查一下网络再试" : "点赞失败，检查一下网络再试");
      return;
    }
    btn.disabled = false;
  } else {
    item.likes = Math.max(item.likes + (liked ? -1 : 1), 0);
    item.heat = liked ? Math.max(item.heat - 10, 60) : item.heat + 10;
  }

  if (liked) state.likeKeys.delete(key);
  else state.likeKeys.add(key);
  saveLikes();

  paintLike(btn, item, !liked);

  // 热度原地改，不重新整榜排序 —— 否则手上的那一行会在指头底下跳走
  const h = li.querySelector(".heat");
  if (h) {
    h.innerHTML = FLAME;
    h.appendChild(document.createTextNode(" " + fmtHeat(item.heat)));
  }
}

/* 按最新数字重画点赞按钮 */
function paintLike(btn, item, liked) {
  btn.setAttribute("aria-pressed", liked ? "true" : "false");
  btn.title = liked ? "再点一次取消点赞" : "点一下点赞";
  btn.innerHTML = HEART;
  btn.appendChild(document.createTextNode(" " + item.likes));
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
      state.weeks[0].items.push({
        id: "local-" + Date.now(),
        nickname: nick,
        content: text,
        category: pickedCat,
        heat: 62 + Math.floor(Math.random() * 20),
        likes: 0
      });
      sortItems(state.weeks[0].items);
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

/* ============================================================
   公告栏
   ------------------------------------------------------------
   读：普通访客直接读表，数据库的行级安全策略保证只能拿到
       「显示中」的那些公告。
   写：网页端对公告表没有任何写权限，必须调用数据库里那三个
       带口令的函数（ann_save / ann_delete / ann_list）。
       所以就算有人扒了源码，也发不出一条公告 —— 他没口令。
   口令存在浏览器 localStorage 里，只在这台设备上生效。
   ============================================================ */

const LS_ADMIN_TOKEN = "hotsearch.adminToken.v1";
const LS_ANN_OPEN = "hotsearch.announceOpen.v1";
const ANN_TABLE = SB.announceTable || "announcements";

const ANN_LEVELS = [
  { key: "normal", label: "普通" },
  { key: "important", label: "重要" },
  { key: "urgent", label: "紧急" }
];

const CHEV = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" aria-hidden="true">' +
  '<path d="M6 9.5 12 15.5 18 9.5" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

let annLevel = "normal";
let annSaving = false;

function readToken() {
  try { return localStorage.getItem(LS_ADMIN_TOKEN) || ""; } catch (e) { return ""; }
}

function writeToken(t) {
  try {
    if (t) localStorage.setItem(LS_ADMIN_TOKEN, t);
    else localStorage.removeItem(LS_ADMIN_TOKEN);
  } catch (e) { /* 无痕模式忽略 */ }
}

function readAnnOpen() {
  try { return localStorage.getItem(LS_ANN_OPEN) === "1"; } catch (e) { return false; }
}

function writeAnnOpen(v) {
  try { localStorage.setItem(LS_ANN_OPEN, v ? "1" : "0"); } catch (e) { /* ignore */ }
}

function pad2(n) { return String(n).padStart(2, "0"); }

function fmtWhen(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return Math.floor(diff / 60) + " 分钟前";
  if (diff < 86400) return Math.floor(diff / 3600) + " 小时前";
  if (diff < 172800) return "昨天 " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  return (d.getMonth() + 1) + "月" + d.getDate() + "日 " +
         pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

/* 把数据库返回的错误信息抠成人话 */

function friendly(err) {
  const raw = String((err && err.message) || err || "");
  const hit = raw.match(/\{[\s\S]*\}\s*$/);
  if (hit) {
    try {
      const o = JSON.parse(hit[0]);
      if (o && o.message) return o.message;
    } catch (e) { /* 不是 JSON，往下走 */ }
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) return "网络不通，检查一下连接";
  return raw.slice(0, 90) || "未知错误";
}

/* ----- 数据库读写 ----- */

async function loadAnnouncements() {
  return await sbFetch(
    ANN_TABLE + "?select=id,created_at,updated_at,title,body,level,author,pinned,visible" +
    "&order=pinned.desc,created_at.desc&limit=50"
  );
}

async function annVerify(token) {
  try {
    const r = await sbFetch("rpc/ann_check", {
      method: "POST",
      body: JSON.stringify({ token: token })
    });
    return { ok: r === true, err: null };
  } catch (e) {
    return { ok: false, err: e.message };
  }
}

async function annListAdmin(token) {
  return await sbFetch("rpc/ann_list", {
    method: "POST",
    body: JSON.stringify({ token: token })
  });
}

async function annSaveApi(payload) {
  return await sbFetch("rpc/ann_save", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

async function annDeleteApi(token, id) {
  return await sbFetch("rpc/ann_delete", {
    method: "POST",
    body: JSON.stringify({ token: token, p_id: id })
  });
}

/* ----- 渲染 ----- */

function renderAnnounce() {
  const sec = document.getElementById("announceSection");
  if (!sec) return;

  const list = state.announce || [];
  const admin = state.announceAdmin;
  const loginOpen = state.announceLoginOpen && !admin;
  const has = list.length > 0;

  // 没有公告、也不在管理状态 → 整块不出现，页面跟以前一模一样
  const show = HAS_BACKEND && (has || admin || loginOpen);
  sec.hidden = !show;
  if (!show) {
    // 横幅顺手也收起来。父级已经 display:none 了，视觉上看不出差别，
    // 但万一以后判断逻辑走岔，也不至于它单独露出来。
    const b = document.getElementById("announceBar");
    if (b) b.hidden = true;
    return;
  }

  const bar = document.getElementById("announceBar");
  const ul = document.getElementById("announceList");
  const adminBar = document.getElementById("announceAdminBar");
  const login = document.getElementById("adminLogin");
  const form = document.getElementById("announceForm");

  // 管理模式下列表整个摊开，不套滚动框
  sec.classList.toggle("is-admin", admin);

  /* 顶部那条 */
  bar.hidden = !has;
  if (has) {
    const top = list[0];
    sec.setAttribute("data-level", top.level || "normal");

    const lead = document.getElementById("announceLead");
    lead.innerHTML = "";
    lead.appendChild(el("b", "", top.title || "通知"));
    lead.appendChild(document.createTextNode(top.body || ""));

    const tg = document.getElementById("announceToggle");
    if (list.length > 1 || admin) {
      tg.hidden = false;
      tg.setAttribute("aria-expanded", state.announceOpen ? "true" : "false");
      tg.innerHTML = (state.announceOpen ? "收起" : "共 " + list.length + " 条") + " " + CHEV;
    } else {
      tg.hidden = true;
    }
  }

  /* 展开的列表 */
  ul.hidden = !(has && state.announceOpen);
  ul.innerHTML = "";
  if (has && state.announceOpen) {
    list.forEach(function (a) { ul.appendChild(announceItem(a, admin)); });
  }

  adminBar.hidden = !admin;
  login.hidden = !loginOpen;
  form.hidden = !(admin && state.announceFormOpen);
}

function announceItem(a, admin) {
  const li = el("li", "announce-item");
  li.setAttribute("data-level", a.level || "normal");
  if (a.visible === false) li.classList.add("is-off");

  const head = el("div", "announce-item-head");
  head.appendChild(el("span", "announce-dot"));
  head.appendChild(el("b", "announce-item-title", a.title || "通知"));
  if (a.pinned) head.appendChild(el("span", "announce-pin", "置顶"));
  head.appendChild(el("span", "announce-when", fmtWhen(a.created_at)));
  li.appendChild(head);

  li.appendChild(el("p", "announce-item-body", a.body || ""));

  const foot = el("div", "announce-item-foot");
  foot.appendChild(el("span", "", a.author || "班委会"));
  if (a.visible === false) {
    foot.appendChild(el("span", "announce-hidden-flag", "已隐藏"));
  }
  if (admin) {
    foot.appendChild(el("span", "spacer"));
    const edit = el("button", "announce-act", "编辑");
    edit.type = "button";
    edit.addEventListener("click", function () { openAnnounceForm(a); });
    foot.appendChild(edit);

    const del = el("button", "announce-act danger", "删除");
    del.type = "button";
    del.addEventListener("click", function () { onAnnDelete(a); });
    foot.appendChild(del);
  }
  li.appendChild(foot);
  return li;
}

/* ----- 展开 / 收起 ----- */

function toggleAnnounceOpen() {
  const list = state.announce || [];
  if (list.length === 0) return;
  if (list.length < 2 && !state.announceAdmin) return;
  state.announceOpen = !state.announceOpen;
  writeAnnOpen(state.announceOpen);
  renderAnnounce();
}

/* ----- 口令与登录 ----- */

function setAnnLevel(key) {
  annLevel = key;
  const row = document.getElementById("annLevelRow");
  Array.from(row.children).forEach(function (c) {
    c.setAttribute("aria-pressed", c.getAttribute("data-lv") === key ? "true" : "false");
  });
}

function renderAnnLevels() {
  const row = document.getElementById("annLevelRow");
  row.innerHTML = "";
  ANN_LEVELS.forEach(function (lv) {
    const btn = el("button", "cat-pick lv-pick", lv.label);
    btn.type = "button";
    btn.setAttribute("data-lv", lv.key);
    btn.setAttribute("aria-pressed", lv.key === annLevel ? "true" : "false");
    btn.addEventListener("click", function () { setAnnLevel(lv.key); });
    row.appendChild(btn);
  });
}

function scrollToAnnounce() {
  const sec = document.getElementById("announceSection");
  if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function onAdminBtn() {
  if (!HAS_BACKEND) {
    toast("这个页面还没接数据库，公告功能用不了");
    return;
  }

  if (state.announceAdmin) {
    openAnnounceForm(null);
    return;
  }

  const saved = readToken();
  if (saved) {
    const r = await annVerify(saved);
    if (r.ok) {
      await enterAdmin(saved);
      return;
    }
    writeToken("");  // 口令过期或改过了，清掉重新输
  }

  state.announceLoginOpen = true;
  renderAnnounce();
  scrollToAnnounce();
  setTimeout(function () {
    const i = document.getElementById("adminTokenInput");
    if (i) i.focus();
  }, 160);
}

async function onAdminLogin() {
  const input = document.getElementById("adminTokenInput");
  const tk = input.value.trim();
  if (!tk) { toast("先输入管理口令"); input.focus(); return; }

  const btn = document.getElementById("adminLoginBtn");
  btn.disabled = true;
  btn.textContent = "验证中…";

  const r = await annVerify(tk);

  btn.disabled = false;
  btn.textContent = "进入";

  if (!r.ok) {
    if (r.err && /PGRST202|Could not find the function|404/i.test(r.err)) {
      toast("还没建公告表，先把那段 SQL 跑一遍");
    } else {
      toast("口令不对，再检查一下（注意别带空格）");
      input.select();
    }
    return;
  }

  if (document.getElementById("adminRemember").checked) writeToken(tk);
  input.value = "";
  await enterAdmin(tk);
}

async function enterAdmin(tk) {
  state.adminToken = tk;
  state.announceAdmin = true;
  state.announceLoginOpen = false;
  state.announceOpen = true;
  writeAnnOpen(true);
  await refreshAnnounceAdmin();
  scrollToAnnounce();
  toast("已进入管理模式");
}

async function onAdminLogout() {
  state.announceAdmin = false;
  state.adminToken = "";
  state.announceFormOpen = false;
  state.announceEditingId = null;
  state.announceOpen = readAnnOpen();
  await refreshAnnouncePublic();
  toast("已退出管理模式");
}

async function refreshAnnounceAdmin() {
  const tk = state.adminToken;
  try {
    const rows = await annListAdmin(tk);
    state.announce = Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error(err);
    toast("读取公告失败：" + friendly(err));
  }
  renderAnnounce();
}

async function refreshAnnouncePublic() {
  try {
    const rows = await loadAnnouncements();
    state.announce = Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.warn("公告加载失败", err);
    state.announce = [];
  }
  renderAnnounce();
}

/* ----- 发布 / 修改 / 删除 ----- */

function openAnnounceForm(a) {
  if (!state.announceAdmin) return;

  state.announceFormOpen = true;
  state.announceEditingId = a ? a.id : null;

  const title = document.getElementById("annTitle");
  const body = document.getElementById("annBody");
  const author = document.getElementById("annAuthor");
  const saveBtn = document.getElementById("annSaveBtn");

  document.getElementById("announceFormTitle").textContent =
    a ? "修改这条公告" : "发布一条新公告";

  title.value = a ? (a.title || "") : "";
  body.value = a ? (a.body || "") : "";
  if (a) author.value = a.author || "班委会";

  document.getElementById("annPinned").checked = a ? !!a.pinned : false;
  document.getElementById("annVisible").checked = a ? a.visible !== false : true;
  document.getElementById("annCounter").textContent = String(body.value.length);
  document.getElementById("annCancelBtn").hidden = !a;
  saveBtn.textContent = a ? "保存修改" : "发布公告";

  setAnnLevel(a ? (a.level || "normal") : "normal");

  state.announceOpen = true;
  writeAnnOpen(true);
  renderAnnounce();
  scrollToAnnounce();
  setTimeout(function () { title.focus(); }, 160);
}

async function onAnnSave(e) {
  if (e) e.preventDefault();
  if (annSaving) return;

  const tk = state.adminToken;
  if (!tk) { toast("请先从页脚进入管理模式"); return; }

  const body = document.getElementById("annBody").value.trim();
  if (!body) {
    toast("正文还空着，写一句吧");
    document.getElementById("annBody").focus();
    return;
  }

  const btn = document.getElementById("annSaveBtn");
  const old = btn.textContent;
  annSaving = true;
  btn.disabled = true;
  btn.textContent = "保存中…";

  try {
    await annSaveApi({
      token: tk,
      // 0 表示「新建一条」；具体数字表示修改那条。
      // 不用 null 是因为 PostgREST 对 JSON null 参数的处理比较微妙，
      // 传普通数字最稳，数据库那边也是按 p_id <= 0 判新增的。
      p_id: state.announceEditingId == null ? 0 : state.announceEditingId,
      p_title: document.getElementById("annTitle").value.trim(),
      p_body: body,
      p_level: annLevel,
      p_author: document.getElementById("annAuthor").value.trim(),
      p_pinned: document.getElementById("annPinned").checked,
      p_visible: document.getElementById("annVisible").checked
    });
  } catch (err) {
    console.error(err);
    annSaving = false;
    btn.disabled = false;
    btn.textContent = old;
    toast("保存失败：" + friendly(err));
    return;
  }

  annSaving = false;
  btn.disabled = false;
  btn.textContent = old;

  const wasEdit = state.announceEditingId != null;
  state.announceFormOpen = false;
  state.announceEditingId = null;
  document.getElementById("annTitle").value = "";
  document.getElementById("annBody").value = "";
  document.getElementById("annCounter").textContent = "0";

  await refreshAnnounceAdmin();
  toast(wasEdit ? "公告已更新" : "公告已发布");
}

async function onAnnDelete(a) {
  const tk = state.adminToken;
  if (!tk) return;

  const ok = window.confirm(
    "确定删掉这条公告吗？\n\n「" + (a.title || "通知") + "」\n\n删掉就找不回来了。"
  );
  if (!ok) return;

  try {
    await annDeleteApi(tk, a.id);
    await refreshAnnounceAdmin();
    toast("已删除");
  } catch (err) {
    console.error(err);
    toast("删除失败：" + friendly(err));
  }
}

/* ----- 绑定与启动 ----- */

function bindAnnounce() {
  renderAnnLevels();

  const bar = document.getElementById("announceBar");
  bar.addEventListener("click", function (e) {
    if (e.target.closest("button")) return;
    toggleAnnounceOpen();
  });

  document.getElementById("announceToggle").addEventListener("click", function (e) {
    e.stopPropagation();
    toggleAnnounceOpen();
  });

  document.getElementById("adminBtn").addEventListener("click", onAdminBtn);
  document.getElementById("annNewBtn").addEventListener("click", function () {
    openAnnounceForm(null);
  });
  document.getElementById("annLogoutBtn").addEventListener("click", onAdminLogout);
  document.getElementById("annForgetBtn").addEventListener("click", function () {
    writeToken("");
    state.adminToken = "";
    toast("已清除这台设备记住的口令");
  });
  document.getElementById("annCancelBtn").addEventListener("click", function () {
    state.announceFormOpen = false;
    state.announceEditingId = null;
    renderAnnounce();
  });

  const body = document.getElementById("annBody");
  body.addEventListener("input", function () {
    document.getElementById("annCounter").textContent = String(body.value.length);
  });

  document.getElementById("announceForm").addEventListener("submit", onAnnSave);
  document.getElementById("adminLoginBtn").addEventListener("click", onAdminLogin);
  document.getElementById("adminTokenInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); onAdminLogin(); }
  });
}

async function bootAnnounce() {
  state.announceOpen = readAnnOpen();
  await refreshAnnouncePublic();
}

/* ---------- 加载 ---------- */

function mockWeeks() {
  const data = window.HOTSEARCH_MOCK;
  if (!data || !Array.isArray(data.days)) return [];

  // 假数据也是按天写的，同样按周归并一遍
  const map = new Map();
  data.days.forEach(function (d) {
    const wk = weekStartOf(d.date);
    if (!map.has(wk)) map.set(wk, []);
    (d.items || []).forEach(function (it, i) {
      map.get(wk).push({
        id: "mock-" + d.date + "-" + i,
        nickname: it.nickname,
        content: it.content,
        category: it.category,
        heat: it.heat,
        likes: it.likes
      });
    });
  });

  const weeks = [];
  map.forEach(function (items, monday) {
    weeks.push(makeWeek(monday, sortItems(items)));
  });
  weeks.sort(function (a, b) { return a.key < b.key ? 1 : -1; });
  return weeks;
}

/* 保证「本周」这个标签一定在，哪怕一条都还没提交 */
function ensureThisWeek(weeks) {
  const key = weekStartOf(todayStr());
  for (let i = 0; i < weeks.length; i++) {
    if (weeks[i].key === key) return weeks;
  }
  weeks.unshift(makeWeek(key, []));
  return weeks;
}

/* 读某个周上次查看时的名次，同时把这次的名次存下来供下次比较。
   页面打开期间只算一次，之后切换标签、点赞刷新都用同一份，
   否则箭头会比着比着全变成「持平」。 */
function baselineFor(weekKey, items) {
  if (state.baselineByWeek[weekKey]) return state.baselineByWeek[weekKey];

  const all = readSnap();
  const prev = all[weekKey] || {};
  const cur = {};
  items.forEach(function (it, i) { cur[String(it.id)] = i + 1; });

  // 第一次看这一周，没有历史可比，就按「名次没变化」处理，
  // 否则整页条目都会被标成「新上榜」，看着像出 bug。
  const base = Object.keys(prev).length === 0 ? Object.assign({}, cur) : prev;
  state.baselineByWeek[weekKey] = base;

  all[weekKey] = cur;
  const keys = Object.keys(all).sort();
  while (keys.length > SNAP_KEEP) { delete all[keys.shift()]; }
  writeSnap(all);

  return base;
}

async function reload() {
  state.weeks = ensureThisWeek(await loadWeeksFromBackend());
  state.active = 0;
  renderTabs();
  renderList();
}

async function boot() {
  renderHeader();

  // 文件和脚本版本对不上时，先给出能看懂的解释，再停下来，
  // 免得后面一堆看不懂的报错把页面观感全毁了。
  const missing = missingParts();
  if (missing.length) {
    setNote("error",
      "页面没能正常加载：网页和脚本的版本对不上。" +
      "按 Ctrl + F5 强制刷新一次就好（苹果电脑按 Option + Command + R）。" +
      "刷完还是这样，就把括号里这段发给网页管理员：缺少 " + missing.join("、") + "。");
    return;
  }

  loadLikes();
  renderCats();
  bindSubmit();
  bindAnnounce();

  if (HAS_BACKEND) {
    // 公告单独加载：就算这块出问题（比如还没建公告表），
    // 榜单也照常显示，不会一起挂掉。
    await bootAnnounce();

    try {
      await reload();
      state.backendOk = true;
      refreshNote();
      return;
    } catch (err) {
      console.error(err);
      state.weeks = ensureThisWeek(mockWeeks());
      const msg = String((err && err.message) || err);
      // 「null / undefined」几乎总是文件版本错配，不是真的连不上数据库，
      // 提示要分清楚，不然会白白折腾数据库半天。
      const looksLikeMismatch = /null|undefined/i.test(msg);
      setNote("error", looksLikeMismatch
        ? "页面脚本出了点问题，现在显示的是示例数据。" +
          "这多半是浏览器缓存了旧文件，按 Ctrl + F5 强制刷新一次。原始信息：" + msg
        : "连不上数据库，现在显示的是示例数据。错误信息：" + msg);
    }
  } else {
    state.weeks = ensureThisWeek(mockWeeks());
    setNote("preview",
      "当前是预览版：还没接数据库，提交的内容刷新就会消失，榜单上的也只是示例数据。");
  }

  renderTabs();
  renderList();
}

document.addEventListener("DOMContentLoaded", boot);
