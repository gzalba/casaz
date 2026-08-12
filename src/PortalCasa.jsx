import { useState, useEffect, useRef } from "react";
import { auth, db, googleProvider } from "./firebase";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";

/* ── Tokens ─────────────────────────────────────────────── */
const C = {
  paper: "#F5F6F2",
  card: "#FFFFFF",
  ink: "#16283C",
  inkSoft: "#4A5A6C",
  line: "#D8DDD9",
  amber: "#E39A2D",
  green: "#2F7A52",
  red: "#B3452F",
  blue: "#2C5E8A",
  subtle: "#EEF2EE",
};
const font = "'Archivo', system-ui, sans-serif";
const mono = "'Archivo', ui-monospace, monospace";

const fmt = (n, dec = 0) =>
  new Intl.NumberFormat("es-AR", { maximumFractionDigits: dec, minimumFractionDigits: dec }).format(n || 0);

const KEY = "portal-casa-v1";
const hoy = () => new Date().toISOString().slice(0, 10);
const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const PRIORIDADES = [
  { id: "alta", label: "Alta", color: C.red },
  { id: "media", label: "Media", color: C.amber },
  { id: "baja", label: "Baja", color: C.blue },
];

const inicial = {
  fx: 1200,
  sucesion: [],
  escritura: [],
  casa: { precio: 0, moneda: "USD", fechaPrevista: "", pctDeduccion: 50, cuentas: [], planes: [] },
  reformas: [],
};

/* ── Modelo de ítem con pagos parciales ─────────────────────
   item: { id, concepto, monto, moneda, comprometido(bool),
           pagos: [{ id, fecha, monto, tc }] }
   - pagos en la moneda del ítem
   - tc: valor del dólar a la fecha del pago (para dolarizar ARS)
   - lo no pagado se dolariza al TC de referencia actual
──────────────────────────────────────────────────────────── */

// corrige TCs guardados con el bug de formato ("1.200" leído como 1,2)
const fixTC = (n) => (n > 0 && n < 50 ? n * 1000 : n);

// migra ítems del formato viejo (estado pagado/comprometido/pendiente)
function migrarItem(it, fx) {
  if (it.pagos) return { ...it, pagos: it.pagos.map((p) => ({ ...p, tc: fixTC(Number(p.tc) || fx) })) };
  const pagos =
    it.estado === "pagado" && Number(it.monto) > 0
      ? [{ id: nuevoId(), fecha: "", monto: Number(it.monto), tc: fx }]
      : [];
  return {
    id: it.id || nuevoId(),
    concepto: it.concepto,
    monto: Number(it.monto) || 0,
    moneda: it.moneda || "ARS",
    comprometido: it.estado === "comprometido",
    pagos,
  };
}
const migrarLista = (arr, fx) => (arr || []).map((i) => migrarItem(i, fx));

function calcItem(it, fx) {
  const monto = Number(it.monto) || 0;
  const pagadoNom = (it.pagos || []).reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const pct = monto > 0 ? Math.min(100, (pagadoNom / monto) * 100) : 0;
  const pagadoUSD = (it.pagos || []).reduce((s, p) => {
    const m = Number(p.monto) || 0;
    return s + (it.moneda === "USD" ? m : m / (Number(p.tc) || fx || 1));
  }, 0);
  const restanteNom = Math.max(0, monto - pagadoNom);
  const restanteUSD = it.moneda === "USD" ? restanteNom : restanteNom / (fx || 1);
  return {
    pagadoNom, pct, pagadoUSD, restanteNom, restanteUSD,
    comprometidoUSD: it.comprometido ? restanteUSD : 0,
    pendienteUSD: it.comprometido ? 0 : restanteUSD,
    totalUSD: pagadoUSD + restanteUSD,
  };
}

function totales(items, fx) {
  const t = { pagado: 0, comprometido: 0, pendiente: 0, total: 0 };
  for (const it of items) {
    const c = calcItem(it, fx);
    t.pagado += c.pagadoUSD;
    t.comprometido += c.comprometidoUSD;
    t.pendiente += c.pendienteUSD;
    t.total += c.totalUSD;
  }
  return t;
}

/* ── Componentes visuales ───────────────────────────────── */
function Regla({ pagado, comprometido, total, height = 14 }) {
  const pPag = total > 0 ? Math.min(100, (pagado / total) * 100) : 0;
  const pCom = total > 0 ? Math.min(100 - pPag, (comprometido / total) * 100) : 0;
  const marcas = [0, 25, 50, 75, 100];
  return (
    <div>
      <div style={{ position: "relative", height, background: "#E9ECE7", border: `1px solid ${C.line}`, borderRadius: 3, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pPag}%`, background: C.green, transition: "width .4s" }} />
        <div style={{ position: "absolute", left: `${pPag}%`, top: 0, bottom: 0, width: `${pCom}%`, background: C.amber, transition: "width .4s, left .4s" }} />
        {marcas.map((m) => (
          <div key={m} style={{ position: "absolute", left: `${m}%`, top: 0, bottom: 0, width: 1, background: "rgba(22,40,60,.18)" }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.inkSoft, marginTop: 2, fontFamily: mono }}>
        {marcas.map((m) => <span key={m}>{m}%</span>)}
      </div>
    </div>
  );
}

function Chip({ color, children }) {
  return (
    <span style={{ display: "inline-block", padding: "1px 8px", borderRadius: 3, fontSize: 11, fontWeight: 600, color: "#fff", background: color, letterSpacing: ".02em" }}>{children}</span>
  );
}

function PctBadge({ pct, comprometido }) {
  const color = pct >= 100 ? C.green : pct > 0 ? C.amber : comprometido ? C.amber : C.red;
  const label = pct >= 100 ? "Pagado" : pct > 0 ? "Parcial" : comprometido ? "Comprometido" : "Pendiente";
  return (
    <div style={{ textAlign: "right", minWidth: 86 }}>
      <div style={{ fontFamily: mono, fontWeight: 800, fontSize: 16, color }}>{pct.toFixed(0)}%</div>
      <div style={{ fontSize: 10, color: C.inkSoft, textTransform: "uppercase", letterSpacing: ".06em" }}>{label}</div>
      <div style={{ height: 4, background: "#E9ECE7", borderRadius: 2, marginTop: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: color }} />
      </div>
    </div>
  );
}

function Etiqueta({ children }) {
  return <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: C.inkSoft, fontWeight: 700, marginBottom: 4 }}>{children}</div>;
}

const inputStyle = {
  border: `1px solid ${C.line}`, borderRadius: 4, padding: "6px 8px",
  fontSize: 13, fontFamily: font, color: C.ink, background: "#fff", width: "100%",
  boxSizing: "border-box",
};
const btn = (bg = C.ink, small = false) => ({
  background: bg, color: "#fff", border: "none", borderRadius: 4,
  padding: small ? "4px 10px" : "8px 14px", fontSize: small ? 12 : 13,
  fontWeight: 600, cursor: "pointer", fontFamily: font,
});
const btnGhost = {
  background: "transparent", color: C.inkSoft, border: `1px solid ${C.line}`,
  borderRadius: 4, padding: "4px 8px", fontSize: 12, cursor: "pointer", fontFamily: font,
};

/* ── Números en formato argentino ───────────────────────── */
// "1.200" → 1200 · "150.000" → 150000 · "1.234,56" → 1234.56 · "1200" → 1200
function parseAR(s) {
  if (typeof s === "number") return s;
  if (!s) return 0;
  let t = String(s).trim().replace(/[\s$]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return isNaN(n) ? 0 : n;
}
const fmtEdit = (n) => (n || n === 0 ? fmt(n, n % 1 ? 2 : 0) : "");

function NumInput({ value, onValue, onEnter, style, ...rest }) {
  const [txt, setTxt] = useState(value ? fmtEdit(value) : "");
  const foco = useRef(false);
  useEffect(() => {
    if (!foco.current) setTxt(value ? fmtEdit(value) : "");
  }, [value]);
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      style={{ ...inputStyle, textAlign: "right", fontFamily: mono, ...style }}
      value={txt}
      onFocus={() => { foco.current = true; }}
      onChange={(e) => { setTxt(e.target.value); onValue(parseAR(e.target.value)); }}
      onBlur={(e) => { foco.current = false; const n = parseAR(e.target.value); setTxt(n ? fmtEdit(n) : ""); }}
      onKeyDown={(e) => e.key === "Enter" && onEnter && onEnter()}
    />
  );
}

/* ── Fila de ítem con pagos parciales ───────────────────── */
function FilaItem({ it, fx, onPatch, onBorrar }) {
  const [abierto, setAbierto] = useState(false);
  const [np, setNp] = useState({ fecha: hoy(), monto: "", tc: "" });
  const c = calcItem(it, fx);

  const agregarPago = () => {
    const m = Number(np.monto);
    if (!m) return;
    const pago = {
      id: nuevoId(),
      fecha: np.fecha || hoy(),
      monto: m,
      tc: it.moneda === "ARS" ? (Number(np.tc) || fx) : 1,
    };
    onPatch({ pagos: [...(it.pagos || []), pago] });
    setNp({ fecha: hoy(), monto: "", tc: "" });
  };
  const setPago = (id, patch) => onPatch({ pagos: it.pagos.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const borrarPago = (id) => onPatch({ pagos: it.pagos.filter((p) => p.id !== id) });

  return (
    <div style={{ borderBottom: `1px solid ${C.line}` }}>
      <div style={{ display: "grid", gridTemplateColumns: "26px 1fr 110px 64px 100px 30px", gap: 8, alignItems: "center", padding: "10px 0" }}>
        <button style={{ ...btnGhost, padding: "2px 6px", fontFamily: mono }} onClick={() => setAbierto(!abierto)} title={abierto ? "Cerrar pagos" : "Ver pagos"}>
          {abierto ? "▾" : "▸"}
        </button>
        <div>
          <input style={{ ...inputStyle, fontWeight: 600 }} value={it.concepto} onChange={(e) => onPatch({ concepto: e.target.value })} />
          <div style={{ fontSize: 11, color: C.inkSoft, marginTop: 3 }}>
            {it.pagos?.length || 0} pago{(it.pagos?.length || 0) === 1 ? "" : "s"} · {it.moneda === "ARS" ? "$" : "US$"} {fmt(c.pagadoNom)} de {it.moneda === "ARS" ? "$" : "US$"} {fmt(it.monto)}
            {" · "}dolarizado: <b>US$ {fmt(c.pagadoUSD, 2)}</b> pagados
            {c.restanteNom > 0 && <>
              {" · "}
              <label style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={!!it.comprometido} onChange={(e) => onPatch({ comprometido: e.target.checked })} style={{ verticalAlign: "middle" }} />
                {" "}restante comprometido
              </label>
            </>}
          </div>
        </div>
        <NumInput title="Costo total del ítem" value={it.monto} onValue={(n) => onPatch({ monto: n })} />
        <select style={inputStyle} value={it.moneda} onChange={(e) => onPatch({ moneda: e.target.value })}>
          <option>ARS</option><option>USD</option>
        </select>
        <PctBadge pct={c.pct} comprometido={it.comprometido} />
        <button style={btnGhost} title="Eliminar ítem" onClick={onBorrar}>✕</button>
      </div>

      {abierto && (
        <div style={{ margin: "0 0 12px 34px", padding: 12, background: C.subtle, borderRadius: 6 }}>
          <div style={{ display: "grid", gridTemplateColumns: "130px 110px 110px 120px 30px", gap: 8, fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", color: C.inkSoft, fontWeight: 700, marginBottom: 4 }}>
            <span>Fecha</span><span style={{ textAlign: "right" }}>Monto ({it.moneda})</span>
            <span style={{ textAlign: "right" }}>{it.moneda === "ARS" ? "Dólar a esa fecha" : "—"}</span>
            <span style={{ textAlign: "right" }}>Equiv. USD</span><span />
          </div>

          {(it.pagos || []).length === 0 && (
            <div style={{ fontSize: 12, color: C.inkSoft, padding: "6px 0" }}>Sin pagos registrados todavía.</div>
          )}

          {(it.pagos || []).map((p) => {
            const usd = it.moneda === "USD" ? Number(p.monto) || 0 : (Number(p.monto) || 0) / (Number(p.tc) || fx);
            return (
              <div key={p.id} style={{ display: "grid", gridTemplateColumns: "130px 110px 110px 120px 30px", gap: 8, alignItems: "center", padding: "3px 0" }}>
                <input style={inputStyle} type="date" value={p.fecha} onChange={(e) => setPago(p.id, { fecha: e.target.value })} />
                <NumInput value={p.monto} onValue={(n) => setPago(p.id, { monto: n })} />
                {it.moneda === "ARS" ? (
                  <NumInput title="Valor del dólar a la fecha del pago" value={p.tc} onValue={(n) => setPago(p.id, { tc: n })} />
                ) : <span />}
                <div style={{ textAlign: "right", fontFamily: mono, fontWeight: 700, fontSize: 13, color: C.ink }}>US$ {fmt(usd, 2)}</div>
                <button style={btnGhost} onClick={() => borrarPago(p.id)}>✕</button>
              </div>
            );
          })}

          <div style={{ display: "grid", gridTemplateColumns: "130px 110px 110px 120px 30px", gap: 8, alignItems: "center", marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.line}` }}>
            <input style={inputStyle} type="date" value={np.fecha} onChange={(e) => setNp({ ...np, fecha: e.target.value })} />
            <NumInput placeholder="Monto" value={np.monto} onValue={(n) => setNp({ ...np, monto: n })} onEnter={agregarPago} />
            {it.moneda === "ARS" ? (
              <NumInput placeholder={`Dólar (${fmt(fx)})`} value={np.tc} onValue={(n) => setNp({ ...np, tc: n })} onEnter={agregarPago} />
            ) : <span />}
            <button style={btn(C.blue, true)} onClick={agregarPago}>+ Registrar pago</button>
            <span />
          </div>
          {c.restanteNom > 0 && (
            <div style={{ fontSize: 12, color: C.inkSoft, marginTop: 8 }}>
              Restan {it.moneda === "ARS" ? "$" : "US$"} {fmt(c.restanteNom)} (≈ US$ {fmt(c.restanteUSD, 2)} al dólar de referencia actual).
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Módulo de costos (sucesión / escritura / aportes) ──── */
function ItemsModulo({ titulo, subtitulo, items, onChange, fx, verbo = "gasto" }) {
  const [nuevo, setNuevo] = useState({ concepto: "", monto: "", moneda: "ARS" });
  const t = totales(items, fx);
  const pctPagado = t.total > 0 ? (t.pagado / t.total) * 100 : 0;
  const pctCubierto = t.total > 0 ? ((t.pagado + t.comprometido) / t.total) * 100 : 0;

  const agregar = () => {
    if (!nuevo.concepto.trim() || !Number(nuevo.monto)) return;
    onChange([...items, { id: nuevoId(), concepto: nuevo.concepto.trim(), monto: Number(nuevo.monto), moneda: nuevo.moneda, comprometido: false, pagos: [] }]);
    setNuevo({ concepto: "", monto: "", moneda: nuevo.moneda });
  };
  const patch = (id, p) => onChange(items.map((i) => (i.id === id ? { ...i, ...p } : i)));

  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.ink, letterSpacing: "-.01em" }}>{titulo}</h2>
          {subtitulo && <div style={{ fontSize: 12, color: C.inkSoft }}>{subtitulo}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: C.ink, fontFamily: mono }}>
            {pctPagado.toFixed(0)}<span style={{ fontSize: 14 }}>%</span>
          </div>
          <div style={{ fontSize: 11, color: C.inkSoft }}>pagado · {pctCubierto.toFixed(0)}% cubierto con compromisos</div>
        </div>
      </div>

      <div style={{ margin: "14px 0 18px" }}>
        <Regla pagado={t.pagado} comprometido={t.comprometido} total={t.total} />
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16, fontSize: 12, color: C.inkSoft }}>
        <span><Chip color={C.green}>Pagado</Chip> US$ {fmt(t.pagado, 2)}</span>
        <span><Chip color={C.amber}>Comprometido</Chip> US$ {fmt(t.comprometido, 2)}</span>
        <span><Chip color={C.red}>Pendiente</Chip> US$ {fmt(t.pendiente, 2)}</span>
        <span style={{ fontWeight: 700, color: C.ink }}>Total dolarizado: US$ {fmt(t.total, 2)}</span>
      </div>

      {items.length === 0 && (
        <div style={{ padding: 16, border: `1px dashed ${C.line}`, borderRadius: 6, color: C.inkSoft, fontSize: 13, marginBottom: 12 }}>
          Todavía no hay ítems. Cargá el primer {verbo} abajo; después abrilo con ▸ para ir registrando cada pago.
        </div>
      )}

      {items.map((it) => (
        <FilaItem key={it.id} it={it} fx={fx} onPatch={(p) => patch(it.id, p)} onBorrar={() => onChange(items.filter((x) => x.id !== it.id))} />
      ))}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 70px 110px", gap: 8, marginTop: 14, alignItems: "center" }}>
        <input style={inputStyle} placeholder={`Nuevo ${verbo} (ej.: tasa de justicia)`} value={nuevo.concepto} onChange={(e) => setNuevo({ ...nuevo, concepto: e.target.value })} onKeyDown={(e) => e.key === "Enter" && agregar()} />
        <NumInput placeholder="Costo total" value={nuevo.monto} onValue={(n) => setNuevo({ ...nuevo, monto: n })} onEnter={agregar} />
        <select style={inputStyle} value={nuevo.moneda} onChange={(e) => setNuevo({ ...nuevo, moneda: e.target.value })}>
          <option>ARS</option><option>USD</option>
        </select>
        <button style={btn()} onClick={agregar}>Agregar ítem</button>
      </div>
    </div>
  );
}

/* ── Pago de la casa ────────────────────────────────────── */
function mesesHasta(fechaISO) {
  if (!fechaISO) return 0;
  const h = new Date();
  const f = new Date(fechaISO + "T00:00:00");
  return Math.max(0, (f.getFullYear() - h.getFullYear()) * 12 + (f.getMonth() - h.getMonth()));
}

/* ── Dinero ahorrado (cuentas en USD) ───────────────────── */
function CuentasAhorro({ cuentas, onChange }) {
  const [nueva, setNueva] = useState({ nombre: "", monto: "" });
  const total = cuentas.reduce((s, c) => s + (Number(c.monto) || 0), 0);

  const agregar = () => {
    if (!nueva.nombre.trim()) return;
    onChange([...cuentas, { id: nuevoId(), nombre: nueva.nombre.trim(), monto: Number(nueva.monto) || 0 }]);
    setNueva({ nombre: "", monto: "" });
  };
  const patch = (id, p) => onChange(cuentas.map((c) => (c.id === id ? { ...c, ...p } : c)));

  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.ink }}>Dinero ahorrado</h2>
          <div style={{ fontSize: 12, color: C.inkSoft }}>Tus cuentas y cuántos dólares tenés en cada una</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: C.green, fontFamily: mono }}>US$ {fmt(total, 2)}</div>
          <div style={{ fontSize: 11, color: C.inkSoft }}>total ahorrado</div>
        </div>
      </div>

      {cuentas.length === 0 && (
        <div style={{ padding: 16, border: `1px dashed ${C.line}`, borderRadius: 6, color: C.inkSoft, fontSize: 13, margin: "14px 0 0" }}>
          Sin cuentas cargadas. Agregá la primera abajo (ej.: caja de ahorro USD, efectivo, broker).
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        {cuentas.map((c) => {
          const pctCuenta = total > 0 ? ((Number(c.monto) || 0) / total) * 100 : 0;
          return (
            <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1fr 140px 120px 30px", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
              <input style={{ ...inputStyle, fontWeight: 600 }} value={c.nombre} onChange={(e) => patch(c.id, { nombre: e.target.value })} />
              <NumInput title="Dólares en esta cuenta" value={c.monto} onValue={(n) => patch(c.id, { monto: n })} />
              <div style={{ fontSize: 12, color: C.inkSoft }}>
                <div style={{ height: 5, background: "#E9ECE7", borderRadius: 2, overflow: "hidden", marginBottom: 2 }}>
                  <div style={{ height: "100%", width: `${pctCuenta}%`, background: C.green }} />
                </div>
                {pctCuenta.toFixed(0)}% del total
              </div>
              <button style={btnGhost} title="Eliminar cuenta" onClick={() => onChange(cuentas.filter((x) => x.id !== c.id))}>✕</button>
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 150px", gap: 8, marginTop: 14, alignItems: "center" }}>
        <input style={inputStyle} placeholder="Nueva cuenta (ej.: Banco Nación USD)" value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} onKeyDown={(e) => e.key === "Enter" && agregar()} />
        <NumInput placeholder="Dólares" value={nueva.monto} onValue={(n) => setNueva({ ...nueva, monto: n })} onEnter={agregar} />
        <button style={btn()} onClick={agregar}>Agregar cuenta</button>
      </div>
    </div>
  );
}

function PagoCasa({ casa, onChange, fx, sucesionTotalUSD = 0 }) {
  const cuentas = casa.cuentas || [];
  const ahorrado = cuentas.reduce((s, c) => s + (Number(c.monto) || 0), 0);
  const precioUSD = casa.moneda === "USD" ? Number(casa.precio) || 0 : (Number(casa.precio) || 0) / (fx || 1);
  const pctDed = Number(casa.pctDeduccion ?? 50);
  const deduccion = sucesionTotalUSD * (pctDed / 100);
  const aPagar = Math.max(0, precioUSD - deduccion);
  const faltante = Math.max(0, aPagar - ahorrado);
  const pctAhorro = aPagar > 0 ? (ahorrado / aPagar) * 100 : 0;
  const meses = mesesHasta(casa.fechaPrevista);
  const [plan, setPlan] = useState({ nombre: "", fechaFin: "", cuotas: "" });

  const guardarPlan = () => {
    const nCuotas = Number(plan.cuotas) || mesesHasta(plan.fechaFin || casa.fechaPrevista);
    if (!nCuotas || faltante <= 0) return;
    onChange({
      ...casa,
      planes: [...casa.planes, {
        id: nuevoId(),
        nombre: plan.nombre.trim() || `Plan ${casa.planes.length + 1}`,
        cuotas: nCuotas,
        montoCuota: faltante / nCuotas,
        base: faltante,
        fechaFin: plan.fechaFin || casa.fechaPrevista,
        creado: hoy(),
      }],
    });
    setPlan({ nombre: "", fechaFin: "", cuotas: "" });
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: 20 }}>
        <h2 style={{ margin: "0 0 14px", fontSize: 20, fontWeight: 800, color: C.ink }}>La casa</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 1fr", gap: 12, maxWidth: 520 }}>
          <div>
            <Etiqueta>Precio acordado</Etiqueta>
            <NumInput value={casa.precio} onValue={(n) => onChange({ ...casa, precio: n })} />
          </div>
          <div>
            <Etiqueta>Moneda</Etiqueta>
            <select style={inputStyle} value={casa.moneda} onChange={(e) => onChange({ ...casa, moneda: e.target.value })}>
              <option>USD</option><option>ARS</option>
            </select>
          </div>
          <div>
            <Etiqueta>Fecha prevista de pago</Etiqueta>
            <input style={inputStyle} type="date" value={casa.fechaPrevista} onChange={(e) => onChange({ ...casa, fechaPrevista: e.target.value })} />
          </div>
        </div>

        <div style={{ marginTop: 16, padding: 12, background: C.subtle, borderRadius: 6, maxWidth: 520 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.ink, flexWrap: "wrap" }}>
            <span>Se deduce el</span>
            <input
              style={{ ...inputStyle, width: 58, fontFamily: mono, textAlign: "right" }}
              type="number"
              value={casa.pctDeduccion ?? 50}
              onChange={(e) => onChange({ ...casa, pctDeduccion: Number(e.target.value) })}
              title="Porcentaje de los costos de sucesión que se descuenta del valor a pagar de la casa"
            />
            <span>% de los costos de sucesión (US$ {fmt(sucesionTotalUSD, 2)})</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "2px 16px", marginTop: 10, fontFamily: mono, fontSize: 13, color: C.ink, justifyContent: "start" }}>
            <span style={{ fontFamily: font, color: C.inkSoft }}>Precio acordado</span>
            <span style={{ textAlign: "right" }}>US$ {fmt(precioUSD, 2)}</span>
            <span style={{ fontFamily: font, color: C.inkSoft }}>− Deducción por sucesión ({pctDed}%)</span>
            <span style={{ textAlign: "right", color: C.green }}>− US$ {fmt(deduccion, 2)}</span>
            <span style={{ fontFamily: font, fontWeight: 800, color: C.ink, borderTop: `1px solid ${C.line}`, paddingTop: 4 }}>Valor final a pagar</span>
            <span style={{ textAlign: "right", fontWeight: 800, borderTop: `1px solid ${C.line}`, paddingTop: 4 }}>US$ {fmt(aPagar, 2)}</span>
          </div>
        </div>

        <div style={{ margin: "18px 0 6px" }}>
          <Regla pagado={ahorrado} comprometido={0} total={aPagar} height={18} />
        </div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13, color: C.inkSoft, marginTop: 8 }}>
          <span><Chip color={C.green}>Ahorrado</Chip> US$ {fmt(ahorrado, 2)} ({pctAhorro.toFixed(0)}% del valor a pagar)</span>
          <span style={{ fontWeight: 800, color: faltante > 0 ? C.red : C.green }}>
            {faltante > 0 ? `Falta reunir: US$ ${fmt(faltante)}` : "✔ Ya tenés el total del valor a pagar"}
          </span>
          {casa.fechaPrevista && <span>({meses} {meses === 1 ? "mes" : "meses"} hasta la fecha prevista)</span>}
        </div>
      </div>

      <CuentasAhorro cuentas={cuentas} onChange={(cs) => onChange({ ...casa, cuentas: cs })} />

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.ink }}>Planes de pago</h2>
        <div style={{ fontSize: 13, color: C.inkSoft, margin: "4px 0 14px" }}>
          Si no llegás al total en la fecha prevista, armá escenarios: entre lo ahorrado y el valor a pagar hoy faltan <b style={{ color: C.ink }}>US$ {fmt(faltante)}</b>.
        </div>

        {faltante > 0 && meses > 0 && (
          <div style={{ padding: 12, background: C.subtle, borderRadius: 6, fontSize: 13, color: C.ink, marginBottom: 14 }}>
            Para llegar a la fecha prevista necesitás ahorrar <b>US$ {fmt(faltante / meses)}/mes</b> durante {meses} meses.
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 150px 110px 130px", gap: 8, alignItems: "end", marginBottom: 14 }}>
          <div>
            <Etiqueta>Nombre del plan</Etiqueta>
            <input style={inputStyle} placeholder="Ej.: estirar 6 meses" value={plan.nombre} onChange={(e) => setPlan({ ...plan, nombre: e.target.value })} />
          </div>
          <div>
            <Etiqueta>Nueva fecha límite</Etiqueta>
            <input style={inputStyle} type="date" value={plan.fechaFin} onChange={(e) => setPlan({ ...plan, fechaFin: e.target.value, cuotas: "" })} />
          </div>
          <div>
            <Etiqueta>o cant. de cuotas</Etiqueta>
            <input style={{ ...inputStyle, fontFamily: mono }} type="number" placeholder="12" value={plan.cuotas} onChange={(e) => setPlan({ ...plan, cuotas: e.target.value })} />
          </div>
          <button style={btn(C.blue)} onClick={guardarPlan}>Simular y guardar</button>
        </div>

        {casa.planes.length === 0 && (
          <div style={{ padding: 14, border: `1px dashed ${C.line}`, borderRadius: 6, color: C.inkSoft, fontSize: 13 }}>
            Sin planes guardados. Elegí una fecha o una cantidad de cuotas y guardá el escenario para compararlo.
          </div>
        )}

        {casa.planes.map((p) => (
          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 12px", border: `1px solid ${C.line}`, borderRadius: 6, marginBottom: 8, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 700, color: C.ink, fontSize: 14 }}>{p.nombre}</div>
              <div style={{ fontSize: 12, color: C.inkSoft }}>
                Base US$ {fmt(p.base)} · {p.cuotas} cuotas {p.fechaFin ? `· vence ${p.fechaFin}` : ""} · creado {p.creado}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ fontFamily: mono, fontWeight: 800, fontSize: 18, color: C.blue }}>US$ {fmt(p.montoCuota)}/mes</div>
              <button style={btnGhost} onClick={() => onChange({ ...casa, planes: casa.planes.filter((x) => x.id !== p.id) })}>✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Reformas ───────────────────────────────────────────── */
function Reformas({ items, onChange, fx }) {
  const [nuevo, setNuevo] = useState({ nombre: "", costo: "", moneda: "ARS", prioridad: "media" });
  const orden = { alta: 0, media: 1, baja: 2 };
  const lista = [...items].sort((a, b) => (orden[a.prioridad] - orden[b.prioridad]) || (a.pos - b.pos));

  const agregar = () => {
    if (!nuevo.nombre.trim()) return;
    onChange([...items, { ...nuevo, costo: Number(nuevo.costo) || 0, id: nuevoId(), hecha: false, pos: items.length }]);
    setNuevo({ nombre: "", costo: "", moneda: nuevo.moneda, prioridad: "media" });
  };
  const setItem = (id, patch) => onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const mover = (id, dir) => {
    const idx = lista.findIndex((i) => i.id === id);
    const j = idx + dir;
    if (j < 0 || j >= lista.length || lista[j].prioridad !== lista[idx].prioridad) return;
    const a = lista[idx], b = lista[j];
    onChange(items.map((i) => (i.id === a.id ? { ...i, pos: b.pos } : i.id === b.id ? { ...i, pos: a.pos } : i)));
  };

  const totalPendiente = lista.filter((i) => !i.hecha).reduce((s, i) => s + (i.moneda === "USD" ? i.costo : i.costo / (fx || 1)), 0);

  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.ink }}>Reformas</h2>
        <div style={{ fontSize: 13, color: C.inkSoft }}>Estimado pendiente: <b style={{ color: C.ink }}>US$ {fmt(totalPendiente)}</b></div>
      </div>
      <div style={{ fontSize: 12, color: C.inkSoft, margin: "4px 0 16px" }}>Ordenadas por prioridad; usá ↑↓ para acomodarlas dentro de cada grupo.</div>

      {lista.length === 0 && (
        <div style={{ padding: 16, border: `1px dashed ${C.line}`, borderRadius: 6, color: C.inkSoft, fontSize: 13, marginBottom: 12 }}>
          Sin reformas cargadas. Anotá la primera abajo, aunque sea una idea.
        </div>
      )}

      {lista.map((it) => {
        const pr = PRIORIDADES.find((p) => p.id === it.prioridad);
        return (
          <div key={it.id} style={{ display: "grid", gridTemplateColumns: "24px 1fr 110px 70px 100px 60px 30px", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.line}`, opacity: it.hecha ? 0.5 : 1 }}>
            <input type="checkbox" checked={it.hecha} onChange={(e) => setItem(it.id, { hecha: e.target.checked })} title="Hecha" />
            <input style={{ ...inputStyle, textDecoration: it.hecha ? "line-through" : "none" }} value={it.nombre} onChange={(e) => setItem(it.id, { nombre: e.target.value })} />
            <NumInput value={it.costo} onValue={(n) => setItem(it.id, { costo: n })} />
            <select style={inputStyle} value={it.moneda} onChange={(e) => setItem(it.id, { moneda: e.target.value })}>
              <option>ARS</option><option>USD</option>
            </select>
            <select style={{ ...inputStyle, color: pr?.color, fontWeight: 700 }} value={it.prioridad} onChange={(e) => setItem(it.id, { prioridad: e.target.value })}>
              {PRIORIDADES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <div style={{ display: "flex", gap: 4 }}>
              <button style={btnGhost} onClick={() => mover(it.id, -1)} title="Subir">↑</button>
              <button style={btnGhost} onClick={() => mover(it.id, 1)} title="Bajar">↓</button>
            </div>
            <button style={btnGhost} onClick={() => onChange(items.filter((x) => x.id !== it.id))}>✕</button>
          </div>
        );
      })}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 70px 100px 90px", gap: 8, marginTop: 14 }}>
        <input style={inputStyle} placeholder="Nueva reforma (ej.: cambiar caldera)" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} onKeyDown={(e) => e.key === "Enter" && agregar()} />
        <NumInput placeholder="Costo est." value={nuevo.costo} onValue={(n) => setNuevo({ ...nuevo, costo: n })} onEnter={agregar} />
        <select style={inputStyle} value={nuevo.moneda} onChange={(e) => setNuevo({ ...nuevo, moneda: e.target.value })}>
          <option>ARS</option><option>USD</option>
        </select>
        <select style={inputStyle} value={nuevo.prioridad} onChange={(e) => setNuevo({ ...nuevo, prioridad: e.target.value })}>
          {PRIORIDADES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <button style={btn()} onClick={agregar}>Agregar</button>
      </div>
    </div>
  );
}

/* ── Resumen ────────────────────────────────────────────── */
function Resumen({ data }) {
  const { fx } = data;
  const tS = totales(data.sucesion, fx);
  const tE = totales(data.escritura, fx);
  const ahorrado = (data.casa.cuentas || []).reduce((s, c) => s + (Number(c.monto) || 0), 0);
  const precioUSD = data.casa.moneda === "USD" ? Number(data.casa.precio) || 0 : (Number(data.casa.precio) || 0) / (fx || 1);
  const deduccion = tS.total * ((Number(data.casa.pctDeduccion ?? 50)) / 100);
  const aPagar = Math.max(0, precioUSD - deduccion);
  const bloques = [
    { titulo: "Sucesión", t: tS, base: tS.total },
    { titulo: "Escritura", t: tE, base: tE.total },
    { titulo: "Casa (con deducción)", t: { pagado: ahorrado, comprometido: 0 }, base: aPagar },
  ];
  const totalObjetivo = tS.total + tE.total + aPagar;
  const totalPagado = tS.pagado + tE.pagado + ahorrado;
  const totalComprometido = tS.comprometido + tE.comprometido;
  const pctGlobal = totalObjetivo > 0 ? (totalPagado / totalObjetivo) * 100 : 0;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ background: C.ink, borderRadius: 8, padding: "24px 22px", color: "#fff" }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".12em", opacity: 0.7, fontWeight: 700 }}>Avance global del proyecto</div>
        <div style={{ fontSize: 44, fontWeight: 800, fontFamily: mono, lineHeight: 1.1, margin: "6px 0 12px" }}>
          {pctGlobal.toFixed(1)}%
        </div>
        <Regla pagado={totalPagado} comprometido={totalComprometido} total={totalObjetivo} height={16} />
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13, marginTop: 10, opacity: 0.9 }}>
          <span>Pagado: US$ {fmt(totalPagado)}</span>
          <span>Comprometido: US$ {fmt(totalComprometido)}</span>
          <span>Objetivo total: US$ {fmt(totalObjetivo)}</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {bloques.map((b) => {
          const pct = b.base > 0 ? (b.t.pagado / b.base) * 100 : 0;
          return (
            <div key={b.titulo} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontWeight: 800, color: C.ink, fontSize: 15 }}>{b.titulo}</div>
                <div style={{ fontFamily: mono, fontWeight: 800, fontSize: 20, color: C.ink }}>{pct.toFixed(0)}%</div>
              </div>
              <div style={{ margin: "10px 0" }}>
                <Regla pagado={b.t.pagado} comprometido={b.t.comprometido} total={b.base} height={10} />
              </div>
              <div style={{ fontSize: 12, color: C.inkSoft }}>
                US$ {fmt(b.t.pagado)} de US$ {fmt(b.base)}
                {b.t.comprometido > 0 && <> · +US$ {fmt(b.t.comprometido)} comprometidos</>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── App ────────────────────────────────────────────────── */
function normalizar(d) {
  const fx = fixTC(Number(d.fx) || inicial.fx);
  const casaGuardada = d.casa || {};
  const cuentas = casaGuardada.cuentas
    || (casaGuardada.aportes || []).map((a) => {
      const it = migrarItem(a, fx);
      const c = calcItem(it, fx);
      return { id: nuevoId(), nombre: it.concepto || "Cuenta", monto: Math.round(c.pagadoUSD * 100) / 100 };
    }).filter((c) => c.monto > 0);
  return {
    ...inicial,
    ...d,
    fx,
    sucesion: migrarLista(d.sucesion, fx),
    escritura: migrarLista(d.escritura, fx),
    casa: { ...inicial.casa, ...casaGuardada, cuentas, aportes: undefined },
  };
}

export default function PortalCasa() {
  const [data, setData] = useState(inicial);
  const [tab, setTab] = useState("resumen");
  const [estado, setEstado] = useState("cargando"); // cargando | listo | guardando | error
  const [user, setUser] = useState(null);
  const [authListo, setAuthListo] = useState(false);
  const timer = useRef(null);
  const cargado = useRef(false);

  // sesión
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthListo(true);
      if (!u) { cargado.current = false; setData(inicial); }
    });
  }, []);

  // carga desde Firestore cuando hay usuario
  useEffect(() => {
    if (!user) return;
    setEstado("cargando");
    cargado.current = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "usuarios", user.uid));
        if (snap.exists()) setData(normalizar(snap.data()));
        else setData(inicial);
      } catch (e) { console.error(e); }
      cargado.current = true;
      setEstado("listo");
    })();
  }, [user]);

  // guardado con debounce
  useEffect(() => {
    if (!cargado.current || !user) return;
    setEstado("guardando");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await setDoc(doc(db, "usuarios", user.uid), data);
        setEstado("listo");
      } catch (e) { console.error(e); setEstado("error"); }
    }, 700);
    return () => clearTimeout(timer.current);
  }, [data, user]);

  const login = async () => { try { await signInWithPopup(auth, googleProvider); } catch (e) { console.error(e); } };
  const logout = () => signOut(auth);

  const tabs = [
    { id: "resumen", label: "Resumen" },
    { id: "sucesion", label: "Sucesión" },
    { id: "escritura", label: "Escritura" },
    { id: "casa", label: "Pago de la casa" },
    { id: "reformas", label: "Reformas" },
  ];

  if (!authListo) {
    return <div style={{ fontFamily: font, color: C.inkSoft, padding: 40, background: C.paper, minHeight: "100vh" }}>Cargando…</div>;
  }

  if (!user) {
    return (
      <div style={{ fontFamily: font, background: C.paper, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800&display=swap');`}</style>
        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: "36px 32px", maxWidth: 380, textAlign: "center", boxShadow: "0 4px 24px rgba(22,40,60,.06)" }}>
          <div style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: C.inkSoft, fontWeight: 700 }}>Expediente · Mi casa</div>
          <h1 style={{ margin: "4px 0 6px", fontSize: 26, fontWeight: 800, color: C.ink }}>Portal de compra</h1>
          <p style={{ fontSize: 13, color: C.inkSoft, margin: "0 0 22px" }}>Ingresá con tu cuenta de Google para ver y editar tus datos.</p>
          <button style={{ ...btn(C.ink), width: "100%", padding: "11px 14px", fontSize: 14 }} onClick={login}>
            Entrar con Google
          </button>
        </div>
      </div>
    );
  }

  if (estado === "cargando") {
    return <div style={{ fontFamily: font, color: C.inkSoft, padding: 40, background: C.paper, minHeight: "100vh" }}>Cargando tus datos…</div>;
  }

  return (
    <div style={{ fontFamily: font, background: C.paper, minHeight: "100vh" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800&display=swap');
        input:focus, select:focus, button:focus-visible { outline: 2px solid ${C.blue}; outline-offset: 1px; }`}</style>

      <header style={{ borderBottom: `2px solid ${C.ink}`, background: C.paper, padding: "18px 20px 0" }}>
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: C.inkSoft, fontWeight: 700 }}>Expediente · Mi casa</div>
              <h1 style={{ margin: "2px 0 0", fontSize: 28, fontWeight: 800, color: C.ink, letterSpacing: "-.02em" }}>Portal de compra</h1>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, paddingBottom: 6 }}>
              <label style={{ fontSize: 12, color: C.inkSoft, display: "flex", alignItems: "center", gap: 6 }}>
                Dólar hoy
                <NumInput
                  style={{ width: 90 }}
                  value={data.fx}
                  onValue={(n) => setData({ ...data, fx: n || 1 })}
                  title="Dólar de referencia actual: se usa para dolarizar lo pendiente y como valor sugerido al cargar pagos"
                />
              </label>
              <span style={{ fontSize: 12, color: estado === "error" ? C.red : C.inkSoft }}>
                {estado === "guardando" ? "Guardando…" : estado === "error" ? "No se pudo guardar" : "Guardado ✓"}
              </span>
              <button style={btnGhost} onClick={logout} title={user?.email}>Salir</button>
            </div>
          </div>
          <nav style={{ display: "flex", gap: 4, marginTop: 12, overflowX: "auto" }}>
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  border: "none", cursor: "pointer", fontFamily: font, fontWeight: 700, fontSize: 13,
                  padding: "10px 14px", borderRadius: "6px 6px 0 0", whiteSpace: "nowrap",
                  background: tab === t.id ? C.ink : "transparent",
                  color: tab === t.id ? "#fff" : C.inkSoft,
                }}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main style={{ maxWidth: 980, margin: "0 auto", padding: "20px 16px 60px" }}>
        {tab === "resumen" && <Resumen data={data} />}
        {tab === "sucesion" && (
          <ItemsModulo
            titulo="Costos de sucesión"
            subtitulo="Honorarios, tasas, edictos, oficios: todo itemizado, con sus pagos parciales"
            items={data.sucesion}
            onChange={(sucesion) => setData({ ...data, sucesion })}
            fx={data.fx}
          />
        )}
        {tab === "escritura" && (
          <ItemsModulo
            titulo="Gastos de escritura"
            subtitulo="Escribano, sellos, certificados, inscripción"
            items={data.escritura}
            onChange={(escritura) => setData({ ...data, escritura })}
            fx={data.fx}
          />
        )}
        {tab === "casa" && <PagoCasa casa={data.casa} onChange={(casa) => setData({ ...data, casa })} fx={data.fx} sucesionTotalUSD={totales(data.sucesion, data.fx).total} />}
        {tab === "reformas" && <Reformas items={data.reformas} onChange={(reformas) => setData({ ...data, reformas })} fx={data.fx} />}
      </main>
    </div>
  );
}
