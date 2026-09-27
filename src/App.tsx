import { FormEvent, useMemo, useState } from "react";

const project = {
  title: "应急发电机值守台",
  subtitle:
    "登记试机、送修与换油。燃油距到期不足30天、带载不足15分钟或异响未确认时，机组自动停在待处理；复机前须补一次带载试机。",
  industry: "石油",
  stack: ["React", "Vite", "TypeScript", "Zustand", "Ant Design"],
  storageKey: "dfwlfront-10-generator-duty"
} as const;

const LOAD_MIN_MINUTES = 15;
const EXPIRY_WARN_DAYS = 30;

const UNIT_ROSTER = ["1号应急发电机", "2号应急发电机"];
const OIL_LEVELS = ["正常", "偏低", "偏高"];
const NOISE_RESULTS = ["无异响", "异响已确认", "异响未确认"];
const DISPOSAL_OPTIONS = ["危废处置单位回收", "供应商回收", "站内暂存待处置"];

type UnitStatus = "正常" | "待处理" | "送修中";

type TestRun = {
  id: string;
  unit: string;
  runAt: string;
  fuelBatch: string;
  fuelExpiry: string;
  oilLevel: string;
  noLoadMinutes: number;
  loadMinutes: number;
  exhaustTemp: number;
  noise: string;
  operator: string;
  notes: string;
  createdAt: string;
};

type Repair = {
  id: string;
  unit: string;
  sentAt: string;
  reason: string;
  handler: string;
  returnedAt: string;
  createdAt: string;
};

type OilChange = {
  id: string;
  unit: string;
  changedAt: string;
  oldBatch: string;
  remainLiters: number;
  disposal: string;
  newBatch: string;
  operator: string;
  createdAt: string;
};

type Store = {
  runs: TestRun[];
  repairs: Repair[];
  oilChanges: OilChange[];
};

type UnitEval = {
  unit: string;
  status: UnitStatus;
  reasons: string[];
  latestRun?: TestRun;
  openRepair?: Repair;
  lastRepair?: Repair;
  lastOilChange?: OilChange;
};

const seedStore: Store = {
  runs: [
    {
      id: "seed-run-1",
      unit: "1号应急发电机",
      runAt: "2026-08-15",
      fuelBatch: "CY-2602-A",
      fuelExpiry: "2026-09-05",
      oilLevel: "正常",
      noLoadMinutes: 5,
      loadMinutes: 8,
      exhaustTemp: 405,
      noise: "异响未确认",
      operator: "何鑫",
      notes: "启动后有间断敲击声，安排送修",
      createdAt: "2026-08-15T09:00:00.000Z"
    },
    {
      id: "seed-run-2",
      unit: "1号应急发电机",
      runAt: "2026-09-20",
      fuelBatch: "CY-2608-A",
      fuelExpiry: "2027-03-31",
      oilLevel: "正常",
      noLoadMinutes: 5,
      loadMinutes: 22,
      exhaustTemp: 386,
      noise: "无异响",
      operator: "何鑫",
      notes: "送修复机后补带载试机，运行平稳",
      createdAt: "2026-09-20T09:00:00.000Z"
    },
    {
      id: "seed-run-3",
      unit: "2号应急发电机",
      runAt: "2026-09-25",
      fuelBatch: "CY-2603-B",
      fuelExpiry: "2026-10-10",
      oilLevel: "偏低",
      noLoadMinutes: 6,
      loadMinutes: 10,
      exhaustTemp: 412,
      noise: "异响未确认",
      operator: "赵岚",
      notes: "带载不足，启动初期有敲击声，未查明",
      createdAt: "2026-09-25T09:00:00.000Z"
    }
  ],
  repairs: [
    {
      id: "seed-repair-1",
      unit: "1号应急发电机",
      sentAt: "2026-08-16",
      reason: "试机异响，拆检为喷油嘴积碳",
      handler: "周工（外委）",
      returnedAt: "2026-09-20",
      createdAt: "2026-08-16T09:00:00.000Z"
    }
  ],
  oilChanges: [
    {
      id: "seed-oil-1",
      unit: "1号应急发电机",
      changedAt: "2026-08-16",
      oldBatch: "CY-2602-A",
      remainLiters: 18,
      disposal: "危废处置单位回收",
      newBatch: "CY-2608-A",
      operator: "何鑫",
      createdAt: "2026-08-16T10:00:00.000Z"
    }
  ]
};

function todayStr() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function daysUntil(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function loadStore(): Store {
  const raw = localStorage.getItem(project.storageKey);
  if (!raw) return seedStore;
  try {
    const parsed = JSON.parse(raw) as Store;
    return {
      runs: parsed.runs ?? [],
      repairs: parsed.repairs ?? [],
      oilChanges: parsed.oilChanges ?? []
    };
  } catch {
    return seedStore;
  }
}

function evaluateUnit(unit: string, runs: TestRun[], repairs: Repair[], oilChanges: OilChange[]): UnitEval {
  const latestRun = runs
    .filter((run) => run.unit === unit)
    .sort((a, b) => (a.runAt === b.runAt ? b.createdAt.localeCompare(a.createdAt) : b.runAt.localeCompare(a.runAt)))[0];
  const openRepair = repairs
    .filter((repair) => repair.unit === unit && !repair.returnedAt)
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
  const lastRepair = repairs
    .filter((repair) => repair.unit === unit && repair.returnedAt)
    .sort((a, b) => b.returnedAt.localeCompare(a.returnedAt))[0];
  const lastOilChange = oilChanges
    .filter((change) => change.unit === unit)
    .sort((a, b) => b.changedAt.localeCompare(a.changedAt))[0];

  if (openRepair) {
    return {
      unit,
      status: "送修中",
      reasons: [`送修原因：${openRepair.reason}（处理人：${openRepair.handler}）`],
      latestRun,
      openRepair,
      lastRepair,
      lastOilChange
    };
  }

  const reasons: string[] = [];
  if (!latestRun) {
    reasons.push("尚无试机记录");
  } else {
    const days = daysUntil(latestRun.fuelExpiry);
    if (days < 0) reasons.push(`燃油批次 ${latestRun.fuelBatch} 已过期 ${-days} 天`);
    else if (days < EXPIRY_WARN_DAYS) reasons.push(`燃油批次 ${latestRun.fuelBatch} 距到期 ${days} 天（不足${EXPIRY_WARN_DAYS}天）`);
    if (latestRun.loadMinutes < LOAD_MIN_MINUTES) reasons.push(`带载时长 ${latestRun.loadMinutes} 分钟（不足${LOAD_MIN_MINUTES}分钟）`);
    if (latestRun.noise === "异响未确认") reasons.push("异响未确认，需查明原因");
  }
  return { unit, status: reasons.length ? "待处理" : "正常", reasons, latestRun, lastRepair, lastOilChange };
}

function runFlags(run: TestRun) {
  const flags: string[] = [];
  const days = daysUntil(run.fuelExpiry);
  if (days < 0) flags.push(`燃油已过期${-days}天`);
  else if (days < EXPIRY_WARN_DAYS) flags.push(`燃油${days}天到期`);
  if (run.loadMinutes < LOAD_MIN_MINUTES) flags.push(`带载不足${LOAD_MIN_MINUTES}分钟`);
  if (run.noise === "异响未确认") flags.push("异响未确认");
  return flags;
}

const statusClass: Record<UnitStatus, string> = {
  正常: "ok",
  待处理: "pending",
  送修中: "repair"
};

type RunForm = {
  unit: string;
  runAt: string;
  fuelBatch: string;
  fuelExpiry: string;
  oilLevel: string;
  noLoadMinutes: string;
  loadMinutes: string;
  exhaustTemp: string;
  noise: string;
  operator: string;
  notes: string;
};

function blankRunForm(): RunForm {
  return {
    unit: UNIT_ROSTER[0],
    runAt: todayStr(),
    fuelBatch: "",
    fuelExpiry: "",
    oilLevel: OIL_LEVELS[0],
    noLoadMinutes: "5",
    loadMinutes: "",
    exhaustTemp: "",
    noise: NOISE_RESULTS[0],
    operator: "",
    notes: ""
  };
}

type FormTab = "run" | "repair" | "oil";
type ViewTab = "status" | "todo" | "runs" | "oil";

const formTabs: { key: FormTab; label: string }[] = [
  { key: "run", label: "试机登记" },
  { key: "repair", label: "送修登记" },
  { key: "oil", label: "换油登记" }
];

export default function App() {
  const [store, setStore] = useState<Store>(loadStore);
  const [formTab, setFormTab] = useState<FormTab>("run");
  const [viewTab, setViewTab] = useState<ViewTab>("status");
  const [flash, setFlash] = useState<{ type: "ok" | "warn"; text: string } | null>(null);

  const [runForm, setRunForm] = useState<RunForm>(blankRunForm);
  const [repairForm, setRepairForm] = useState({ unit: UNIT_ROSTER[0], sentAt: todayStr(), reason: "", handler: "" });
  const [oilForm, setOilForm] = useState({
    unit: UNIT_ROSTER[0],
    changedAt: todayStr(),
    oldBatch: "",
    remainLiters: "",
    disposal: DISPOSAL_OPTIONS[0],
    newBatch: "",
    operator: ""
  });

  const units = useMemo(() => {
    const names = new Set<string>(UNIT_ROSTER);
    store.runs.forEach((run) => names.add(run.unit));
    store.repairs.forEach((repair) => names.add(repair.unit));
    store.oilChanges.forEach((change) => names.add(change.unit));
    return [...names];
  }, [store]);

  const evals = useMemo(
    () => units.map((unit) => evaluateUnit(unit, store.runs, store.repairs, store.oilChanges)),
    [units, store]
  );

  const todos = useMemo(
    () =>
      evals.flatMap((ev) => {
        if (ev.status === "送修中" && ev.openRepair) {
          return [
            {
              id: `todo-${ev.openRepair.id}`,
              unit: ev.unit,
              kind: "复机试机",
              text: `送修中：${ev.openRepair.reason}（处理人：${ev.openRepair.handler}），复机前须补一次带载≥${LOAD_MIN_MINUTES}分钟的试机`
            }
          ];
        }
        return ev.reasons.map((reason, index) => ({ id: `todo-${ev.unit}-${index}`, unit: ev.unit, kind: "待处理", text: reason }));
      }),
    [evals]
  );

  const metrics = [
    { label: "在册机组", value: evals.length },
    { label: "正常值守", value: evals.filter((ev) => ev.status === "正常").length },
    { label: "待处理", value: evals.filter((ev) => ev.status === "待处理").length },
    { label: "送修中", value: evals.filter((ev) => ev.status === "送修中").length }
  ];

  const eligibleRepairUnits = units.filter((unit) => !evals.find((ev) => ev.unit === unit)?.openRepair);

  const runPreview = useMemo(() => {
    const reasons: string[] = [];
    if (runForm.fuelExpiry) {
      const days = daysUntil(runForm.fuelExpiry);
      if (days < 0) reasons.push(`燃油已过期${-days}天`);
      else if (days < EXPIRY_WARN_DAYS) reasons.push(`燃油距到期${days}天`);
    }
    if (runForm.loadMinutes !== "" && Number(runForm.loadMinutes) < LOAD_MIN_MINUTES) reasons.push(`带载不足${LOAD_MIN_MINUTES}分钟`);
    if (runForm.noise === "异响未确认") reasons.push("异响未确认");
    return reasons;
  }, [runForm]);

  const sortedRuns = useMemo(
    () =>
      [...store.runs].sort((a, b) =>
        a.runAt === b.runAt ? b.createdAt.localeCompare(a.createdAt) : b.runAt.localeCompare(a.runAt)
      ),
    [store.runs]
  );

  const sortedOilChanges = useMemo(
    () => [...store.oilChanges].sort((a, b) => b.changedAt.localeCompare(a.changedAt)),
    [store.oilChanges]
  );

  function persist(next: Store) {
    setStore(next);
    localStorage.setItem(project.storageKey, JSON.stringify(next));
  }

  function handleRunSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const run: TestRun = {
      id: crypto.randomUUID(),
      unit: runForm.unit,
      runAt: runForm.runAt,
      fuelBatch: runForm.fuelBatch,
      fuelExpiry: runForm.fuelExpiry,
      oilLevel: runForm.oilLevel,
      noLoadMinutes: Number(runForm.noLoadMinutes),
      loadMinutes: Number(runForm.loadMinutes),
      exhaustTemp: Number(runForm.exhaustTemp),
      noise: runForm.noise,
      operator: runForm.operator,
      notes: runForm.notes || "暂无备注",
      createdAt: new Date().toISOString()
    };
    const next = { ...store, runs: [run, ...store.runs] };
    persist(next);
    const ev = evaluateUnit(run.unit, next.runs, next.repairs, next.oilChanges);
    setFlash(
      ev.status === "正常"
        ? { type: "ok", text: `${run.unit} 试机已登记，当前状态：正常值守。` }
        : { type: "warn", text: `${run.unit} 试机已登记，当前状态：${ev.status}（${ev.reasons.join("；")}）` }
    );
    setRunForm({ ...blankRunForm(), unit: runForm.unit, operator: runForm.operator });
  }

  function handleRepairSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!eligibleRepairUnits.includes(repairForm.unit)) {
      setFlash({ type: "warn", text: `${repairForm.unit} 已在送修中，请先办理复机。` });
      return;
    }
    const repair: Repair = {
      id: crypto.randomUUID(),
      unit: repairForm.unit,
      sentAt: repairForm.sentAt,
      reason: repairForm.reason,
      handler: repairForm.handler,
      returnedAt: "",
      createdAt: new Date().toISOString()
    };
    persist({ ...store, repairs: [repair, ...store.repairs] });
    setFlash({ type: "warn", text: `${repair.unit} 已登记送修（处理人：${repair.handler}），机组转为送修中；复机前须补带载试机。` });
    setRepairForm({ unit: eligibleRepairUnits[0] ?? UNIT_ROSTER[0], sentAt: todayStr(), reason: "", handler: "" });
  }

  function handleReturn(repair: Repair) {
    const qualified = store.runs.some(
      (run) => run.unit === repair.unit && run.runAt >= repair.sentAt && run.loadMinutes >= LOAD_MIN_MINUTES
    );
    if (!qualified) {
      setFlash({
        type: "warn",
        text: `${repair.unit} 复机前须补一次带载≥${LOAD_MIN_MINUTES}分钟的试机，请先在「试机登记」中补录。`
      });
      setFormTab("run");
      return;
    }
    persist({
      ...store,
      repairs: store.repairs.map((item) => (item.id === repair.id ? { ...item, returnedAt: todayStr() } : item))
    });
    setFlash({ type: "ok", text: `${repair.unit} 已复机：送修后带载试机合格，恢复值守。` });
  }

  function handleOilSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const change: OilChange = {
      id: crypto.randomUUID(),
      unit: oilForm.unit,
      changedAt: oilForm.changedAt,
      oldBatch: oilForm.oldBatch,
      remainLiters: Number(oilForm.remainLiters),
      disposal: oilForm.disposal,
      newBatch: oilForm.newBatch,
      operator: oilForm.operator,
      createdAt: new Date().toISOString()
    };
    persist({ ...store, oilChanges: [change, ...store.oilChanges] });
    setFlash({
      type: "ok",
      text: `${change.unit} 换油已登记：旧批次 ${change.oldBatch}（余 ${change.remainLiters}L）→ ${change.disposal}。`
    });
    setOilForm({ unit: oilForm.unit, changedAt: todayStr(), oldBatch: "", remainLiters: "", disposal: DISPOSAL_OPTIONS[0], newBatch: "", operator: oilForm.operator });
  }

  const viewTabs: { key: ViewTab; label: string; count?: number }[] = [
    { key: "status", label: "最近状态" },
    { key: "todo", label: "待办", count: todos.length },
    { key: "runs", label: "试机记录" },
    { key: "oil", label: "换油经历" }
  ];

  return (
    <main className="app">
      <div className="shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">{project.industry}行业 · 应急电源值守</p>
            <h1>{project.title}</h1>
            <p className="subtitle">{project.subtitle}</p>
          </div>
          <div className="stack">{project.stack.map((item) => <span className="tag" key={item}>{item}</span>)}</div>
        </header>

        <section className="metrics">
          {metrics.map((metric) => (
            <article className="metric" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </article>
          ))}
        </section>

        {flash && <div className={`flash ${flash.type}`}>{flash.text}</div>}

        <section className="workspace">
          <div className="panel">
            <div className="subtabs">
              {formTabs.map((tab) => (
                <button
                  type="button"
                  key={tab.key}
                  className={`subtab ${formTab === tab.key ? "active" : ""}`}
                  onClick={() => setFormTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {formTab === "run" && (
              <form className="form-grid" onSubmit={handleRunSubmit}>
                <h2>试机登记</h2>
                <label>
                  机组
                  <select value={runForm.unit} onChange={(event) => setRunForm({ ...runForm, unit: event.target.value })}>
                    {units.map((unit) => <option key={unit}>{unit}</option>)}
                  </select>
                </label>
                <label>
                  试机日期
                  <input type="date" value={runForm.runAt} onChange={(event) => setRunForm({ ...runForm, runAt: event.target.value })} required />
                </label>
                <label>
                  燃油批次
                  <input value={runForm.fuelBatch} onChange={(event) => setRunForm({ ...runForm, fuelBatch: event.target.value })} placeholder="如 CY-2609-A" required />
                </label>
                <label>
                  燃油到期日
                  <input type="date" value={runForm.fuelExpiry} onChange={(event) => setRunForm({ ...runForm, fuelExpiry: event.target.value })} required />
                </label>
                <label>
                  开机油位
                  <select value={runForm.oilLevel} onChange={(event) => setRunForm({ ...runForm, oilLevel: event.target.value })}>
                    {OIL_LEVELS.map((level) => <option key={level}>{level}</option>)}
                  </select>
                </label>
                <label>
                  空载时长（分钟）
                  <input type="number" min="0" value={runForm.noLoadMinutes} onChange={(event) => setRunForm({ ...runForm, noLoadMinutes: event.target.value })} required />
                </label>
                <label>
                  带载时长（分钟）
                  <input type="number" min="0" value={runForm.loadMinutes} onChange={(event) => setRunForm({ ...runForm, loadMinutes: event.target.value })} placeholder={`≥${LOAD_MIN_MINUTES} 分钟`} required />
                </label>
                <label>
                  排烟温度（℃）
                  <input type="number" min="0" max="800" value={runForm.exhaustTemp} onChange={(event) => setRunForm({ ...runForm, exhaustTemp: event.target.value })} required />
                </label>
                <label>
                  异响结论
                  <select value={runForm.noise} onChange={(event) => setRunForm({ ...runForm, noise: event.target.value })}>
                    {NOISE_RESULTS.map((result) => <option key={result}>{result}</option>)}
                  </select>
                </label>
                <label>
                  值守人
                  <input value={runForm.operator} onChange={(event) => setRunForm({ ...runForm, operator: event.target.value })} required />
                </label>
                <label>
                  备注
                  <textarea value={runForm.notes} onChange={(event) => setRunForm({ ...runForm, notes: event.target.value })} placeholder="填写现场情况或处理说明" />
                </label>
                <p className={`preview ${runPreview.length ? "pending" : ""}`}>
                  登记后预判：{runPreview.length ? `待处理（${runPreview.join("；")}）` : "正常值守"}
                </p>
                <button type="submit">登记试机</button>
              </form>
            )}

            {formTab === "repair" && (
              <form className="form-grid" onSubmit={handleRepairSubmit}>
                <h2>送修登记</h2>
                {eligibleRepairUnits.length === 0 ? (
                  <p className="muted">全部机组均在送修中，请先在「最近状态」办理复机。</p>
                ) : (
                  <>
                    <label>
                      机组
                      <select value={repairForm.unit} onChange={(event) => setRepairForm({ ...repairForm, unit: event.target.value })}>
                        {eligibleRepairUnits.map((unit) => <option key={unit}>{unit}</option>)}
                      </select>
                    </label>
                    <label>
                      送修日期
                      <input type="date" value={repairForm.sentAt} onChange={(event) => setRepairForm({ ...repairForm, sentAt: event.target.value })} required />
                    </label>
                    <label>
                      送修原因
                      <textarea value={repairForm.reason} onChange={(event) => setRepairForm({ ...repairForm, reason: event.target.value })} placeholder="写清故障现象与送修原因" required />
                    </label>
                    <label>
                      处理人
                      <input value={repairForm.handler} onChange={(event) => setRepairForm({ ...repairForm, handler: event.target.value })} placeholder="维修负责人或外委单位" required />
                    </label>
                    <button type="submit">登记送修</button>
                  </>
                )}
              </form>
            )}

            {formTab === "oil" && (
              <form className="form-grid" onSubmit={handleOilSubmit}>
                <h2>换油登记</h2>
                <label>
                  机组
                  <select value={oilForm.unit} onChange={(event) => setOilForm({ ...oilForm, unit: event.target.value })}>
                    {units.map((unit) => <option key={unit}>{unit}</option>)}
                  </select>
                </label>
                <label>
                  换油日期
                  <input type="date" value={oilForm.changedAt} onChange={(event) => setOilForm({ ...oilForm, changedAt: event.target.value })} required />
                </label>
                <label>
                  旧批次
                  <input value={oilForm.oldBatch} onChange={(event) => setOilForm({ ...oilForm, oldBatch: event.target.value })} placeholder="被替换的燃油批次" required />
                </label>
                <label>
                  剩余量（L）
                  <input type="number" min="0" value={oilForm.remainLiters} onChange={(event) => setOilForm({ ...oilForm, remainLiters: event.target.value })} required />
                </label>
                <label>
                  报废去向
                  <select value={oilForm.disposal} onChange={(event) => setOilForm({ ...oilForm, disposal: event.target.value })}>
                    {DISPOSAL_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                  </select>
                </label>
                <label>
                  新批次（选填）
                  <input value={oilForm.newBatch} onChange={(event) => setOilForm({ ...oilForm, newBatch: event.target.value })} placeholder="加注的新燃油批次" />
                </label>
                <label>
                  经办人
                  <input value={oilForm.operator} onChange={(event) => setOilForm({ ...oilForm, operator: event.target.value })} required />
                </label>
                <button type="submit">登记换油</button>
              </form>
            )}
          </div>

          <section className="list-panel">
            <div className="toolbar">
              <div className="tabs">
                {viewTabs.map((tab) => (
                  <button
                    type="button"
                    key={tab.key}
                    className={`tab ${viewTab === tab.key ? "active" : ""}`}
                    onClick={() => setViewTab(tab.key)}
                  >
                    {tab.label}
                    {tab.count ? <span className="badge">{tab.count}</span> : null}
                  </button>
                ))}
              </div>
            </div>

            {viewTab === "status" && (
              <div className="record-grid">
                {evals.map((ev) => (
                  <article className="record" key={ev.unit}>
                    <div className="record-head">
                      <p className="record-title">{ev.unit}</p>
                      <span className={`status ${statusClass[ev.status]}`}>{ev.status}</span>
                    </div>
                    {ev.reasons.length > 0 && (
                      <ul className="warn-list">
                        {ev.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                      </ul>
                    )}
                    {ev.latestRun ? (
                      <div className="details">
                        <span>最近试机: {ev.latestRun.runAt}</span>
                        <span>燃油批次: {ev.latestRun.fuelBatch}</span>
                        <span>
                          燃油到期: {ev.latestRun.fuelExpiry}（
                          {daysUntil(ev.latestRun.fuelExpiry) < 0 ? `已过期${-daysUntil(ev.latestRun.fuelExpiry)}天` : `余${daysUntil(ev.latestRun.fuelExpiry)}天`}）
                        </span>
                        <span>开机油位: {ev.latestRun.oilLevel}</span>
                        <span>空载时长: {ev.latestRun.noLoadMinutes} 分钟</span>
                        <span>带载时长: {ev.latestRun.loadMinutes} 分钟</span>
                        <span>排烟温度: {ev.latestRun.exhaustTemp} ℃</span>
                        <span>异响结论: {ev.latestRun.noise}</span>
                        <span>值守人: {ev.latestRun.operator}</span>
                      </div>
                    ) : (
                      <p className="muted">尚无试机记录，请先在「试机登记」中补录。</p>
                    )}
                    {ev.openRepair && (
                      <div className="repair-box">
                        <p>送修中 · {ev.openRepair.sentAt} 送出</p>
                        <p>原因：{ev.openRepair.reason} ｜ 处理人：{ev.openRepair.handler}</p>
                        <div className="actions">
                          <button type="button" onClick={() => handleReturn(ev.openRepair!)}>办理复机</button>
                          <button
                            className="secondary"
                            type="button"
                            onClick={() => persist({ ...store, repairs: store.repairs.filter((item) => item.id !== ev.openRepair!.id) })}
                          >
                            撤销送修
                          </button>
                        </div>
                      </div>
                    )}
                    {ev.lastRepair && (
                      <p className="muted">最近送修：{ev.lastRepair.sentAt} {ev.lastRepair.reason}（{ev.lastRepair.handler}），{ev.lastRepair.returnedAt} 复机</p>
                    )}
                    {ev.lastOilChange && (
                      <p className="muted">
                        最近换油：{ev.lastOilChange.changedAt} · 旧批次 {ev.lastOilChange.oldBatch}（余 {ev.lastOilChange.remainLiters}L）→ {ev.lastOilChange.disposal}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}

            {viewTab === "todo" && (
              <div className="record-grid">
                {todos.length === 0 ? (
                  <div className="empty">暂无待办，机组值守正常</div>
                ) : (
                  todos.map((todo) => (
                    <div className="todo-item" key={todo.id}>
                      <span className={`todo-kind ${todo.kind === "复机试机" ? "repair" : ""}`}>{todo.kind}</span>
                      <div>
                        <strong>{todo.unit}</strong>
                        <p className="todo-text">{todo.text}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {viewTab === "runs" && (
              <div className="record-grid">
                {sortedRuns.length === 0 ? (
                  <div className="empty">暂无试机记录</div>
                ) : (
                  sortedRuns.map((run) => {
                    const flags = runFlags(run);
                    return (
                      <article className="record" key={run.id}>
                        <div className="record-head">
                          <p className="record-title">{run.unit} · {run.runAt}</p>
                          <span className={`status ${flags.length ? "pending" : "ok"}`}>{flags.length ? "需关注" : "合格"}</span>
                        </div>
                        {flags.length > 0 && (
                          <div className="chips">{flags.map((flag) => <span className="chip" key={flag}>{flag}</span>)}</div>
                        )}
                        <div className="details">
                          <span>燃油批次: {run.fuelBatch}</span>
                          <span>燃油到期: {run.fuelExpiry}</span>
                          <span>开机油位: {run.oilLevel}</span>
                          <span>空载时长: {run.noLoadMinutes} 分钟</span>
                          <span>带载时长: {run.loadMinutes} 分钟</span>
                          <span>排烟温度: {run.exhaustTemp} ℃</span>
                          <span>异响结论: {run.noise}</span>
                          <span>值守人: {run.operator}</span>
                        </div>
                        <p className="note">{run.notes}</p>
                        <div className="actions">
                          <button
                            className="danger"
                            type="button"
                            onClick={() => persist({ ...store, runs: store.runs.filter((item) => item.id !== run.id) })}
                          >
                            删除
                          </button>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            )}

            {viewTab === "oil" && (
              <div className="record-grid">
                {sortedOilChanges.length === 0 ? (
                  <div className="empty">暂无换油记录</div>
                ) : (
                  sortedOilChanges.map((change) => (
                    <article className="record" key={change.id}>
                      <div className="record-head">
                        <p className="record-title">{change.unit} · {change.changedAt}</p>
                        <span className="status ok">已换油</span>
                      </div>
                      <div className="details">
                        <span>旧批次: {change.oldBatch}</span>
                        <span>剩余量: {change.remainLiters} L</span>
                        <span>报废去向: {change.disposal}</span>
                        <span>新批次: {change.newBatch || "未登记"}</span>
                        <span>经办人: {change.operator}</span>
                      </div>
                      <div className="actions">
                        <button
                          className="danger"
                          type="button"
                          onClick={() => persist({ ...store, oilChanges: store.oilChanges.filter((item) => item.id !== change.id) })}
                        >
                          删除
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}
