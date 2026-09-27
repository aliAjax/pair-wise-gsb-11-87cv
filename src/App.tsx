import { FormEvent, useMemo, useRef, useState } from "react";

/* ================= 类型 ================= */

type Noise = "无异常" | "异响未确认" | "异响已确认";
type GenStatus = "正常值守" | "待处理" | "送修中";
type RunKind = "例行试机" | "复机试机";

type Gen = {
  id: string;
  name: string;
  location: string;
  fuelBatch: string; // 当前燃油批次
  fuelExpiry: string; // 燃油到期日
};

type TestRun = {
  id: string;
  genId: string;
  date: string;
  oilLevel: number; // 开机油位 %
  noLoadMin: number; // 空载时长（分钟）
  loadMin: number; // 带载时长（分钟）
  exhaustTemp: number; // 排烟温度 ℃
  noise: Noise;
  noiseNote: string; // 异响结论 / 现象
  operator: string;
  kind: RunKind;
  createdAt: string;
};

type Repair = {
  id: string;
  genId: string;
  sentAt: string;
  reason: string; // 送修原因
  handler: string; // 处理人
  returnedAt: string | null; // 复机日期
};

type OilChange = {
  id: string;
  genId: string;
  date: string;
  oldBatch: string; // 旧批次
  remainLiters: number; // 剩余量 L
  disposal: string; // 报废去向
  newBatch: string;
  newExpiry: string;
  operator: string;
};

type Store = {
  gens: Gen[];
  runs: TestRun[];
  repairs: Repair[];
  oilChanges: OilChange[];
};

/* ================= 常量与规则 ================= */

const STORAGE_KEY = "dfwlfront-10-generator-duty";
const LOAD_MIN_THRESHOLD = 15; // 带载不足 15 分钟 → 待处理
const EXPIRY_WARN_DAYS = 30; // 距到期不足 30 天 → 待处理

const page = {
  industry: "石油",
  title: "应急发电机值守台",
  subtitle:
    "登记燃油批次与试机数据：燃油距到期不足30天、带载不足15分钟或异响未确认时，机组停在待处理；送修须写明原因和处理人，复机前补一次带载试机；换油留痕旧批次、剩余量与报废去向。",
  stack: ["React", "Vite", "TypeScript", "Zustand", "Ant Design"],
  metricLabels: ["机组总数", "正常值守", "待处理", "送修中"],
};

const DISPOSAL_OPTIONS = ["交有资质单位回收", "危废暂存间暂存", "调和回用", "其他"];

const STATUS_CLASS: Record<GenStatus, string> = {
  正常值守: "status-ok",
  待处理: "status-pending",
  送修中: "status-repair",
};

/* ================= 工具函数 ================= */

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function daysUntil(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function expiryText(days: number) {
  if (days < 0) return `已过期 ${-days} 天`;
  if (days === 0) return "今日到期";
  return `剩 ${days} 天`;
}

function latestRun(runs: TestRun[], genId: string) {
  return runs
    .filter((run) => run.genId === genId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0];
}

function activeRepairOf(repairs: Repair[], genId: string) {
  return repairs.find((repair) => repair.genId === genId && !repair.returnedAt);
}

function deriveStatus(gen: Gen, runs: TestRun[], repairs: Repair[]): { status: GenStatus; reasons: string[] } {
  const active = activeRepairOf(repairs, gen.id);
  if (active) {
    return { status: "送修中", reasons: [`${active.sentAt} 送修：${active.reason}（处理人：${active.handler}）`] };
  }
  const reasons: string[] = [];
  const days = daysUntil(gen.fuelExpiry);
  if (days < EXPIRY_WARN_DAYS) {
    reasons.push(`燃油批次 ${gen.fuelBatch} ${days < 0 ? `已过期 ${-days} 天` : `距到期仅 ${days} 天`}，不足 ${EXPIRY_WARN_DAYS} 天`);
  }
  const run = latestRun(runs, gen.id);
  if (!run) {
    reasons.push("尚无试机记录，需补一次带载试机");
  } else {
    if (run.loadMin < LOAD_MIN_THRESHOLD) {
      reasons.push(`最近试机带载仅 ${run.loadMin} 分钟，不足 ${LOAD_MIN_THRESHOLD} 分钟`);
    }
    if (run.noise === "异响未确认") {
      reasons.push("上次试机异响未确认");
    }
  }
  return reasons.length ? { status: "待处理", reasons } : { status: "正常值守", reasons: [] };
}

/* ================= 种子数据与持久化 ================= */

function seedStore(): Store {
  return {
    gens: [
      { id: "g1", name: "应急发电机1号", location: "配电房", fuelBatch: "CY-2026-0608", fuelExpiry: "2027-06-30" },
      { id: "g2", name: "应急发电机2号", location: "油罐区东侧", fuelBatch: "CY-2026-0402", fuelExpiry: "2026-10-12" },
      { id: "g3", name: "应急发电机3号", location: "站房后侧", fuelBatch: "CY-2026-0715", fuelExpiry: "2027-03-31" },
      { id: "g4", name: "应急发电机4号（备用）", location: "库房", fuelBatch: "CY-2025-1120", fuelExpiry: "2026-11-30" },
    ],
    runs: [
      { id: "r1", genId: "g1", date: "2026-09-20", oilLevel: 80, noLoadMin: 5, loadMin: 20, exhaustTemp: 465, noise: "无异常", noiseNote: "运行平稳", operator: "何鑫", kind: "例行试机", createdAt: "2026-09-20T09:00:00.000Z" },
      { id: "r2", genId: "g2", date: "2026-09-18", oilLevel: 75, noLoadMin: 5, loadMin: 18, exhaustTemp: 470, noise: "无异常", noiseNote: "", operator: "何鑫", kind: "例行试机", createdAt: "2026-09-18T09:00:00.000Z" },
      { id: "r3", genId: "g3", date: "2026-09-22", oilLevel: 70, noLoadMin: 5, loadMin: 8, exhaustTemp: 512, noise: "异响未确认", noiseNote: "怠速有金属敲击声，待查", operator: "何鑫", kind: "例行试机", createdAt: "2026-09-22T09:00:00.000Z" },
      { id: "r4", genId: "g4", date: "2026-09-10", oilLevel: 65, noLoadMin: 4, loadMin: 12, exhaustTemp: 498, noise: "异响未确认", noiseNote: "启动困难，伴异响", operator: "何鑫", kind: "例行试机", createdAt: "2026-09-10T09:00:00.000Z" },
    ],
    repairs: [
      { id: "rep1", genId: "g4", sentAt: "2026-09-12", reason: "启动困难，试机异响明显，送厂检修启动马达", handler: "何鑫", returnedAt: null },
    ],
    oilChanges: [
      { id: "oc1", genId: "g2", date: "2026-04-02", oldBatch: "CY-2025-1001", remainLiters: 12, disposal: "交有资质单位回收", newBatch: "CY-2026-0402", newExpiry: "2026-10-12", operator: "何鑫" },
      { id: "oc2", genId: "g1", date: "2026-06-08", oldBatch: "CY-2025-1210", remainLiters: 8, disposal: "危废暂存间暂存", newBatch: "CY-2026-0608", newExpiry: "2027-06-30", operator: "何鑫" },
    ],
  };
}

function loadStore(): Store {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return seedStore();
  try {
    return JSON.parse(raw) as Store;
  } catch {
    return seedStore();
  }
}

function saveStore(store: Store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/* ================= 表单初值 ================= */

type RunForm = {
  genId: string;
  date: string;
  oilLevel: number;
  noLoadMin: number;
  loadMin: number;
  exhaustTemp: number;
  noise: Noise;
  noiseNote: string;
  operator: string;
};

type OilForm = {
  genId: string;
  date: string;
  remainLiters: number;
  disposal: string;
  newBatch: string;
  newExpiry: string;
  operator: string;
};

function blankRun(gens: Gen[]): RunForm {
  return {
    genId: gens[0]?.id ?? "",
    date: todayStr(),
    oilLevel: 80,
    noLoadMin: 5,
    loadMin: 15,
    exhaustTemp: 480,
    noise: "无异常",
    noiseNote: "",
    operator: "",
  };
}

function blankOil(gens: Gen[]): OilForm {
  return {
    genId: gens[0]?.id ?? "",
    date: todayStr(),
    remainLiters: 0,
    disposal: DISPOSAL_OPTIONS[0],
    newBatch: "",
    newExpiry: "",
    operator: "",
  };
}

/* ================= 页面组件 ================= */

export default function App() {
  const [store, setStore] = useState<Store>(loadStore);
  const [tab, setTab] = useState<"run" | "oil">("run");
  const [runForm, setRunForm] = useState<RunForm>(() => blankRun(store.gens));
  const [oilForm, setOilForm] = useState<OilForm>(() => blankOil(store.gens));
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [repairForm, setRepairForm] = useState({ reason: "", handler: "" });
  const [confirmingRunId, setConfirmingRunId] = useState<string | null>(null);
  const [confirmNote, setConfirmNote] = useState("");
  const [historyTab, setHistoryTab] = useState<"oil" | "repair" | "run">("oil");
  const [historyGen, setHistoryGen] = useState("all");

  const formPanelRef = useRef<HTMLDivElement>(null);
  const statusPanelRef = useRef<HTMLDivElement>(null);

  const genById = (id: string) => store.gens.find((gen) => gen.id === id);

  function update(next: Store) {
    setStore(next);
    saveStore(next);
  }

  /* ---------- 派生数据 ---------- */

  const genViews = useMemo(
    () =>
      store.gens.map((gen) => ({
        gen,
        ...deriveStatus(gen, store.runs, store.repairs),
        lastRun: latestRun(store.runs, gen.id),
        activeRepair: activeRepairOf(store.repairs, gen.id),
        fuelDays: daysUntil(gen.fuelExpiry),
      })),
    [store]
  );

  const metrics = useMemo(() => {
    const count = (status: GenStatus) => genViews.filter((view) => view.status === status).length;
    return [store.gens.length, count("正常值守"), count("待处理"), count("送修中")];
  }, [genViews, store.gens.length]);

  type Todo = { key: string; genId: string; text: string; action: "oil" | "run" | "noise" | "repair"; actionText: string };

  const todos = useMemo(() => {
    const list: Todo[] = [];
    for (const view of genViews) {
      const { gen, lastRun, activeRepair, fuelDays } = view;
      if (activeRepair) {
        list.push({
          key: `repair-${gen.id}`,
          genId: gen.id,
          text: `${gen.name} 送修未复机：${activeRepair.reason}（处理人：${activeRepair.handler}），复机前须补带载试机`,
          action: "repair",
          actionText: "登记复机试机",
        });
        continue;
      }
      if (fuelDays < EXPIRY_WARN_DAYS) {
        list.push({
          key: `oil-${gen.id}`,
          genId: gen.id,
          text: `${gen.name} 燃油${expiryText(fuelDays)}（批次 ${gen.fuelBatch}），尽快安排换油`,
          action: "oil",
          actionText: "去换油",
        });
      }
      if (!lastRun) {
        list.push({ key: `run-${gen.id}`, genId: gen.id, text: `${gen.name} 尚无试机记录`, action: "run", actionText: "去试机" });
      } else {
        if (lastRun.loadMin < LOAD_MIN_THRESHOLD) {
          list.push({
            key: `load-${gen.id}`,
            genId: gen.id,
            text: `${gen.name} 最近带载仅 ${lastRun.loadMin} 分钟，不足 ${LOAD_MIN_THRESHOLD} 分钟`,
            action: "run",
            actionText: "补带载试机",
          });
        }
        if (lastRun.noise === "异响未确认") {
          list.push({
            key: `noise-${gen.id}`,
            genId: gen.id,
            text: `${gen.name} 异响未确认：${lastRun.noiseNote || "现象待查"}`,
            action: "noise",
            actionText: "确认异响",
          });
        }
      }
    }
    return list;
  }, [genViews]);

  const chartRows = (["正常值守", "待处理", "送修中"] as GenStatus[]).map((status) => ({
    status,
    value: genViews.filter((view) => view.status === status).length,
  }));
  const maxChart = Math.max(1, ...chartRows.map((row) => row.value));

  const historyGens = [{ id: "all", name: "全部机组" }, ...store.gens];
  const matchGen = (genId: string) => historyGen === "all" || genId === historyGen;

  const oilHistory = store.oilChanges
    .filter((item) => matchGen(item.genId))
    .sort((a, b) => b.date.localeCompare(a.date));
  const repairHistory = store.repairs
    .filter((item) => matchGen(item.genId))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  const runHistory = store.runs
    .filter((item) => matchGen(item.genId))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  /* ---------- 动作 ---------- */

  function gotoRunForm(genId: string) {
    setTab("run");
    setRunForm((form) => ({ ...form, genId }));
    formPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function gotoOilForm(genId: string) {
    setTab("oil");
    setOilForm((form) => ({ ...form, genId }));
    formPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleTodo(todo: Todo) {
    if (todo.action === "oil") gotoOilForm(todo.genId);
    if (todo.action === "run" || todo.action === "repair") gotoRunForm(todo.genId);
    if (todo.action === "noise") {
      const run = latestRun(store.runs, todo.genId);
      if (run) {
        setConfirmingRunId(run.id);
        setConfirmNote(run.noiseNote);
        statusPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }

  function submitRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const gen = genById(runForm.genId);
    if (!gen) return;
    const active = activeRepairOf(store.repairs, gen.id);
    const run: TestRun = {
      id: crypto.randomUUID(),
      genId: gen.id,
      date: runForm.date,
      oilLevel: runForm.oilLevel,
      noLoadMin: runForm.noLoadMin,
      loadMin: runForm.loadMin,
      exhaustTemp: runForm.exhaustTemp,
      noise: runForm.noise,
      noiseNote: runForm.noiseNote.trim(),
      operator: runForm.operator.trim(),
      kind: active ? "复机试机" : "例行试机",
      createdAt: new Date().toISOString(),
    };
    // 在修机组登记试机即视为复机：关闭送修单，复机时间取试机日期
    const repairs = active
      ? store.repairs.map((repair) => (repair.id === active.id ? { ...repair, returnedAt: runForm.date } : repair))
      : store.repairs;
    update({ ...store, runs: [...store.runs, run], repairs });
    setRunForm({ ...blankRun(store.gens), operator: runForm.operator });
  }

  function submitOil(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const gen = genById(oilForm.genId);
    if (!gen) return;
    const change: OilChange = {
      id: crypto.randomUUID(),
      genId: gen.id,
      date: oilForm.date,
      oldBatch: gen.fuelBatch,
      remainLiters: oilForm.remainLiters,
      disposal: oilForm.disposal,
      newBatch: oilForm.newBatch.trim(),
      newExpiry: oilForm.newExpiry,
      operator: oilForm.operator.trim(),
    };
    const gens = store.gens.map((item) =>
      item.id === gen.id ? { ...item, fuelBatch: change.newBatch, fuelExpiry: change.newExpiry } : item
    );
    update({ ...store, gens, oilChanges: [...store.oilChanges, change] });
    setOilForm({ ...blankOil(store.gens), operator: oilForm.operator });
  }

  function submitRepair(genId: string) {
    if (!repairForm.reason.trim() || !repairForm.handler.trim()) return;
    const repair: Repair = {
      id: crypto.randomUUID(),
      genId,
      sentAt: todayStr(),
      reason: repairForm.reason.trim(),
      handler: repairForm.handler.trim(),
      returnedAt: null,
    };
    update({ ...store, repairs: [...store.repairs, repair] });
    setSendingId(null);
    setRepairForm({ reason: "", handler: "" });
  }

  function submitConfirmNoise(runId: string) {
    if (!confirmNote.trim()) return;
    const runs = store.runs.map((run) =>
      run.id === runId ? { ...run, noise: "异响已确认" as Noise, noiseNote: confirmNote.trim() } : run
    );
    update({ ...store, runs });
    setConfirmingRunId(null);
    setConfirmNote("");
  }

  /* ---------- 渲染 ---------- */

  const runFormGen = genById(runForm.genId);
  const runFormRepair = runFormGen ? activeRepairOf(store.repairs, runFormGen.id) : undefined;
  const oilFormGen = genById(oilForm.genId);

  return (
    <main className="app">
      <div className="shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">{page.industry}行业 · 值守台</p>
            <h1>{page.title}</h1>
            <p className="subtitle">{page.subtitle}</p>
          </div>
          <div className="stack">{page.stack.map((item) => <span className="tag" key={item}>{item}</span>)}</div>
        </header>

        <section className="metrics">
          {page.metricLabels.map((label, index) => (
            <article className="metric" key={label}>
              <span>{label}</span>
              <strong>{metrics[index]}</strong>
            </article>
          ))}
        </section>

        <section className="workspace">
          {/* 左栏：登记 */}
          <div className="panel" ref={formPanelRef}>
            <div className="tabs">
              <button type="button" className={`tab-btn ${tab === "run" ? "active" : ""}`} onClick={() => setTab("run")}>
                试机登记
              </button>
              <button type="button" className={`tab-btn ${tab === "oil" ? "active" : ""}`} onClick={() => setTab("oil")}>
                换油登记
              </button>
            </div>

            {tab === "run" ? (
              <form className="form-grid" onSubmit={submitRun}>
                <h2>试机登记</h2>
                {runFormRepair && (
                  <p className="banner">
                    {runFormGen?.name} 正在送修（{runFormRepair.reason}），本次登记为复机试机；带载≥{LOAD_MIN_THRESHOLD}
                    分钟且异响有结论后，机组才能回到正常值守。
                  </p>
                )}
                <label>
                  机组
                  <select value={runForm.genId} onChange={(e) => setRunForm({ ...runForm, genId: e.target.value })} required>
                    {store.gens.map((gen) => (
                      <option key={gen.id} value={gen.id}>{gen.name}（{gen.location}）</option>
                    ))}
                  </select>
                </label>
                {runFormGen && (
                  <p className="hint">
                    当前燃油批次 {runFormGen.fuelBatch}，到期 {runFormGen.fuelExpiry}（{expiryText(daysUntil(runFormGen.fuelExpiry))}）
                  </p>
                )}
                <label>
                  试机日期
                  <input type="date" value={runForm.date} onChange={(e) => setRunForm({ ...runForm, date: e.target.value })} required />
                </label>
                <div className="field-row">
                  <label>
                    开机油位（%）
                    <input type="number" min={0} max={100} value={runForm.oilLevel}
                      onChange={(e) => setRunForm({ ...runForm, oilLevel: Number(e.target.value) })} required />
                  </label>
                  <label>
                    排烟温度（℃）
                    <input type="number" min={0} value={runForm.exhaustTemp}
                      onChange={(e) => setRunForm({ ...runForm, exhaustTemp: Number(e.target.value) })} required />
                  </label>
                </div>
                <div className="field-row">
                  <label>
                    空载时长（分钟）
                    <input type="number" min={0} value={runForm.noLoadMin}
                      onChange={(e) => setRunForm({ ...runForm, noLoadMin: Number(e.target.value) })} required />
                  </label>
                  <label>
                    带载时长（分钟）
                    <input type="number" min={0} value={runForm.loadMin}
                      onChange={(e) => setRunForm({ ...runForm, loadMin: Number(e.target.value) })} required />
                  </label>
                </div>
                <label>
                  异响情况
                  <select value={runForm.noise} onChange={(e) => setRunForm({ ...runForm, noise: e.target.value as Noise })} required>
                    <option>无异常</option>
                    <option>异响未确认</option>
                    <option>异响已确认</option>
                  </select>
                </label>
                <label>
                  异响结论 / 现象
                  <textarea value={runForm.noiseNote} onChange={(e) => setRunForm({ ...runForm, noiseNote: e.target.value })}
                    placeholder={runForm.noise === "无异常" ? "可填运行状况说明" : "描述异响现象；已确认时写清结论"} />
                </label>
                <label>
                  登记人
                  <input value={runForm.operator} onChange={(e) => setRunForm({ ...runForm, operator: e.target.value })} required placeholder="姓名" />
                </label>
                <button type="submit">{runFormRepair ? "登记复机试机" : "登记试机"}</button>
              </form>
            ) : (
              <form className="form-grid" onSubmit={submitOil}>
                <h2>换油登记</h2>
                <label>
                  机组
                  <select value={oilForm.genId} onChange={(e) => setOilForm({ ...oilForm, genId: e.target.value })} required>
                    {store.gens.map((gen) => (
                      <option key={gen.id} value={gen.id}>{gen.name}（{gen.location}）</option>
                    ))}
                  </select>
                </label>
                {oilFormGen && (
                  <p className="hint">
                    旧批次 {oilFormGen.fuelBatch}，到期 {oilFormGen.fuelExpiry}（{expiryText(daysUntil(oilFormGen.fuelExpiry))}），换油后机组燃油信息自动更新
                  </p>
                )}
                <label>
                  换油日期
                  <input type="date" value={oilForm.date} onChange={(e) => setOilForm({ ...oilForm, date: e.target.value })} required />
                </label>
                <div className="field-row">
                  <label>
                    旧油剩余量（L）
                    <input type="number" min={0} step="0.5" value={oilForm.remainLiters}
                      onChange={(e) => setOilForm({ ...oilForm, remainLiters: Number(e.target.value) })} required />
                  </label>
                  <label>
                    报废去向
                    <select value={oilForm.disposal} onChange={(e) => setOilForm({ ...oilForm, disposal: e.target.value })} required>
                      {DISPOSAL_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                    </select>
                  </label>
                </div>
                <label>
                  新批次号
                  <input value={oilForm.newBatch} onChange={(e) => setOilForm({ ...oilForm, newBatch: e.target.value })} required placeholder="如 CY-2026-0927" />
                </label>
                <label>
                  新批次到期日
                  <input type="date" value={oilForm.newExpiry} onChange={(e) => setOilForm({ ...oilForm, newExpiry: e.target.value })} required />
                </label>
                <label>
                  经办人
                  <input value={oilForm.operator} onChange={(e) => setOilForm({ ...oilForm, operator: e.target.value })} required placeholder="姓名" />
                </label>
                <button type="submit">登记换油</button>
              </form>
            )}
          </div>

          {/* 右栏：待办 + 机组状态 + 经历查询 */}
          <div className="list-panel" ref={statusPanelRef}>
            <div className="toolbar">
              <h2>待办（{todos.length}）</h2>
            </div>
            {todos.length === 0 ? (
              <div className="empty">暂无待办，各机组状态正常</div>
            ) : (
              <div className="todo-list">
                {todos.map((todo) => (
                  <div className="todo" key={todo.key}>
                    <span>{todo.text}</span>
                    <button type="button" onClick={() => handleTodo(todo)}>{todo.actionText}</button>
                  </div>
                ))}
              </div>
            )}

            <div className="toolbar">
              <h2>机组最近状态</h2>
            </div>
            <div className="record-grid">
              {genViews.map((view) => {
                const { gen, lastRun, activeRepair, fuelDays, status, reasons } = view;
                return (
                  <article className="record" key={gen.id}>
                    <div className="record-head">
                      <p className="record-title">{gen.name} · {gen.location}</p>
                      <span className={`status ${STATUS_CLASS[status]}`}>{status}</span>
                    </div>
                    <div className="details">
                      <span>燃油批次: {gen.fuelBatch}</span>
                      <span>到期: {gen.fuelExpiry}（{expiryText(fuelDays)}）</span>
                      {lastRun ? (
                        <>
                          <span>最近试机: {lastRun.date}（{lastRun.kind}）</span>
                          <span>开机油位: {lastRun.oilLevel}%</span>
                          <span>空载 / 带载: {lastRun.noLoadMin} / {lastRun.loadMin} 分钟</span>
                          <span>排烟温度: {lastRun.exhaustTemp}℃</span>
                          <span>异响: {lastRun.noise}</span>
                          <span>登记人: {lastRun.operator}</span>
                        </>
                      ) : (
                        <span>最近试机: 暂无记录</span>
                      )}
                    </div>
                    {lastRun?.noiseNote && <p className="note">异响说明：{lastRun.noiseNote}</p>}
                    {reasons.length > 0 && (
                      <ul className="reasons">
                        {reasons.map((reason) => <li key={reason}>{reason}</li>)}
                      </ul>
                    )}

                    {confirmingRunId === lastRun?.id && (
                      <div className="inline-form">
                        <label>
                          异响确认结论
                          <textarea value={confirmNote} onChange={(e) => setConfirmNote(e.target.value)}
                            placeholder="写清异响原因、检查结论" />
                        </label>
                        <div className="actions">
                          <button type="button" disabled={!confirmNote.trim()} onClick={() => submitConfirmNoise(lastRun.id)}>保存结论</button>
                          <button type="button" className="secondary" onClick={() => setConfirmingRunId(null)}>取消</button>
                        </div>
                      </div>
                    )}

                    {sendingId === gen.id && (
                      <div className="inline-form">
                        <label>
                          送修原因
                          <textarea value={repairForm.reason} onChange={(e) => setRepairForm({ ...repairForm, reason: e.target.value })}
                            placeholder="故障现象、送修去向" />
                        </label>
                        <label>
                          处理人
                          <input value={repairForm.handler} onChange={(e) => setRepairForm({ ...repairForm, handler: e.target.value })}
                            placeholder="姓名" />
                        </label>
                        <div className="actions">
                          <button type="button" disabled={!repairForm.reason.trim() || !repairForm.handler.trim()} onClick={() => submitRepair(gen.id)}>确认送修</button>
                          <button type="button" className="secondary" onClick={() => setSendingId(null)}>取消</button>
                        </div>
                      </div>
                    )}

                    <div className="actions">
                      <button type="button" onClick={() => gotoRunForm(gen.id)}>
                        {activeRepair ? "复机（补带载试机）" : "登记试机"}
                      </button>
                      {!activeRepair && (
                        <button type="button" className="secondary" onClick={() => { setSendingId(gen.id); setRepairForm({ reason: "", handler: "" }); }}>
                          送修
                        </button>
                      )}
                      {lastRun?.noise === "异响未确认" && confirmingRunId !== lastRun.id && (
                        <button type="button" className="secondary" onClick={() => { setConfirmingRunId(lastRun.id); setConfirmNote(""); }}>
                          确认异响
                        </button>
                      )}
                      {fuelDays < EXPIRY_WARN_DAYS && !activeRepair && (
                        <button type="button" className="secondary" onClick={() => gotoOilForm(gen.id)}>去换油</button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="mini-chart">
              {chartRows.map((row) => (
                <div className="bar" key={row.status}>
                  <span>{row.status}</span>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${(row.value / maxChart) * 100}%` }} /></div>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>

            <div className="toolbar history-head">
              <h2>经历查询</h2>
              <select value={historyGen} onChange={(e) => setHistoryGen(e.target.value)}>
                {historyGens.map((gen) => <option key={gen.id} value={gen.id}>{gen.name}</option>)}
              </select>
            </div>
            <div className="tabs">
              <button type="button" className={`tab-btn ${historyTab === "oil" ? "active" : ""}`} onClick={() => setHistoryTab("oil")}>
                换油经历（{oilHistory.length}）
              </button>
              <button type="button" className={`tab-btn ${historyTab === "repair" ? "active" : ""}`} onClick={() => setHistoryTab("repair")}>
                送修记录（{repairHistory.length}）
              </button>
              <button type="button" className={`tab-btn ${historyTab === "run" ? "active" : ""}`} onClick={() => setHistoryTab("run")}>
                试机记录（{runHistory.length}）
              </button>
            </div>

            <div className="history-list">
              {historyTab === "oil" && (
                oilHistory.length === 0 ? <div className="empty">暂无换油记录</div> : oilHistory.map((item) => (
                  <div className="history-item" key={item.id}>
                    <strong>{genById(item.genId)?.name ?? "未知机组"} · {item.date}</strong>
                    <div className="meta">
                      旧批次 {item.oldBatch}（剩余 {item.remainLiters}L，{item.disposal}）→ 新批次 {item.newBatch}，到期 {item.newExpiry} · 经办人：{item.operator}
                    </div>
                  </div>
                ))
              )}
              {historyTab === "repair" && (
                repairHistory.length === 0 ? <div className="empty">暂无送修记录</div> : repairHistory.map((item) => (
                  <div className="history-item" key={item.id}>
                    <strong>{genById(item.genId)?.name ?? "未知机组"} · {item.sentAt} 送修</strong>
                    <div className="meta">
                      原因：{item.reason} · 处理人：{item.handler} · {item.returnedAt ? `${item.returnedAt} 复机（已补复机试机）` : "维修中，待复机试机"}
                    </div>
                  </div>
                ))
              )}
              {historyTab === "run" && (
                runHistory.length === 0 ? <div className="empty">暂无试机记录</div> : runHistory.map((item) => (
                  <div className="history-item" key={item.id}>
                    <strong>{genById(item.genId)?.name ?? "未知机组"} · {item.date}（{item.kind}）</strong>
                    <div className="meta">
                      油位 {item.oilLevel}% · 空载 {item.noLoadMin} 分钟 · 带载 {item.loadMin} 分钟 · 排烟 {item.exhaustTemp}℃ · {item.noise}
                      {item.noiseNote ? `（${item.noiseNote}）` : ""} · 登记人：{item.operator}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
