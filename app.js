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
// 意见箱用「这台设备自己生成的一把随机钥匙」来认身份，第一次打开时生成，
// 之后一直用它。存在本地，不上传别处 —— 详见下面「私信意见箱」那一节。
const LS_INBOX_KEY = "hotsearch.inboxKey.v1";
// 上次「读到管理员哪条回复」的时间点，用来算有没有新回复
const LS_INBOX_SEEN = "hotsearch.inboxSeen.v1";
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
  adminToken: "",
  // 讨论板
  comments: [],          // 全部评论（一次取回来，既算条数也用来渲染）
  commentsReady: false,  // 评论接口通不通；评论表还没建时是 false
  discussId: null,       // 正在看哪一条热搜的讨论板
  discussPushed: false,  // 讨论板是我们自己打开的吗（决定关闭时退不退历史）
  // 私信意见箱
  inbox: [],             // 普通模式＝我投的；管理模式＝全部
  inboxOpen: false,
  inboxReady: true,      // 接口通不通；意见表还没建时是 false
  inboxErr: "",          // 不通时给人看的原因
  inboxPushed: false,    // 意见箱是我们自己打开的吗
  inboxSending: false,
  inboxFilter: "all",    // 管理模式下的筛选：all | todo
  inboxPlainKey: ""      // 非无痕环境下算出来的设备钥匙（缓存一下，别每次重算）
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

/* ---------- 评论（每条热搜的讨论板）----------
   和热搜表一个思路：网页端只能读、只能新增，
   改和删都被数据库拒掉。删不当评论必须走带口令的函数。 */

const CMT_TABLE = SB.commentTable || "comments";

/* 一次把评论全取回来。
   为什么不按「打开哪条才取哪条」？因为榜单上每一行都要显示评论数，
   一次拿回来只用一趟请求。班里这个量级（上限 1000 条）完全够用，
   也省掉了「关联查询在新表建好后要等接口刷新缓存」这类麻烦。 */
async function loadCommentsFromBackend() {
  return await sbFetch(
    CMT_TABLE + "?select=id,item_id,nickname,body,created_at" +
    "&order=created_at.desc&limit=1000"
  );
}

async function postCommentToBackend(itemId, nickname, body) {
  const rows = await sbFetch(CMT_TABLE, {
    method: "POST",
    headers: { "Prefer": "return=representation" },
    body: JSON.stringify({ item_id: itemId, nickname: nickname, body: body })
  });
  return rows && rows[0];
}

async function commentDeleteApi(token, id) {
  return await sbFetch("rpc/comment_delete", {
    method: "POST",
    body: JSON.stringify({ token: token, p_id: id })
  });
}

/* ---------- 私信意见箱（数据库函数）----------
   这张表对网页端是**完全封闭**的：连读的权限都没有，一个策略也没建。
   所以这里没有一个 fetch 是冲着表去的，全部走函数。
   函数里再按「设备钥匙」和「管理口令」过滤。 */

async function opinionAddApi(key, nickname, body) {
  return await sbFetch("rpc/opinion_add", {
    method: "POST",
    body: JSON.stringify({ p_key: key, p_nick: nickname, p_body: body })
  });
}

// 只取「我这把钥匙投的那几条」。钥匙不对就是空列表。
async function opinionMineApi(key) {
  return await sbFetch("rpc/opinion_mine", {
    method: "POST",
    body: JSON.stringify({ p_key: key })
  });
}

// 管理员：全部。函数里会用 ann_check 校验口令，口令不对直接报错。
async function opinionListApi(token) {
  return await sbFetch("rpc/opinion_list", {
    method: "POST",
    body: JSON.stringify({ token: token })
  });
}

async function opinionReplyApi(token, id, reply) {
  return await sbFetch("rpc/opinion_reply", {
    method: "POST",
    body: JSON.stringify({ token: token, p_id: id, p_reply: reply })
  });
}

async function opinionDeleteApi(token, id) {
  return await sbFetch("rpc/opinion_delete", {
    method: "POST",
    body: JSON.stringify({ token: token, p_id: id })
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
  "catRow", "nicknameInput", "contentInput", "submitBtn", "dataNote",
  "announceBadge", "discussLayer", "discussOp", "cmtList", "cmtForm",
  "cmtNick", "cmtInput",
  "inboxBtn", "inboxBadge", "inboxLayer", "inboxList", "inboxNote",
  "inboxForm", "inboxNick", "inboxBody"
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

const BUBBLE = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" aria-hidden="true">' +
  '<path d="M20 12.4c0 3.5-3.6 6.4-8 6.4-.9 0-1.8-.13-2.6-.36L5.2 20l1-3.1C5.4 15.7 5 14.2 5 12.4 ' +
  '5 8.9 8.6 6 13 6s7 2.9 7 6.4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';

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
    li.setAttribute("data-item-id", String(item.id));   // 讨论板靠它把这一行找回来
    if (rank <= 6) li.setAttribute("data-top", String(rank));
    if (isNew) li.classList.add("is-new-row");

    li.appendChild(el("div", "num", String(rank)));

    const body = el("div", "body");
    const titleLine = el("div", "title-line");

    // 标题本身就是这一条的链接（#t/编号），点开就是它的讨论板。
    // 用真链接的好处：能右键「在新标签页打开」，也能把这一条的
    // 地址直接发到班群里，别人点开就是这条的讨论。
    const link = el("a", "content", item.content);
    link.href = "#t/" + encodeURIComponent(String(item.id));
    link.title = "进入这条的讨论板";
    titleLine.appendChild(link);

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

    // 评论数：有人聊过就显示条数，还没有就写「讨论」提示这里能点进去
    const chip = el("span", "cmt-chip");
    chip.innerHTML = BUBBLE;
    chip.appendChild(document.createTextNode(cmtChipText(item.id)));
    sub.appendChild(chip);

    body.appendChild(sub);
    li.appendChild(body);

    // 点赞（再点一次就取消）
    const btn = el("button", "like");
    btn.type = "button";
    paintLike(btn, item, state.likeKeys.has(key));
    btn.addEventListener("click", function () {
      toggleLike(item, btn);
    });

    li.appendChild(btn);
    list.appendChild(li);
  });
}

/* ---------- 点赞 / 取消点赞 ---------- */

/* 按一下赞，再按一下取消。
   只看按钮的红色填充和数字变化就能看出当前是哪一态。
   btn 只用来「点完先禁一下」防手快连点 —— 点赞也可能从讨论板里点，
   所以按钮和行都不是必需的。 */
async function toggleLike(item, btn) {
  const key = String(item.id);
  const liked = state.likeKeys.has(key);   // 之前点过没

  if (btn) btn.disabled = true;

  if (state.backendOk) {
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
      if (btn) btn.disabled = false;
      toast(liked ? "取消失败，检查一下网络再试" : "点赞失败，检查一下网络再试");
      return;
    }
    if (btn) btn.disabled = false;
  } else {
    item.likes = Math.max(item.likes + (liked ? -1 : 1), 0);
    item.heat = liked ? Math.max(item.heat - 10, 60) : item.heat + 10;
  }

  if (liked) state.likeKeys.delete(key);
  else state.likeKeys.add(key);
  saveLikes();

  // 热度原地改，不重新整榜排序 —— 否则手上的那一行会在指头底下跳走。
  // 榜单里那一行和讨论板里的原帖可能同时存在，所以两处都刷一遍。
  refreshLikeViews(item);
}

/* 把某一条的点赞状态同步到「榜单那一行」和「讨论板里的原帖」 */
function refreshLikeViews(item) {
  const liked = state.likeKeys.has(String(item.id));

  const row = document.querySelector(
    '#rankList .rank-item[data-item-id="' + String(item.id) + '"]'
  );
  if (row) {
    const b = row.querySelector(".like");
    if (b) paintLike(b, item, liked);

    const h = row.querySelector(".heat");
    if (h) {
      h.innerHTML = FLAME;
      h.appendChild(document.createTextNode(" " + fmtHeat(item.heat)));
    }
  }

  if (state.discussId && String(state.discussId) === String(item.id)) {
    const found = findItem(item.id);
    if (found) renderDiscussOp(found);
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
// 上次「读到哪一条公告」的时间点。存的是时间戳，不是条数 ——
// 这样就算中间有人删了旧公告，也不会把没读的算成读过了。
const LS_ANN_SEEN = "hotsearch.annSeen.v1";
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

/* ----- 未读提醒 -----
   做法：这台设备记一个「上次读到什么时候」，比它新的公告就算未读。
   已读只看两条：把通知列表展开看过一次，就全算读过了。

   几个刻意的选择：
   · 存时间点而不是「已读的那几条的编号」—— 公告被编辑过之后
     updated_at 会变新，于是会自动重新变成未读，这是想要的效果。
   · 用「已隐藏」的公告不参与计算，免得管理员自己存草稿
     也在别人手机上弹出个红点。
   · 第一次打开这个网站的访客，会看到所有公告都是未读 ——
     这正是想让他注意到的：班里有几条通知还没看。 */

function annStamp(a) { return a.updated_at || a.created_at || ""; }

function annMs(a) {
  const t = Date.parse(annStamp(a));
  return isNaN(t) ? 0 : t;
}

function readAnnSeen() {
  try { return localStorage.getItem(LS_ANN_SEEN) || ""; } catch (e) { return ""; }
}

function annSeenMs() {
  const t = Date.parse(readAnnSeen());
  return isNaN(t) ? 0 : t;
}

function visibleAnnounce() {
  return (state.announce || []).filter(function (a) { return a.visible !== false; });
}

function unreadCount() {
  const seen = annSeenMs();
  return visibleAnnounce().filter(function (a) { return annMs(a) > seen; }).length;
}

/* 全标记成已读。返回是否真的变了，变了才需要重画红点。 */
function markAnnounceRead() {
  const list = visibleAnnounce();
  if (!list.length) return false;

  let bestMs = -1;
  let best = "";
  list.forEach(function (a) {
    const t = annMs(a);
    if (t > bestMs) { bestMs = t; best = annStamp(a); }
  });

  if (!best || bestMs <= annSeenMs()) return false;
  try { localStorage.setItem(LS_ANN_SEEN, best); } catch (e) { /* 无痕模式忽略 */ }
  return true;
}

/* 重画那个红点（不动公告栏其它部分） */
function paintAnnounceBadge(n) {
  const badge = document.getElementById("announceBadge");
  if (!badge) return;
  if (n > 0) {
    badge.hidden = false;
    badge.textContent = n > 99 ? "99+" : String(n);
    badge.setAttribute("title", n + " 条没看过的通知");
  } else {
    badge.hidden = true;
    badge.textContent = "";
    badge.removeAttribute("title");
  }
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
    paintAnnounceBadge(0);
    return;
  }

  const bar = document.getElementById("announceBar");
  const ul = document.getElementById("announceList");
  const adminBar = document.getElementById("announceAdminBar");
  const login = document.getElementById("adminLogin");
  const form = document.getElementById("announceForm");

  // 管理模式下列表整个摊开，不套滚动框
  sec.classList.toggle("is-admin", admin);

  // 列表是摊开的，说明这些都摆在眼前了 → 直接算已读。
  // 放在画红点之前，所以展开的那一下红点就消失了。
  if (has && state.announceOpen) markAnnounceRead();
  paintAnnounceBadge(unreadCount());

  /* 顶部那条 */
  bar.hidden = !has;
  if (has) {
    const top = list[0];
    sec.setAttribute("data-level", top.level || "normal");

    const lead = document.getElementById("announceLead");
    lead.innerHTML = "";
    lead.appendChild(el("b", "", top.title || "通知"));
    lead.appendChild(document.createTextNode(top.body || ""));

    // 只有一条的时候也留一个展开按钮：一来那条长通知在手机上是
    // 被截成一行显示的，展开才看得全；二来没有它就没法把未读清掉。
    const tg = document.getElementById("announceToggle");
    tg.hidden = !(has || admin);
    tg.setAttribute("aria-expanded", state.announceOpen ? "true" : "false");
    tg.innerHTML = (state.announceOpen ? "收起" : "共 " + list.length + " 条") + " " + CHEV;
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
  foot.appendChild(el("span", "", a.author || "管理员"));
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
  // 进了管理模式，意见箱那边看到的东西整个换了：
  // 从「我投的」变成「全班投的」。得重新取一遍，不能拿旧的凑合。
  state.inboxFilter = "all";
  await refreshInbox();
  renderInbox();
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
  // 退出后意见箱要退回「只看自己的」
  state.inboxFilter = "all";
  await refreshInbox();
  renderInbox();
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
  if (a) author.value = a.author || "管理员";

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

/* ============================================================
   讨论板（每条热搜下面的评论）
   ------------------------------------------------------------
   每一条热搜都有自己的地址：#t/那条的编号
   点标题、点整行、或者直接打开这个地址，都会开出来。
   用地址来驱动的好处是「链接能发给别人」——
   把 #t/12 发到班群里，同学点开看到的就是那一条的讨论。

   读写规则和公告不一样：评论全班都能发，所以走的是表权限
   「只能读、只能新增」；只有删不当评论才要管理口令。
   ============================================================ */

function countComments(itemId) {
  const key = String(itemId);
  let n = 0;
  state.comments.forEach(function (c) {
    if (String(c.item_id) === key) n++;
  });
  return n;
}

function cmtChipText(itemId) {
  const n = countComments(itemId);
  return n > 0 ? String(n) : "讨论";
}

/* 某条热搜下面所有评论，按时间从早到晚排（聊天那种顺序） */
function commentsFor(itemId) {
  const key = String(itemId);
  return state.comments
    .filter(function (c) { return String(c.item_id) === key; })
    .sort(function (a, b) { return Date.parse(a.created_at) - Date.parse(b.created_at); });
}

/* 按编号把热搜找出来，顺带带上它属于哪一周、排第几名 */
function findItem(itemId) {
  const key = String(itemId);
  for (let i = 0; i < state.weeks.length; i++) {
    const wk = state.weeks[i];
    for (let j = 0; j < wk.items.length; j++) {
      if (String(wk.items[j].id) === key) {
        return { item: wk.items[j], week: wk, rank: j + 1 };
      }
    }
  }
  return null;
}

/* 地址栏里的 #t/12 → "12" */
function hashItemId() {
  const m = String(location.hash || "").match(/^#t\/([A-Za-z0-9_\-.]+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

/* ----- 开关 ----- */

function openDiscuss(itemId) {
  const target = "#t/" + encodeURIComponent(String(itemId));
  if (location.hash === target) { applyHash(); return; }
  state.discussPushed = true;      // 这一格历史是我们自己加的
  location.hash = target;          // 赋值后浏览器会触发 hashchange，交给它渲染
}

function closeDiscuss() {
  // 自己打开的 → 退一格历史。这样手机上的返回键和关闭按钮是同一回事。
  if (state.discussPushed && location.hash) {
    state.discussPushed = false;
    history.back();
    return;
  }
  // 是别人分享的链接直接打开的 → 把地址里的 #t/12 抹掉，
  // 用 replaceState 而不是退历史，免得把人家上一页也顶掉。
  // 只在确实是 #t/ 的时候动手，别顺手把意见箱的 #box 也抹了。
  if (hashItemId()) history.replaceState(null, "", location.pathname + location.search);
  state.discussId = null;
  renderDiscuss();
}

/* 地址一变就按地址来。点链接、按返回键、直接从班群点进来，
   还有意见箱，走的都是这一条路。

   地址里一共只可能有三种状态，所以这里一次全处理掉：
     #t/12  → 打开 12 号热搜的讨论板
     #box   → 打开私信意见箱
     其它    → 两个都关着
   两个弹层互斥，是因为它们都盖着整屏，本来就不可能同时开着。 */
function applyHash() {
  const h = String(location.hash || "");

  if (h === "#box") {
    state.discussId = null;
    state.inboxOpen = true;
  } else {
    state.inboxOpen = false;

    const id = hashItemId();
    if (!id) {
      state.discussPushed = false;
      state.discussId = null;
    } else {
      const found = findItem(id);
      state.discussId = found ? String(found.item.id) : null;
      if (!found) toast("这条热搜找不到了，可能已经被删掉");
    }
  }

  renderDiscuss();
  renderInbox();
}

/* 打开弹层时锁住背后那页的滚动，关掉再放开。
   顺手补一段和滚动条等宽的右内边距，否则桌面端会左右抖一下。 */
function lockScroll(on) {
  if (on) {
    const sw = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    document.body.style.paddingRight = sw > 0 ? sw + "px" : "";
  } else {
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  }
}

/* 现在到底该不该锁滚动，统一由这里算。
   以前是每个弹层自己喊「锁」或「放」，两个弹层一接力就会算错 ——
   比如意见箱刚打开、紧接着讨论板那边喊了一声「放」，背后就滚起来了。 */
function syncScrollLock() {
  lockScroll(!!state.discussId || !!state.inboxOpen);
}

/* ----- 渲染 ----- */

function renderDiscuss() {
  const layer = document.getElementById("discussLayer");
  if (!layer) return;

  const wasOpen = !layer.hidden;
  const id = state.discussId;
  const found = id ? findItem(id) : null;

  if (!found) {
    state.discussId = null;
    layer.hidden = true;
    syncScrollLock();
    return;
  }

  layer.hidden = false;
  syncScrollLock();

  // 刚打开这一下：昵称沿用提交栏那份，输入框清空，滚到最上面
  if (!wasOpen) {
    prefillDiscussNick();
    const scroller = document.getElementById("discussScroll");
    if (scroller) scroller.scrollTop = 0;
  }

  document.getElementById("discussSub").textContent =
    found.week.range + " · 第 " + found.rank + " 名";

  renderDiscussOp(found);
  renderComments(found);
}

/* 昵称和侧边栏的提交栏共用一份，谁填过都记得住 */
function prefillDiscussNick() {
  const box = document.getElementById("cmtNick");
  if (box) {
    try { box.value = localStorage.getItem(LS_NICK) || ""; } catch (e) { /* ignore */ }
  }
  const input = document.getElementById("cmtInput");
  if (input) input.value = "";
  const counter = document.getElementById("cmtCounter");
  if (counter) counter.textContent = "0";
}

/* 最上面那块「榜单上原文」的引用 */
function renderDiscussOp(found) {
  const box = document.getElementById("discussOp");
  if (!box) return;

  const item = found.item;
  box.innerHTML = "";

  const top = el("div", "op-top");
  const cat = el("span", "cat", item.category);
  cat.setAttribute("data-cat", item.category);
  top.appendChild(cat);
  top.appendChild(el("span", "op-where", found.week.label + " · 第 " + found.rank + " 名"));
  box.appendChild(top);

  box.appendChild(el("p", "op-content", item.content));

  const meta = el("div", "op-meta");

  const heat = el("span", "heat");
  heat.innerHTML = FLAME;
  heat.appendChild(document.createTextNode(" " + fmtHeat(item.heat)));
  meta.appendChild(heat);

  meta.appendChild(el("span", "", "来自 " + item.nickname));

  // 在讨论板里也能直接点赞，不用退出去
  const btn = el("button", "like");
  btn.type = "button";
  paintLike(btn, item, state.likeKeys.has(String(item.id)));
  btn.addEventListener("click", function () { toggleLike(item, btn); });
  meta.appendChild(btn);

  box.appendChild(meta);
}

function renderComments(found) {
  const list = document.getElementById("cmtList");
  const empty = document.getElementById("cmtEmpty");
  const countBox = document.getElementById("cmtCount");
  const modHint = document.getElementById("cmtModHint");

  list.innerHTML = "";
  const mine = commentsFor(found.item.id);
  countBox.textContent = mine.length ? mine.length + " 条" : "还没有";

  const mod = canModerate();
  modHint.hidden = !mod;

  // 评论表还没建（那段 SQL 没跑）—— 说清楚，别装作没评论
  if (HAS_BACKEND && !state.commentsReady) {
    empty.hidden = false;
    empty.textContent = "评论功能还没开通：数据库那边还差一段脚本（supabase-setup-comments.sql）。";
    return;
  }

  if (mine.length === 0) {
    empty.hidden = false;
    empty.textContent = HAS_BACKEND
      ? "还没有人说话，第一条就是你的。"
      : "预览版：还没接数据库，这里发的评论刷新就没了。";
    return;
  }

  empty.hidden = true;
  mine.forEach(function (c) { list.appendChild(commentItem(c, mod)); });
}

function commentItem(c, mod) {
  const li = el("li", "cmt-item");

  const head = el("div", "cmt-item-head");
  head.appendChild(el("span", "cmt-nickname", c.nickname || "匿名同学"));
  head.appendChild(el("span", "cmt-when", fmtWhen(c.created_at)));

  if (mod) {
    const del = el("button", "cmt-del", "删除");
    del.type = "button";
    del.addEventListener("click", function () { onCommentDelete(c); });
    head.appendChild(del);
  }
  li.appendChild(head);

  li.appendChild(el("p", "cmt-body", c.body || ""));
  return li;
}

/* 有管理口令（或者已经进了管理模式）才把删除按钮摆出来。
   真正能不能删还是数据库说了算 —— 这里只是别把按钮摆给全班看。 */
function canModerate() {
  return !!(state.announceAdmin || state.adminToken || readToken());
}

/* ----- 发评论 / 删评论 ----- */

let cmtSending = false;

async function onCommentSubmit(e) {
  if (e) e.preventDefault();
  if (cmtSending) return;

  const input = document.getElementById("cmtInput");
  const nickInput = document.getElementById("cmtNick");
  const btn = document.getElementById("cmtSend");

  const found = state.discussId ? findItem(state.discussId) : null;
  if (!found) return;

  const body = input.value.trim();
  const nick = nickInput.value.trim() || "匿名同学";

  if (!body) { toast("还没写内容"); input.focus(); return; }
  if (body.length > 200) { toast("评论最多 200 字"); input.focus(); return; }
  if (nick.length > 8) { toast("昵称最多 8 个字"); nickInput.focus(); return; }

  if (HAS_BACKEND && !state.commentsReady) {
    toast("评论功能还没开通，数据库那边还差一段脚本");
    return;
  }

  // 昵称和提交栏共用一份，两边谁填过都记得住
  try { localStorage.setItem(LS_NICK, nick); } catch (err) { /* ignore */ }
  const sideNick = document.getElementById("nicknameInput");
  if (sideNick) sideNick.value = nick;

  cmtSending = true;
  btn.disabled = true;
  btn.textContent = "发送中…";

  let row = null;
  if (state.backendOk) {
    try {
      row = await postCommentToBackend(found.item.id, nick, body);
    } catch (err) {
      console.error(err);
      cmtSending = false;
      btn.disabled = false;
      btn.textContent = "发送";
      toast("评论没发出去：" + friendly(err));
      return;
    }
  } else {
    // 没接数据库时的本地演示，刷新就没了
    row = {
      id: "local-c-" + Date.now(),
      item_id: found.item.id,
      nickname: nick,
      body: body,
      created_at: new Date().toISOString()
    };
  }

  if (row) state.comments.push(row);

  cmtSending = false;
  btn.disabled = false;
  btn.textContent = "发送";
  input.value = "";
  document.getElementById("cmtCounter").textContent = "0";

  renderComments(found);
  paintCmtChips();                       // 榜单上那一行的评论数也在变

  const scroller = document.getElementById("discussScroll");
  if (scroller) scroller.scrollTop = scroller.scrollHeight;

  toast(state.backendOk ? "发出去了" : "发出去了（预览版，刷新就没了）");
}

async function onCommentDelete(c) {
  const tk = state.adminToken || readToken();
  if (!tk) { toast("删评论要管理口令：先从页脚进「公告管理」"); return; }

  const ok = window.confirm(
    "确定删掉这条评论吗？\n\n「" + (c.nickname || "匿名") + "：" +
    String(c.body || "").slice(0, 40) + "」\n\n删掉就找不回来了。"
  );
  if (!ok) return;

  try {
    await commentDeleteApi(tk, c.id);
  } catch (err) {
    console.error(err);
    toast("删除失败：" + friendly(err));
    return;
  }

  state.comments = state.comments.filter(function (x) {
    return String(x.id) !== String(c.id);
  });

  const found = state.discussId ? findItem(state.discussId) : null;
  if (found) renderComments(found);
  paintCmtChips();
  toast("已删除");
}

/* 把榜单上每行的评论数重画一遍（发完、删完之后） */
function paintCmtChips() {
  const rows = document.querySelectorAll("#rankList .rank-item[data-item-id]");
  Array.prototype.forEach.call(rows, function (li) {
    const chip = li.querySelector(".cmt-chip");
    if (!chip) return;
    chip.innerHTML = BUBBLE;
    chip.appendChild(document.createTextNode(cmtChipText(li.getAttribute("data-item-id"))));
  });
}

/* ----- 加载评论 ----- */

async function refreshComments() {
  if (!HAS_BACKEND) { state.commentsReady = false; return; }

  try {
    const rows = await loadCommentsFromBackend();
    state.comments = Array.isArray(rows) ? rows : [];
    state.commentsReady = true;
  } catch (err) {
    // 最常见就两种情况：评论表还没建（SQL 没跑）、或者网络不通。
    // 都只是「评论这块用不了」，不该把榜单也带崩。
    console.warn("评论加载失败", err);
    state.commentsReady = false;
  }
}

/* ----- 绑定 ----- */

function bindDiscuss() {
  document.getElementById("discussMask").addEventListener("click", closeDiscuss);
  document.getElementById("discussClose").addEventListener("click", closeDiscuss);

  // 整行都能点开 —— 手机上手指大，别逼人正好点在标题那几个字上。
  // 点赞按钮和标题链接自己会处理，这里跳过它们。
  document.getElementById("rankList").addEventListener("click", function (e) {
    if (e.target.closest("button, a")) return;
    const li = e.target.closest(".rank-item[data-item-id]");
    if (li) openDiscuss(li.getAttribute("data-item-id"));
  });

  const input = document.getElementById("cmtInput");
  input.addEventListener("input", function () {
    document.getElementById("cmtCounter").textContent = String(input.value.length);
  });

  document.getElementById("cmtForm").addEventListener("submit", onCommentSubmit);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && state.discussId) closeDiscuss();
  });

  window.addEventListener("hashchange", applyHash);

  // 切回这个标签页时顺手拉一次最新数据。
  // 这样那个未读红点才是真的「有新通知」，而不是「刷新了页面才知道」。
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible" || !HAS_BACKEND) return;
    if (!state.announceAdmin) refreshAnnouncePublic();
    refreshComments().then(function () {
      paintCmtChips();
      if (state.discussId) renderDiscuss();
    });
    // 意见箱也顺手刷一下：管理员刚回了话的话，红点该当场就亮起来
    refreshInbox().then(function () {
      if (state.inboxOpen) renderInbox();
    });
  });
}

/* ============================================================
   私信意见箱（右上角那个信封）
   ------------------------------------------------------------
   它和这个网页上别的东西都不一样：内容只给「本人 + 管理员」看。

   静态网页没有登录，那怎么认「这条是你投的」？
   → 每台设备第一次打开时，自己随机生成一串 32 位十六进制（128 位随机数），
     存在这台设备的浏览器里，叫「设备钥匙」。投意见时把它一起交上去，
     读的时候只按它取自己的那几条。128 位猜不出来，所以别人翻不到你的意见箱。

   数据库那边对这张表是**完全封闭**的（连读的权限都没有，一个策略也没建），
   所有读写都必须走函数，函数里再按钥匙过滤。
   所以这个功能的安全性不靠前端 —— 前端就算被人整个改掉，
   也读不出别人的东西，因为接口压根不给他这个能力。

   ⚠️ 代价（页面上也写了，不能瞒着同学）：
     钥匙只存在这台设备上。换手机、换浏览器、清了浏览器数据，
     之前投的意见就找不回来了 —— 我们没有任何办法替人认领。
   ============================================================ */

/* ----- 设备钥匙 ----- */

function randomKey() {
  const buf = new Uint8Array(16);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(buf);
  } else {
    // 极老的浏览器兜底。安全性差一些，但总比没有强。
    for (let i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  let s = "";
  for (let i = 0; i < 16; i++) s += buf[i].toString(16).padStart(2, "0");
  return s;
}

function inboxKey() {
  if (state.inboxPlainKey) return state.inboxPlainKey;

  let k = "";
  try {
    k = localStorage.getItem(LS_INBOX_KEY) || "";
    if (!/^[0-9a-f]{32}$/.test(k)) {
      k = randomKey();
      localStorage.setItem(LS_INBOX_KEY, k);
    }
  } catch (e) {
    // 无痕模式存不住东西：临时给一把，本次会话内有效，刷新页面就换新的。
    // 这种模式下意见箱只能用一次，页面上有提示。
    k = "tmp" + randomKey();
  }

  state.inboxPlainKey = k;
  return k;
}

/* ----- 有没有新回复 ----- */

function inboxSeenMs() {
  let raw = "";
  try { raw = localStorage.getItem(LS_INBOX_SEEN) || ""; } catch (e) { /* ignore */ }
  const t = Date.parse(raw);
  return isNaN(t) ? 0 : t;
}

/* 把「我收到的回复」全算成看过。
   水位取的是「我收到的回复里最新的那个时间」，不是「现在」——
   万一这台设备的时钟比服务器慢，取「现在」会让刚看过的回复一直挂着未读。 */
function markInboxRead() {
  let best = 0;
  let stamp = "";
  (state.inbox || []).forEach(function (o) {
    if (!o.replied_at) return;
    const t = Date.parse(o.replied_at);
    if (!isNaN(t) && t > best) { best = t; stamp = o.replied_at; }
  });
  if (!stamp || best <= inboxSeenMs()) return false;
  try { localStorage.setItem(LS_INBOX_SEEN, stamp); } catch (e) { /* 无痕模式忽略 */ }
  return true;
}

/* 红点上的数字：
   普通模式 = 管理员回过、我还没看过的回复有几条；
   管理模式 = 还没回复的意见有几条（那才是管理员要干的活）。 */
function inboxBadgeCount() {
  const list = state.inbox || [];

  if (state.announceAdmin) {
    return list.filter(function (o) { return !o.reply; }).length;
  }

  const seen = inboxSeenMs();
  return list.filter(function (o) {
    if (!o.replied_at) return false;
    const t = Date.parse(o.replied_at);
    return !isNaN(t) && t > seen;
  }).length;
}

function paintInboxBadge(n) {
  const badge = document.getElementById("inboxBadge");
  if (!badge) return;

  if (n > 0) {
    badge.hidden = false;
    badge.textContent = n > 99 ? "99+" : String(n);
    badge.setAttribute("title",
      state.announceAdmin ? n + " 条意见还没回复" : n + " 条新回复");
  } else {
    badge.hidden = true;
    badge.textContent = "";
    badge.removeAttribute("title");
  }
}

/* ----- 数据库读写 ----- */

async function refreshInbox() {
  if (!HAS_BACKEND) {
    // 预览版：没接数据库，这一块整个不开放
    state.inbox = [];
    state.inboxReady = false;
    state.inboxErr = "";
    paintInboxBadge(0);
    return;
  }

  const admin = !!state.announceAdmin;

  try {
    const rows = admin
      ? await opinionListApi(state.adminToken || readToken())
      : await opinionMineApi(inboxKey());
    state.inbox = Array.isArray(rows) ? rows : [];
    state.inboxReady = true;
    state.inboxErr = "";
  } catch (err) {
    // 最常见的两种情况：意见表还没建（那段 SQL 没跑）、或者网络不通。
    // 都只是「意见箱这块用不了」，不该把榜单也带崩，所以在这里咽掉。
    console.warn("意见箱加载失败", err);
    state.inbox = [];
    state.inboxReady = false;
    state.inboxErr = friendly(err);
  }

  paintInboxBadge(state.inboxReady ? inboxBadgeCount() : 0);
}

/* ----- 开关 ----- */

function openInbox() {
  if (location.hash === "#box") { applyHash(); return; }
  state.inboxPushed = true;
  location.hash = "#box";
}

function closeInbox() {
  // 自己按开的 → 退一格历史，这样手机返回键和关闭按钮是同一回事
  if (state.inboxPushed && location.hash === "#box") {
    state.inboxPushed = false;
    history.back();
    return;
  }
  // 别人分享的 #box 直接进来的（虽然分享这个没意义）→ 抹掉地址，别退历史
  if (location.hash === "#box") {
    history.replaceState(null, "", location.pathname + location.search);
  }
  state.inboxOpen = false;
  renderInbox();
}

/* ----- 渲染 ----- */

function renderInboxNote(admin) {
  const box = document.getElementById("inboxNote");
  if (!box) return;

  if (!HAS_BACKEND) {
    box.textContent = "预览版：还没接数据库，意见箱暂时用不了。";
    return;
  }

  if (!state.inboxReady) {
    box.textContent =
      "意见箱暂时用不了。多半是数据库那边还差一段脚本" +
      "（supabase-setup-opinions.sql）；如果之前一直好好的，那就是网络不通。" +
      "原始信息：" + (state.inboxErr || "未知");
    return;
  }

  box.textContent = admin
    ? "这里能看到全班投的意见。回复之后，只有投这条意见的那台设备上能看见你的回复。"
    : "这里只有你和管理员看得到 —— 别人打开这个网页，看到的是他自己的意见箱。" +
      "意见是记在这台设备上的：换了手机或者清了浏览器数据，之前投的就找不回来了，所以重要的事别只写在这里。";
}

function renderInbox() {
  const layer = document.getElementById("inboxLayer");
  if (!layer) return;

  const admin = !!state.announceAdmin;

  // 入口按钮的颜色要跟着登录状态走，而且**关着的时候也要对** ——
  // 不然进了管理模式、菜单还关着时，入口看着还跟普通同学一样。
  const btn = document.getElementById("inboxBtn");
  if (btn) btn.classList.toggle("is-admin", admin);

  if (!state.inboxOpen) {
    layer.hidden = true;
    syncScrollLock();
    return;
  }

  const wasOpen = !layer.hidden;

  layer.hidden = false;
  layer.classList.toggle("is-admin", admin);
  syncScrollLock();

  // 打开这一下就算「看过回复了」。放在画红点之前，所以红点当场就没了。
  if (!admin) markInboxRead();
  paintInboxBadge(inboxBadgeCount());

  const list = state.inbox || [];

  document.getElementById("inboxTitle").textContent =
    admin ? "私信意见箱 · 管理" : "私信意见箱";

  const sub = document.getElementById("inboxSub");
  if (admin) {
    const todo = list.filter(function (o) { return !o.reply; }).length;
    sub.textContent = list.length
      ? "全班共 " + list.length + " 条，还有 " + todo + " 条没回"
      : "还没有人投意见";
  } else {
    sub.textContent = list.length
      ? "你投过 " + list.length + " 条"
      : "还没投过，第一条就是你的";
  }

  renderInboxNote(admin);

  /* 筛选只给管理模式用 */
  const filter = document.getElementById("inboxFilter");
  Array.prototype.forEach.call(
    filter.querySelectorAll(".inbox-filter-btn"),
    function (b) {
      b.classList.toggle("is-on", b.getAttribute("data-filter") === state.inboxFilter);
    }
  );

  const ul = document.getElementById("inboxList");
  const empty = document.getElementById("inboxEmpty");
  const form = document.getElementById("inboxForm");

  ul.innerHTML = "";

  if (!state.inboxReady) {
    // 接口不通就别摆出「可以投」的样子，不然人写完点发送才失败，很气人
    filter.hidden = true;
    ul.hidden = true;
    form.hidden = true;
    empty.hidden = false;
    empty.textContent = HAS_BACKEND
      ? "这块还没开通，等管理员把数据库那一步做完就能用了。"
      : "预览版：还没接数据库。";
    return;
  }

  filter.hidden = !admin;
  ul.hidden = false;
  form.hidden = admin;   // 管理模式是用来回话的，不用写自己的意见

  const drafts = admin ? inboxDraft() : {};

  const shown = (admin && state.inboxFilter === "todo")
    ? list.filter(function (o) { return !o.reply; })
    : list;

  // 普通模式按时间正序（最新的回复挨着下面的输入框，像聊天）；
  // 管理模式按时间倒序（最新的先处理，顺手）。
  const ordered = shown.slice().sort(function (a, b) {
    const da = Date.parse(a.created_at) || 0;
    const db = Date.parse(b.created_at) || 0;
    return admin ? db - da : da - db;
  });

  if (ordered.length === 0) {
    empty.hidden = false;
    if (admin) {
      empty.textContent = state.inboxFilter === "todo"
        ? "全都回完了，没欠着的。"
        : "还没有人投意见。";
    } else {
      empty.textContent = "还没投过意见。上面写一条，只有你和管理员看得到。";
    }
  } else {
    empty.hidden = true;
    ordered.forEach(function (o) { ul.appendChild(opinionItem(o, admin, drafts)); });
  }

  // 刚打开、而且是普通模式：昵称沿用提交栏那份，正文清空，滚回最上面
  if (!admin && !wasOpen) {
    prefillInboxNick();
    const scroller = document.getElementById("inboxScroll");
    if (scroller) scroller.scrollTop = 0;
  }
}

/* 把管理员已经打在各个回复框里的字捡起来。
   列表是整块重画的（回复完一条就要重画），不先捡起来，
   打了一半的那几条会被一起清掉 —— 这体验很差。 */
function inboxDraft() {
  const map = {};
  Array.prototype.forEach.call(
    document.querySelectorAll("#inboxList .op-reply-input"),
    function (t) {
      const id = t.getAttribute("data-reply-for");
      if (id) map[id] = t.value;
    }
  );
  return map;
}

function prefillInboxNick() {
  const box = document.getElementById("inboxNick");
  if (box) {
    try { box.value = localStorage.getItem(LS_NICK) || ""; } catch (e) { /* ignore */ }
  }
  const body = document.getElementById("inboxBody");
  if (body) body.value = "";
  const counter = document.getElementById("inboxCounter");
  if (counter) counter.textContent = "0";
}

function opinionItem(o, admin, drafts) {
  const li = el("li", "op-item");
  li.setAttribute("data-op-id", String(o.id));
  if (!o.reply) li.classList.add("is-todo");

  const head = el("div", "op-item-head");
  head.appendChild(el("span", "op-when", fmtWhen(o.created_at)));
  head.appendChild(el("span", "op-flag", o.reply ? "已回复" : "还没有回复"));

  if (admin) {
    const del = el("button", "op-del", "删除");
    del.type = "button";
    del.addEventListener("click", function () { onOpinionDelete(o); });
    head.appendChild(del);
  }
  li.appendChild(head);

  const who = el("div", "op-item-who");
  who.appendChild(el("span", "op-nick", o.nickname || "匿名同学"));
  li.appendChild(who);

  li.appendChild(el("p", "op-body", o.body || ""));

  if (o.reply) {
    const rep = el("div", "op-reply");
    rep.appendChild(el("span", "op-reply-tag", "管理员回复"));
    rep.appendChild(el("p", "op-reply-body", o.reply));
    if (o.replied_at) {
      rep.appendChild(el("span", "op-reply-when", fmtWhen(o.replied_at)));
    }
    li.appendChild(rep);
  }

  if (admin) {
    const form = el("div", "op-reply-form");

    const ta = document.createElement("textarea");
    ta.className = "input textarea op-reply-input";
    ta.rows = 2;
    ta.maxLength = 500;
    ta.setAttribute("data-reply-for", String(o.id));
    ta.placeholder = o.reply
      ? "改一改这条回复（清空 = 撤回回复）"
      : "写一句回复，投这条意见的同学会看到";
    const key = String(o.id);
    ta.value = Object.prototype.hasOwnProperty.call(drafts, key)
      ? drafts[key]
      : (o.reply || "");
    form.appendChild(ta);

    const btn = el("button", "btn-submit op-reply-btn", o.reply ? "更新回复" : "回复");
    btn.type = "button";
    btn.addEventListener("click", function () { onOpinionReply(o, ta, btn); });
    form.appendChild(btn);

    li.appendChild(form);
  }

  return li;
}

/* ----- 投一条意见 ----- */

async function onOpinionSubmit(e) {
  if (e) e.preventDefault();
  if (state.inboxSending) return;

  if (!state.inboxReady) { toast("意见箱还没开通"); return; }

  const bodyBox = document.getElementById("inboxBody");
  const nick = (document.getElementById("inboxNick").value || "").trim();
  const body = (bodyBox.value || "").trim();

  if (body.length < 2) { toast("写点什么再投吧"); bodyBox.focus(); return; }
  if (body.length > 500) { toast("最多 500 个字"); return; }

  const btn = document.getElementById("inboxSend");
  const old = btn.textContent;
  state.inboxSending = true;
  btn.disabled = true;
  btn.textContent = "发送中…";

  try {
    await opinionAddApi(inboxKey(), nick, body);
    try { localStorage.setItem(LS_NICK, nick); } catch (e2) { /* 无痕模式忽略 */ }

    bodyBox.value = "";
    document.getElementById("inboxCounter").textContent = "0";

    await refreshInbox();
    renderInbox();
    toast("投出去了，只有你和管理员看得到");
  } catch (err) {
    console.error(err);
    toast("没发出去：" + friendly(err));
  } finally {
    state.inboxSending = false;
    btn.disabled = false;
    btn.textContent = old;
  }
}

/* ----- 回复 / 删除（管理员）----- */

async function onOpinionReply(o, ta, btn) {
  const tk = state.adminToken || readToken();
  if (!tk) { toast("回复要管理口令：先从页脚进「公告管理」"); return; }

  const text = (ta.value || "").trim();
  if (text.length > 500) { toast("回复最多 500 个字"); return; }

  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = "保存中…";

  try {
    await opinionReplyApi(tk, o.id, text);
    await refreshInbox();
    renderInbox();
    toast(text ? "回复好了" : "回复已撤回");
  } catch (err) {
    console.error(err);
    toast("没保存上：" + friendly(err));
    btn.disabled = false;
    btn.textContent = old;
  }
}

async function onOpinionDelete(o) {
  const tk = state.adminToken || readToken();
  if (!tk) { toast("删意见要管理口令：先从页脚进「公告管理」"); return; }

  const ok = window.confirm(
    "确定删掉这条意见吗？\n\n「" + (o.nickname || "匿名") + "：" +
    String(o.body || "").slice(0, 40) + "」\n\n" +
    "删掉就找不回来了，投意见的同学那边也会一起消失。"
  );
  if (!ok) return;

  try {
    await opinionDeleteApi(tk, o.id);
  } catch (err) {
    console.error(err);
    toast("删除失败：" + friendly(err));
    return;
  }

  await refreshInbox();
  renderInbox();
  toast("已删除");
}

/* ----- 绑定 ----- */

function bindInbox() {
  document.getElementById("inboxBtn").addEventListener("click", openInbox);
  document.getElementById("inboxMask").addEventListener("click", closeInbox);
  document.getElementById("inboxClose").addEventListener("click", closeInbox);

  const body = document.getElementById("inboxBody");
  body.addEventListener("input", function () {
    document.getElementById("inboxCounter").textContent = String(body.value.length);
  });

  document.getElementById("inboxForm").addEventListener("submit", onOpinionSubmit);

  document.getElementById("inboxFilter").addEventListener("click", function (e) {
    const b = e.target.closest("button[data-filter]");
    if (!b) return;
    state.inboxFilter = b.getAttribute("data-filter") || "all";
    renderInbox();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && state.inboxOpen) closeInbox();
  });
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
  bindDiscuss();
  bindInbox();

  if (HAS_BACKEND) {
    // 公告、评论、意见箱都是各自单独加载的：哪一块出问题
    // （比如对应的表还没建），都只是那一块用不了，榜单照常显示，不会一起挂掉。
    await bootAnnounce();
    await refreshComments();
    await refreshInbox();

    try {
      await reload();
      state.backendOk = true;
      refreshNote();
      applyHash();
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
    await refreshInbox();
    setNote("preview",
      "当前是预览版：还没接数据库，提交的内容刷新就会消失，榜单上的也只是示例数据。");
  }

  renderTabs();
  renderList();
  applyHash();
}

document.addEventListener("DOMContentLoaded", boot);
