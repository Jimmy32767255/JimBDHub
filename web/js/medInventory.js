// 药品库存「板/瓶」粒度工具模块。
//
// 设计目标：med.remainingPills（总剩余，进度条/图表继续使用）与 med.boards
// （每板/瓶明细）始终保持  sum(boards[].remaining) === remainingPills 的一致性。
// 本模块只做纯数据变换，不依赖 i18n / DOM / store，供 dbUpgrade、store、
// meds、records 等共享，避免循环依赖。

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(0, 2);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// 每板/瓶容量：来自 med.pillsPerBoard；<=0 表示未指定容量（视为散装，可无限）。
export function boardCapacityOf(med) {
  return Math.max(0, num(med && med.pillsPerBoard));
}

// 板/瓶数量：盒数 × 每盒板/瓶数。
export function boardCountOf(med) {
  const box = Math.max(0, Math.floor(num(med && med.boxCount)));
  const per = Math.max(0, Math.floor(num(med && med.boardPerBox)));
  return box * per;
}

export function sumBoards(boards) {
  if (!Array.isArray(boards)) return 0;
  return boards.reduce((s, b) => s + Math.max(0, num(b && b.remaining)), 0);
}

// 把总量分配到 count 个容量为 cap 的容器（顺序填充；超出容量时溢出放在末位）。
// 返回新 boards 数组。count<=0 或 cap<=0 时退化为单个「散装容器」。
export function distributeRemaining(total, count, cap) {
  const t = Math.max(0, num(total));
  const capacity = Math.max(0, num(cap));
  const n = Math.max(0, Math.floor(num(count)));
  const out = [];
  if (n <= 0 || capacity <= 0) {
    out.push({ id: genId(), remaining: t, capacity: capacity > 0 ? capacity : null });
    return out;
  }
  let left = t;
  for (let i = 0; i < n; i++) {
    const remaining = Math.max(0, Math.min(capacity, left));
    left -= remaining;
    out.push({ id: genId(), remaining, capacity });
  }
  if (left > 1e-9) out[n - 1].remaining = Math.max(0, num(out[n - 1].remaining)) + left;
  return out;
}

// 确保 med.boards 存在且结构合法（旧数据首次进入新版本时补齐）。
// 会就地修改 med 并返回 med。
export function ensureMedBoards(med) {
  if (!med || typeof med !== 'object') return med;
  if (Array.isArray(med.boards) && med.boards.length > 0) {
    // 修正缺失 id / 空项
    let dirty = false;
    const cleaned = [];
    med.boards.forEach(b => {
      if (!b || typeof b !== 'object') { dirty = true; return; }
      if (!b.id) { b.id = genId(); dirty = true; }
      b.remaining = Math.max(0, num(b.remaining));
      cleaned.push(b);
    });
    if (dirty) med.boards = cleaned;
    // 保持总剩余 = 明细和（优先明细，因为明细是更精确的事实来源）
    const s = sumBoards(med.boards);
    if (Math.abs(s - num(med.remainingPills)) > 1e-9) med.remainingPills = s;
    return med;
  }
  const total = Math.max(0, num(med.remainingPills));
  const count = boardCountOf(med);
  const cap = boardCapacityOf(med);
  med.boards = distributeRemaining(total, count, cap);
  med.remainingPills = sumBoards(med.boards);
  return med;
}

// 规格（盒/板/粒）变化后，按新规格重建 boards。
// preserveRemaining：希望保留的「总剩余」；缺省用现有明细和 / med.remainingPills。
// 返回新数组，不修改 med（调用方负责写回）。
export function rebuildBoardsForSpec(med, existingBoards, preserveRemaining) {
  const count = boardCountOf(med);
  const cap = boardCapacityOf(med);
  let total = preserveRemaining !== undefined ? num(preserveRemaining)
    : (Array.isArray(existingBoards) && existingBoards.length ? sumBoards(existingBoards) : num(med && med.remainingPills));
  if (count <= 0 || cap <= 0) {
    const oldId = Array.isArray(existingBoards) && existingBoards[0] && existingBoards[0].id;
    return [{ id: oldId || genId(), remaining: total, capacity: cap > 0 ? cap : null }];
  }
  const out = [];
  let left = Math.max(0, total);
  for (let i = 0; i < count; i++) {
    const old = Array.isArray(existingBoards) ? existingBoards[i] : null;
    const remaining = Math.max(0, Math.min(cap, left));
    left -= remaining;
    out.push({
      id: (old && old.id) || genId(),
      remaining,
      capacity: cap
    });
  }
  if (left > 1e-9) out[count - 1].remaining = Math.max(0, num(out[count - 1].remaining)) + left;
  return out;
}

// 对 boards 应用库存变动（delta 正=增加，负=减少）。
// preferredBoardId：扣减/回补优先操作的板 id（可为空，自动选「在服板」/「有空间的板」）。
// 就地修改 boards，返回变动后总剩余。
export function applyBoardDelta(boards, delta, preferredBoardId) {
  if (!Array.isArray(boards) || boards.length === 0) return 0;
  let left = num(delta);
  if (left > 1e-9) {
    // 增加：优先回补到有空间(remaining<capacity 或 capacity 为空)的板；全满则溢出到末板
    const capIdx = boards.map((b, i) => ({ b, i }));
    let order = capIdx.slice().sort((a, c) => {
      const aRoom = (a.b.capacity == null) ? Infinity : (num(a.b.capacity) - num(a.b.remaining));
      const cRoom = (c.b.capacity == null) ? Infinity : (num(c.b.capacity) - num(c.b.remaining));
      return (aRoom <= 0 ? 0 : 1) - (cRoom <= 0 ? 0 : 1) || aRoom - cRoom;
    });
    if (preferredBoardId) {
      const pi = boards.findIndex(b => b.id === preferredBoardId);
      if (pi >=0) {
        const cur = order.findIndex(o => o.i === pi);
        if (cur >= 0) {
          const [moved] = order.splice(cur, 1);
          order.unshift(moved);
        }
      }
    }
    for (const o of order) {
      if (left <= 1e-9) break;
      const b = o.b;
      const cur = num(b.remaining);
      if (b.capacity == null) {
        b.remaining = cur + left;
        left = 0;
      } else {
        const room = Math.max(0, num(b.capacity) - cur);
        if (room > 1e-9) {
          const add = Math.min(room, left);
          b.remaining = cur + add;
          left -= add;
        }
      }
    }
    if (left > 1e-9 && boards.length) {
      // 所有板已满仍有剩余：视作溢出（用户可再调整规格/板明细）
      boards[boards.length - 1].remaining = num(boards[boards.length - 1].remaining) + left;
    }
  } else if (left < -1e-9) {
    let need = -left;
    const withStock = boards.map((b, i) => ({ b, i, r: num(b.remaining) }))
      .filter(o => o.r > 1e-9)
      .sort((a, c) => a.r - c.r); // 优先扣剩余最少的「在服板」
    if (preferredBoardId) {
      const pi = boards.findIndex(b => b.id === preferredBoardId);
      if (pi >= 0) {
        const pi2 = withStock.findIndex(o => o.i === pi);
        if (pi2 >= 0) {
          const [moved] = withStock.splice(pi2, 1);
          withStock.unshift(moved);
        } else {
          withStock.unshift({ b: boards[pi], i: pi, r: num(boards[pi].remaining) });
        }
      }
    }
    for (const o of withStock) {
      if (need <= 1e-9) break;
      const take = Math.min(need, Math.max(0, o.r));
      o.b.remaining = Math.max(0, num(o.b.remaining) - take);
      need -= take;
    }
    // need 未扣完（库存不足）时静默忽略（与旧逻辑一致：不越界扣到负数）
  }
  return sumBoards(boards);
}

// 默认「在服板」：剩余最少的非空板（若都则取第一板）。
export function defaultOpenBoardId(med) {
  const boards = (med && Array.isArray(med.boards)) ? med.boards : [];
  if (!boards.length) return null;
  let best = null;
  boards.forEach(b => {
    const r = num(b.remaining);
    if (r > 1e-9 && (!best || r < num(best.remaining))) best = b;
  });
  return best ? best.id : (boards[0] && boards[0].id) || null;
}

// 将 boards 按「盒」分组（盒内板/瓶）。每组：{ boxIndex, label, boards: [{...}] }
// 当盒数<=1 或每盒板数<=1 时不分组（boxIndex = null）。
// 返回的每板对象附加 index（在 boards 中的全局序号）。
export function groupBoardsByBox(med, flat = false) {
  const boards = (med && Array.isArray(med.boards)) ? med.boards : [];
  const box = Math.max(0, Math.floor(num(med && med.boxCount)));
  const per = Math.max(0, Math.floor(num(med && med.boardPerBox)));
  const withIdx = boards.map((b, i) => ({ ...b, index: i }));
  if (flat || boards.length === 0 || box <= 1 || per <= 1) {
    return [{ boxIndex: null, label: null, boards: withIdx }];
  }
  const groups = [];
  for (let bi = 0; bi < Math.min(box, Math.ceil(boards.length / Math.max(1, per))); bi++) {
    groups.push({
      boxIndex: bi,
      label: null,
      boards: withIdx.slice(bi * per, bi * per + per)
    });
  }
  // 处理 boards 长度不足 per 的尾组
  const used = groups.reduce((n, g) => n + g.boards.length, 0);
  if (used < withIdx.length) {
    groups.push({ boxIndex: groups.length, label: null, boards: withIdx.slice(used) });
  }
  return groups;
}
