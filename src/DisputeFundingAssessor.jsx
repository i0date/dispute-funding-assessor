import { useState, useMemo, useRef } from "react"
import { Upload, Download, ChevronDown, ChevronUp, AlertTriangle, CheckCircle, XCircle } from "lucide-react"

// ─── Reason code base win rates (issuer perspective) ─────────────────────────
const BASE_WIN_RATES = {
  "10.1": 0.85, "10.2": 0.48, "10.4": 0.76, "10.5": 0.93,
  "13.1": 0.41, "13.3": 0.30, "13.5": 0.57, "13.6": 0.68, "13.7": 0.44,
  "4837": 0.78, "4840": 0.72, "4849": 0.65, "4863": 0.73,
  "4870": 0.87, "4871": 0.81,
  "4841": 0.48, "4853": 0.33, "4855": 0.44, "4859": 0.46,
  "4860": 0.70, "4854": 0.38,
}

const CODE_LABELS = {
  "10.1": "EMV liability shift",         "10.2": "No cardholder auth (CP)",
  "10.4": "CNP fraud — other",           "10.5": "Visa fraud monitoring program",
  "13.1": "Merchandise not received",    "13.3": "Not as described",
  "13.5": "Misrepresentation",           "13.6": "Credit not processed",
  "13.7": "Cancelled merchandise/services",
  "4837": "No cardholder authorization", "4840": "Fraudulent processing",
  "4849": "Questionable merchant activity","4853": "Defective / not as described",
  "4854": "Cardholder dispute — NEC",    "4855": "Goods or services not provided",
  "4859": "Services not rendered",       "4860": "Credit not processed",
  "4863": "Cardholder does not recognize","4870": "Chip liability shift",
  "4871": "Chip/PIN liability shift",    "4841": "Cancelled recurring transaction",
}

// ─── Sample portfolio ─────────────────────────────────────────────────────────
const CLAIMS_DATA = [
  {
    id: "DSP-001", code: "10.4", amount: 850, filedDaysAgo: 10, windowDays: 120,
    avsMismatch: true, no3DS: true, deliveryConf: false, merchantAck: false,
    pinVerified: false, isVFMP: false, strongDocs: false, merchantCBR: 1.2, priorClaims: 0,
    source: "sample",
    note: "No 3DS, AVS mismatch on shipping address. Clean account history. Strong CNP fraud pattern — issuer holds the stronger hand.",
  },
  {
    id: "DSP-002", code: "13.1", amount: 320, filedDaysAgo: 25, windowDays: 120,
    avsMismatch: false, no3DS: false, deliveryConf: true, merchantAck: false,
    pinVerified: false, isVFMP: false, strongDocs: false, merchantCBR: 0.4, priorClaims: 1,
    source: "sample",
    note: "Delivery confirmation on file. Low-CBR merchant will representment aggressively. One prior dispute on account reduces confidence.",
  },
  {
    id: "DSP-003", code: "10.5", amount: 2200, filedDaysAgo: 5, windowDays: 120,
    avsMismatch: true, no3DS: true, deliveryConf: false, merchantAck: false,
    pinVerified: false, isVFMP: true, strongDocs: false, merchantCBR: 2.8, priorClaims: 0,
    source: "sample",
    note: "VFMP-enrolled merchant — near-automatic liability shift. High merchant CBR confirms systemic fraud pattern. Strongest receivable in portfolio.",
  },
  {
    id: "DSP-004", code: "13.3", amount: 180, filedDaysAgo: 40, windowDays: 120,
    avsMismatch: false, no3DS: false, deliveryConf: false, merchantAck: false,
    pinVerified: false, isVFMP: false, strongDocs: false, merchantCBR: 0.6, priorClaims: 2,
    source: "sample",
    note: "Subjective quality dispute with no supporting documentation. Two prior claims on account is a significant red flag.",
  },
  {
    id: "DSP-005", code: "10.2", amount: 650, filedDaysAgo: 15, windowDays: 120,
    avsMismatch: false, no3DS: false, deliveryConf: false, merchantAck: false,
    pinVerified: true, isVFMP: false, strongDocs: false, merchantCBR: 0.8, priorClaims: 0,
    source: "sample",
    note: "Chip + PIN transaction. PIN verification shifts liability back to the issuer — near-automatic loss at representment.",
  },
  {
    id: "DSP-006", code: "13.6", amount: 420, filedDaysAgo: 20, windowDays: 120,
    avsMismatch: false, no3DS: false, deliveryConf: false, merchantAck: true,
    pinVerified: false, isVFMP: false, strongDocs: true, merchantCBR: 0.5, priorClaims: 0,
    source: "sample",
    note: "Merchant acknowledged credit owed in writing. Strong paper trail. Near-certain win — merchant acknowledgement rarely survives representment.",
  },
  {
    id: "DSP-007", code: "10.4", amount: 95, filedDaysAgo: 50, windowDays: 120,
    avsMismatch: false, no3DS: false, deliveryConf: false, merchantAck: false,
    pinVerified: false, isVFMP: false, strongDocs: false, merchantCBR: 0.9, priorClaims: 1,
    source: "sample",
    note: "Small amount at 70-day mark. Limited fraud evidence and one prior claim lower confidence. Marginal — funder overhead may exceed expected return.",
  },
  {
    id: "DSP-008", code: "13.5", amount: 1100, filedDaysAgo: 8, windowDays: 120,
    avsMismatch: false, no3DS: false, deliveryConf: false, merchantAck: false,
    pinVerified: false, isVFMP: false, strongDocs: true, merchantCBR: 0.7, priorClaims: 0,
    source: "sample",
    note: "Strong documentary evidence — screenshots of merchant listing vs. item received. Early in window, clean account history.",
  },
]

// ─── Scoring model ────────────────────────────────────────────────────────────
function computeRecoveryProb(c) {
  let p = BASE_WIN_RATES[c.code] ?? 0.50
  if (c.avsMismatch && c.code.startsWith("10")) p += 0.07
  if (c.no3DS && c.code.startsWith("10")) p += 0.05
  if (c.deliveryConf)  p -= 0.22
  if (c.merchantAck)   p += 0.18
  if (c.pinVerified)   p -= 0.28
  if (c.strongDocs)    p += 0.12
  if (c.isVFMP) p = Math.min(p + 0.15, 0.96)
  p -= c.priorClaims * 0.07
  if (c.merchantCBR > 1.0) p += 0.03
  return parseFloat(Math.max(0.05, Math.min(0.96, p)).toFixed(2))
}

function computeTimeScore(c) {
  const remaining = c.windowDays - c.filedDaysAgo
  if (remaining > 90) return 1.00
  if (remaining > 60) return 0.90
  if (remaining > 30) return 0.78
  if (remaining > 15) return 0.60
  return 0.35
}

function computeAmountScore(amount) {
  if (amount < 50)    return 0.15
  if (amount < 100)   return 0.40
  if (amount < 200)   return 0.65
  if (amount <= 2000) return 1.00
  if (amount <= 5000) return 0.85
  return 0.70
}

function scoreClaim(c) {
  const recoveryProb     = computeRecoveryProb(c)
  const timeScore        = computeTimeScore(c)
  const amountScore      = computeAmountScore(c.amount)
  const fundability      = Math.round((recoveryProb * 0.55 + timeScore * 0.25 + amountScore * 0.20) * 100)
  const expectedRecovery = c.amount * recoveryProb * timeScore
  return { recoveryProb, timeScore, amountScore, fundability, expectedRecovery }
}

const SCORED_SAMPLE = CLAIMS_DATA.map(c => ({ ...c, codeLabel: CODE_LABELS[c.code] || `Code ${c.code}`, ...scoreClaim(c) }))

// ─── CSV utilities ────────────────────────────────────────────────────────────
const TEMPLATE_HEADERS = [
  "id","code","amount","filed_days_ago","window_days",
  "avs_mismatch","no_3ds","delivery_confirmed","merchant_acknowledged",
  "pin_verified","vfmp_enrolled","strong_docs","merchant_cbr","prior_claims","note",
]
const TEMPLATE_EXAMPLE = ["DSP-009","10.4","750","15","120","yes","yes","no","no","no","no","no","1.1","0","CNP fraud — AVS mismatch on shipping address"]

function parseBool(v) {
  if (!v) return false
  return ["yes","true","1","y"].includes(v.toLowerCase().trim())
}
function parseCSVLine(line) {
  const r = []; let cur = "", q = false
  for (const ch of line) {
    if (ch === '"') q = !q
    else if (ch === ',' && !q) { r.push(cur); cur = "" }
    else cur += ch
  }
  r.push(cur); return r
}
function parseCSVText(text) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return { claims: [], errors: ["CSV must have a header row and at least one data row."] }
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/\s+/g,"_"))
  const errors = [], claims = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const cols = parseCSVLine(lines[i])
    const row = {}; headers.forEach((h,idx) => { row[h] = (cols[idx]||"").trim() })
    const code = (row.code||"").trim()
    if (!code) { errors.push(`Row ${i+1}: missing reason code — skipped`); continue }
    const amount = parseFloat(row.amount)
    if (isNaN(amount)||amount<=0) { errors.push(`Row ${i+1}: invalid amount "${row.amount}" — skipped`); continue }
    const c = {
      id: row.id||`UPL-${String(i).padStart(3,"0")}`, code,
      codeLabel: CODE_LABELS[code]||`Code ${code}`,
      amount, filedDaysAgo: parseInt(row.filed_days_ago||"0",10)||0,
      windowDays: parseInt(row.window_days||"120",10)||120,
      avsMismatch: parseBool(row.avs_mismatch), no3DS: parseBool(row.no_3ds),
      deliveryConf: parseBool(row.delivery_confirmed), merchantAck: parseBool(row.merchant_acknowledged),
      pinVerified: parseBool(row.pin_verified), isVFMP: parseBool(row.vfmp_enrolled),
      strongDocs: parseBool(row.strong_docs),
      merchantCBR: parseFloat(row.merchant_cbr||"0.5")||0.5,
      priorClaims: parseInt(row.prior_claims||"0",10)||0,
      note: row.note||"", source: "uploaded",
    }
    claims.push({ ...c, ...scoreClaim(c) })
  }
  return { claims, errors }
}
function downloadTemplate() {
  const blob = new Blob([[TEMPLATE_HEADERS.join(","), TEMPLATE_EXAMPLE.join(",")].join("\n")], { type:"text/csv" })
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob)
  a.download = "dispute_portfolio_template.csv"; a.click()
}

// ─── Grade + colour helpers ───────────────────────────────────────────────────
function grade(score) {
  if (score >= 75) return { label:"A", bg:"bg-emerald-900", text:"text-emerald-50", bar:"#064e3b", pill:"border-emerald-700 text-emerald-800" }
  if (score >= 60) return { label:"B", bg:"bg-stone-700",   text:"text-stone-50",   bar:"#44403c", pill:"border-stone-500 text-stone-700"   }
  if (score >= 45) return { label:"C", bg:"bg-amber-800",   text:"text-amber-50",   bar:"#92400e", pill:"border-amber-700 text-amber-800"   }
  return              { label:"D", bg:"bg-red-900",     text:"text-red-50",     bar:"#7f1d1d", pill:"border-red-700 text-red-800"       }
}

function ScoreBar({ value, color }) {
  return (
    <div style={{ height:"3px", background:"#D4CCBC", width:"100%" }}>
      <div style={{ height:"100%", width:`${Math.round(value*100)}%`, background:color }} />
    </div>
  )
}

// ─── Claim detail panel (shared between mobile and desktop) ───────────────────
function ClaimDetail({ sc, advanceRate, claimNet, onClose }) {
  const g = grade(sc.fundability)
  const evidenceItems = [
    { label:"AVS mismatch on shipping address", active:sc.avsMismatch,  positive:true  },
    { label:"No 3DS authentication data",       active:sc.no3DS,        positive:true  },
    { label:"Delivery confirmation on file",    active:sc.deliveryConf, positive:false },
    { label:"Merchant acknowledged in writing", active:sc.merchantAck,  positive:true  },
    { label:"PIN-verified transaction",         active:sc.pinVerified,  positive:false },
    { label:"VFMP enrolled merchant",           active:sc.isVFMP,       positive:true  },
    { label:"Strong documentary evidence",      active:sc.strongDocs,   positive:true  },
    ...(sc.priorClaims > 0 ? [{ label:`${sc.priorClaims} prior claim(s) on account`, active:true, positive:false }] : []),
  ].filter(e => e.active)

  return (
    <div className="border-2 border-stone-900" style={{ background:"#FAF7F1" }}>
      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-stone-300" style={{ background:"#1A1814" }}>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="mono-font text-xs font-medium text-stone-100">{sc.id}</span>
            {sc.source === "uploaded" && (
              <span className="mono-font text-[8px] px-1.5 py-0.5 bg-blue-800 text-blue-100">CSV</span>
            )}
          </div>
          <div className="display-font text-stone-300 text-[13px]">{sc.code} — {sc.codeLabel}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`mono-font text-sm font-bold px-2 py-0.5 ${g.bg} ${g.text}`}>{g.label}</span>
          {onClose && (
            <button onClick={onClose} className="text-stone-400 hover:text-stone-100 transition-colors mono-font text-lg leading-none ml-1" aria-label="Close">×</button>
          )}
        </div>
      </div>

      <div className="px-5 py-5 space-y-5">
        {/* Score breakdown */}
        <div>
          <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-3">SCORE BREAKDOWN</div>
          <div className="space-y-3">
            {[
              { label:"Recovery probability", weight:"55%", raw:sc.recoveryProb, display:`${Math.round(sc.recoveryProb*100)}%`,
                color: sc.recoveryProb>=0.65?"#064e3b":sc.recoveryProb>=0.40?"#92400e":"#7f1d1d" },
              { label:"Time value",           weight:"25%", raw:sc.timeScore,    display:`${Math.round(sc.timeScore*100)}%`,
                color: sc.timeScore>=0.85?"#064e3b":sc.timeScore>=0.65?"#92400e":"#7f1d1d"       },
              { label:"Amount efficiency",    weight:"20%", raw:sc.amountScore,  display:`${Math.round(sc.amountScore*100)}%`,
                color: sc.amountScore>=0.85?"#064e3b":sc.amountScore>=0.55?"#92400e":"#7f1d1d"   },
            ].map(m => (
              <div key={m.label}>
                <div className="flex justify-between items-baseline mb-1.5">
                  <div>
                    <span className="display-font text-[13px] text-stone-700">{m.label}</span>
                    <span className="mono-font text-[9px] text-stone-400 ml-1.5">({m.weight})</span>
                  </div>
                  <span className="mono-font text-xs font-medium text-stone-800">{m.display}</span>
                </div>
                <ScoreBar value={m.raw} color={m.color} />
              </div>
            ))}
          </div>
        </div>

        {/* Evidence factors */}
        {evidenceItems.length > 0 && (
          <div>
            <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-2">EVIDENCE FACTORS</div>
            <div className="space-y-1.5">
              {evidenceItems.map(e => (
                <div key={e.label} className="flex items-start gap-2">
                  {e.positive
                    ? <CheckCircle className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-0.5" />
                    : <XCircle    className="w-3.5 h-3.5 text-red-700 shrink-0 mt-0.5" />}
                  <span className={`display-font text-[13px] leading-snug ${e.positive?"text-emerald-800":"text-red-800"}`}>{e.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Analyst note */}
        {sc.note && (
          <div>
            <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-2">UNDERWRITER NOTE</div>
            <p className="display-font text-stone-700 text-[13px] leading-relaxed border-l-2 border-stone-300 pl-3 italic">{sc.note}</p>
          </div>
        )}

        {/* Financial summary */}
        <div className="border-t border-stone-200 pt-4">
          <div className="mono-font text-[9px] tracking-widest text-stone-400 mb-3">FUNDING SUMMARY</div>
          <div className="space-y-2">
            {[
              { label:"Face value",                     val:`$${sc.amount.toLocaleString()}`,                                                                                       bold:false },
              { label:"Expected recovery",              val:`$${Math.round(sc.expectedRecovery).toLocaleString()} (${Math.round(sc.recoveryProb*100)}% win rate)`,                 bold:false },
              { label:`Advance (${Math.round(advanceRate*100)}% of expected)`, val:`$${Math.round(sc.expectedRecovery*advanceRate).toLocaleString()}`,                             bold:false },
              { label:"Projected net to funder",        val:`$${claimNet(sc).toLocaleString()}`,                                                                                   bold:true  },
              { label:"Return on advance",              val:`${Math.round(((1-advanceRate)/advanceRate)*100)}%`,                                                                   bold:true  },
            ].map(r => (
              <div key={r.label} className="flex justify-between gap-3">
                <span className="display-font text-[13px] text-stone-500 leading-snug">{r.label}</span>
                <span className={`mono-font text-xs shrink-0 ${r.bold?"text-emerald-800 font-medium":"text-stone-700"}`}>{r.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function DisputeFundingAssessor() {
  const [selected, setSelected]       = useState(null)
  const [sortCol, setSortCol]         = useState("fundability")
  const [sortDir, setSortDir]         = useState("desc")
  const [uploadedClaims, setUploaded] = useState([])
  const [parseErrors, setParseErrors] = useState([])
  const [expandedMobile, setExpandedMobile] = useState(null)
  const fileRef = useRef(null)

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d==="desc"?"asc":"desc")
    else { setSortCol(col); setSortDir("desc") }
  }
  function handleFile(e) {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const { claims, errors } = parseCSVText(ev.target.result)
      setUploaded(claims); setParseErrors(errors); setSelected(null); setExpandedMobile(null)
    }
    reader.readAsText(file); e.target.value = ""
  }
  function clearUploaded() { setUploaded([]); setParseErrors([]); setSelected(null); setExpandedMobile(null) }

  const allScored = useMemo(() => [...SCORED_SAMPLE, ...uploadedClaims], [uploadedClaims])

  // ── Portfolio metrics ──────────────────────────────────────────────────────
  const totalValue     = allScored.reduce((s,c) => s+c.amount, 0)
  const totalExpected  = allScored.reduce((s,c) => s+c.expectedRecovery, 0)
  const weightedScore  = allScored.reduce((s,c) => s+c.fundability*c.amount, 0) / totalValue
  const topShare       = Math.max(...allScored.map(c=>c.amount)) / totalValue
  const concPenalty    = topShare > 0.35 ? 4 : 0
  const portfolioScore = Math.round(weightedScore - concPenalty)
  const pg             = grade(portfolioScore)
  const advanceRate    = portfolioScore>=75?0.65:portfolioScore>=60?0.55:portfolioScore>=45?0.44:0.30
  const advanceValue   = totalExpected * advanceRate
  const totalNet       = totalExpected - advanceValue
  const claimNet       = c => Math.round(c.expectedRecovery*(1-advanceRate))
  const roaPercent     = advanceValue>0?Math.round((totalNet/advanceValue)*100):0

  const sorted = useMemo(() => {
    return [...allScored].sort((a,b) => {
      const v = c => sortCol==="amount"?c.amount:sortCol==="expectedRecovery"?c.expectedRecovery:sortCol==="projectedNet"?claimNet(c):c.fundability
      return sortDir==="desc"?v(b)-v(a):v(a)-v(b)
    })
  }, [allScored, sortCol, sortDir])

  const sc = selected ? allScored.find(c=>c.id===selected) : null

  function SortBtn({ col, label }) {
    const active = sortCol===col
    const Icon = active && sortDir==="asc" ? ChevronUp : ChevronDown
    return (
      <button onClick={() => handleSort(col)} className={`flex items-center gap-0.5 mono-font text-[10px] tracking-widest transition-colors ${active?"text-stone-900":"text-stone-400 hover:text-stone-600"}`}>
        {label}<Icon className="w-3 h-3" />
      </button>
    )
  }

  return (
    <div className="min-h-screen" style={{ background:"#F5F1EA", fontFamily:'Georgia,"Times New Roman",serif' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=JetBrains+Mono:wght@400;500&display=swap');
        .display-font { font-family:'Fraunces',Georgia,serif; }
        .mono-font    { font-family:'JetBrains Mono',monospace; }
        .section-divider { border-top:1px solid #1A1814; margin:32px 0 24px 0; }
        .upload-btn {
          font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:0.12em;
          padding:9px 16px; border:1px solid #1A1814; background:#FAF7F1;
          color:#1A1814; cursor:pointer; display:flex; align-items:center;
          gap:6px; text-transform:uppercase; transition:all 0.15s;
        }
        .upload-btn:hover { background:#1A1814; color:#F5F1EA; }
        .claim-row { border-bottom:1px solid #E8E0D4; transition:background 0.1s; }
        .claim-row:hover td { background:#EEE9E0; }
        .claim-row.selected td { background:#1A1814; color:#F5F1EA; }
        .claim-row.selected td .sub-text { color:#78716c; }
        .input-field {
          background:#FAF7F1; border:1px solid #D4CCBC;
          padding:10px 12px; font-family:'JetBrains Mono',monospace;
          font-size:12px; color:#1A1814; width:100%;
        }
        .input-field:focus { outline:none; border-color:#1A1814; }
        @media(max-width:767px){
          .desktop-only { display:none !important; }
        }
        @media(min-width:768px){
          .mobile-only { display:none !important; }
        }
      `}</style>

      <div className="max-w-6xl mx-auto px-4 py-8 sm:px-6 sm:py-12">

        {/* ── Masthead ── */}
        <div className="border-b-2 border-black pb-6 mb-8 sm:pb-8 sm:mb-12">
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
            <div className="mono-font text-xs tracking-widest text-stone-600">ISSUE Nº 003 — DISPUTE RECEIVABLES</div>
            <div className="mono-font text-xs tracking-widest text-stone-600">
              {new Date().toLocaleDateString("en-US",{day:"2-digit",month:"short",year:"numeric"}).toUpperCase()}
            </div>
          </div>
          <h1 className="display-font font-bold text-stone-900 leading-none" style={{ fontSize:"clamp(36px,6vw,80px)", letterSpacing:"-0.03em" }}>
            The Dispute<br />
            <span style={{ fontStyle:"italic", fontWeight:500 }}>Funding Assessor</span>
          </h1>
          <p className="display-font text-stone-700 mt-4 max-w-2xl" style={{ fontSize:"clamp(14px,1.8vw,17px)", lineHeight:"1.6" }}>
            Payment disputes as an asset class. Upload a portfolio of Visa or Mastercard claims and the assessor underwrites each receivable — scoring fundability, modelling probability-weighted recovery, and recommending an advance rate. Built for issuers, servicers, and dispute funders.
          </p>
        </div>

        {/* ── Step 01 — Portfolio Upload ── */}
        <div>
          <div className="flex items-baseline gap-3 mb-4">
            <span className="mono-font text-xs text-stone-500">01</span>
            <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing:"-0.01em" }}>Portfolio Upload</h2>
          </div>

          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />

          <div className="border border-dashed border-stone-400 p-4 sm:p-5 flex flex-wrap gap-3 items-center" style={{ background:"#FAF7F1" }}>
            <button className="upload-btn" onClick={() => fileRef.current?.click()}>
              <Upload style={{ width:13,height:13 }} /> Upload portfolio CSV
            </button>
            <button className="upload-btn" onClick={downloadTemplate}>
              <Download style={{ width:13,height:13 }} /> Download template
            </button>
            {uploadedClaims.length > 0 ? (
              <div className="flex items-center gap-3 sm:ml-auto">
                <span className="mono-font text-[10px] tracking-widest text-stone-500">
                  {uploadedClaims.length} CLAIM{uploadedClaims.length!==1?"S":""} LOADED
                </span>
                <button onClick={clearUploaded} className="mono-font text-[10px] tracking-widest text-stone-400 hover:text-stone-700 transition-colors">CLEAR</button>
              </div>
            ) : parseErrors.length === 0 ? (
              <span className="mono-font text-[10px] tracking-widest text-stone-400 sm:ml-auto hidden sm:block">
                SCORED ALONGSIDE SAMPLE DATA
              </span>
            ) : null}
          </div>

          {parseErrors.length > 0 && (
            <div className="mt-3 border border-amber-700 bg-amber-50 p-4">
              <div className="mono-font text-xs tracking-widest text-amber-800 mb-2">⚠ ROWS SKIPPED</div>
              {parseErrors.map((e,i) => <div key={i} className="display-font text-sm text-amber-900">{e}</div>)}
            </div>
          )}
        </div>

        {/* ── Step 02 — Portfolio Summary ── */}
        <div className="section-divider" />
        <div>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="mono-font text-xs text-stone-500">02</span>
            <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing:"-0.01em" }}>Portfolio Summary</h2>
            <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
              {uploadedClaims.length > 0 && (
                <span className="mono-font text-xs text-stone-400">{SCORED_SAMPLE.length} SAMPLE + {uploadedClaims.length} UPLOADED</span>
              )}
              <span className={`mono-font text-sm font-bold px-3 py-1 ${pg.bg} ${pg.text}`}>GRADE {pg.label}</span>
            </div>
          </div>
          <p className="display-font text-stone-500 text-[15px] mb-6 ml-7" style={{ lineHeight:"1.5" }}>
            This portfolio grades <strong className="text-stone-700">{pg.label}</strong> — a recommended advance of <strong className="text-stone-700">{Math.round(advanceRate*100)}%</strong> of expected recovery. That means advancing <strong className="text-stone-700">${Math.round(advanceValue).toLocaleString()}</strong> today against an expected <strong className="text-stone-700">${Math.round(totalExpected).toLocaleString()}</strong> at resolution.
            {concPenalty > 0 && <span className="text-amber-700"> Concentration penalty applied — single claim exceeds 35% of portfolio value.</span>}
          </p>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { label:"PORTFOLIO VALUE",      value:`$${totalValue.toLocaleString()}`,                 sub:`${allScored.length} receivables`                              },
              { label:"EXPECTED RECOVERY",    value:`$${Math.round(totalExpected).toLocaleString()}`,  sub:`${Math.round(totalExpected/totalValue*100)}% of face value`    },
              { label:"RECOMMENDED ADVANCE",  value:`$${Math.round(advanceValue).toLocaleString()}`,   sub:`${Math.round(advanceRate*100)}% of expected recovery`          },
              { label:"PROJECTED NET RETURN", value:`$${Math.round(totalNet).toLocaleString()}`,       sub:`${roaPercent}% return on advance`, hi:true                    },
              { label:"FUNDABILITY SCORE",    value:`${portfolioScore} / 100`,                         sub:concPenalty>0?`−${concPenalty} concentration`:"no concentration risk" },
            ].map(m => (
              <div key={m.label} className={`border p-4 ${m.hi?"border-emerald-700 bg-emerald-50":"border-stone-300"}`} style={m.hi?{}:{background:"#FAF7F1"}}>
                <div className={`mono-font text-[9px] tracking-widest mb-2 ${m.hi?"text-emerald-700":"text-stone-400"}`}>{m.label}</div>
                <div className={`display-font font-semibold ${m.hi?"text-emerald-900":"text-stone-900"}`} style={{ fontSize:"clamp(16px,2.5vw,22px)", letterSpacing:"-0.02em" }}>{m.value}</div>
                <div className={`mono-font text-[9px] tracking-wide mt-1 ${m.hi?"text-emerald-600":"text-stone-400"}`}>{m.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Step 03 — Claim Detail ── */}
        <div className="section-divider" />
        <div>
          <div className="flex items-baseline gap-3 mb-2">
            <span className="mono-font text-xs text-stone-500">03</span>
            <h2 className="display-font font-semibold text-2xl text-stone-900" style={{ letterSpacing:"-0.01em" }}>Receivables Detail</h2>
          </div>
          <p className="display-font text-stone-500 text-[15px] mb-6 ml-7" style={{ lineHeight:"1.5" }}>
            Each claim scored as a standalone receivable. Tap any row to view evidence factors, score breakdown, and funding summary.
          </p>

          {/* ── Mobile card list (< md) ── */}
          <div className="mobile-only space-y-3">
            {sorted.map(c => {
              const g = grade(c.fundability)
              const isExpanded = expandedMobile === c.id
              return (
                <div key={c.id} className="border border-stone-300" style={{ background:"#FAF7F1" }}>
                  {/* Card header row */}
                  <button
                    className="w-full text-left px-4 py-4"
                    onClick={() => setExpandedMobile(isExpanded ? null : c.id)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="mono-font text-xs font-medium text-stone-800">{c.id}</span>
                          {c.source==="uploaded"&&<span className="mono-font text-[8px] px-1.5 py-0.5 bg-blue-900 text-blue-50">CSV</span>}
                        </div>
                        <div className="display-font text-stone-600 text-[13px]">{c.code} — {c.codeLabel}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`mono-font text-xs font-bold px-2 py-0.5 ${g.bg} ${g.text}`}>{g.label}</span>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-stone-400" /> : <ChevronDown className="w-4 h-4 text-stone-400" />}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span className="mono-font text-xs text-stone-600">${c.amount.toLocaleString()}</span>
                      <span className="mono-font text-[10px] text-stone-400">{c.windowDays-c.filedDaysAgo}d remaining</span>
                      <span className="mono-font text-[10px] text-stone-400">{Math.round(c.recoveryProb*100)}% win rate</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1">
                        <ScoreBar value={c.fundability/100} color={g.bar} />
                      </div>
                      <div className="flex gap-4 shrink-0">
                        <div className="text-right">
                          <div className="mono-font text-[10px] text-stone-400">EXPECTED</div>
                          <div className="mono-font text-xs text-stone-700">${Math.round(c.expectedRecovery).toLocaleString()}</div>
                        </div>
                        <div className="text-right">
                          <div className="mono-font text-[10px] text-stone-400">NET</div>
                          <div className="mono-font text-xs text-emerald-800 font-medium">${claimNet(c).toLocaleString()}</div>
                        </div>
                        <div className="text-right">
                          <div className="mono-font text-[10px] text-stone-400">SCORE</div>
                          <div className="mono-font text-xs text-stone-800 font-medium">{c.fundability}</div>
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-stone-300">
                      <ClaimDetail sc={c} advanceRate={advanceRate} claimNet={claimNet} onClose={null} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Desktop table + panel (>= md) ── */}
          <div className="desktop-only flex gap-6 items-start">

            {/* Table */}
            <div style={{ flex:1, minWidth:0 }}>
              <div className="border border-stone-300 overflow-hidden" style={{ background:"#FAF7F1" }}>
                <div className="overflow-x-auto">
                  <table className="w-full" style={{ minWidth:"640px" }}>
                    <thead>
                      <tr className="border-b border-stone-300" style={{ background:"#EEE9E0" }}>
                        <th className="text-left px-4 py-3"><span className="mono-font text-[10px] tracking-widest text-stone-500">CLAIM</span></th>
                        <th className="text-left px-4 py-3"><span className="mono-font text-[10px] tracking-widest text-stone-500">CODE</span></th>
                        <th className="text-right px-4 py-3"><div className="flex justify-end"><SortBtn col="amount" label="AMOUNT" /></div></th>
                        <th className="text-right px-4 py-3"><div className="flex justify-end"><SortBtn col="expectedRecovery" label="EXPECTED" /></div></th>
                        <th className="text-right px-4 py-3"><div className="flex justify-end"><SortBtn col="projectedNet" label="NET" /></div></th>
                        <th className="text-right px-4 py-3"><div className="flex justify-end"><SortBtn col="fundability" label="SCORE" /></div></th>
                        <th className="text-center px-4 py-3"><span className="mono-font text-[10px] tracking-widest text-stone-500">GRADE</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map(c => {
                        const g = grade(c.fundability)
                        const isSel = selected===c.id
                        return (
                          <tr key={c.id} onClick={() => setSelected(isSel?null:c.id)} className={`claim-row cursor-pointer ${isSel?"selected":""}`}>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className={`mono-font text-xs font-medium ${isSel?"text-stone-100":"text-stone-800"}`}>{c.id}</span>
                                {c.source==="uploaded"&&<span className={`mono-font text-[8px] px-1.5 py-0.5 ${isSel?"bg-stone-600 text-stone-200":"bg-blue-900 text-blue-50"}`}>CSV</span>}
                              </div>
                              <div className={`sub-text mono-font text-[10px] mt-0.5 ${isSel?"":"text-stone-400"}`}>{c.windowDays-c.filedDaysAgo}d remaining</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className={`mono-font text-xs ${isSel?"text-stone-100":"text-stone-700"}`}>{c.code}</div>
                              <div className={`sub-text display-font text-[11px] leading-snug mt-0.5 ${isSel?"":"text-stone-500"}`}>{c.codeLabel}</div>
                            </td>
                            <td className={`px-4 py-3 text-right mono-font text-xs ${isSel?"text-stone-100":"text-stone-700"}`}>${c.amount.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right">
                              <div className={`mono-font text-xs ${isSel?"text-stone-100":"text-stone-700"}`}>${Math.round(c.expectedRecovery).toLocaleString()}</div>
                              <div className={`sub-text mono-font text-[10px] mt-0.5 ${isSel?"":"text-stone-400"}`}>{Math.round(c.recoveryProb*100)}% win</div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className={`mono-font text-xs font-medium ${isSel?"text-emerald-300":"text-emerald-800"}`}>${claimNet(c).toLocaleString()}</div>
                              <div className={`sub-text mono-font text-[10px] mt-0.5 ${isSel?"":"text-stone-400"}`}>{Math.round((1-advanceRate)*100)}% margin</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className={`mono-font text-xs text-right mb-1.5 ${isSel?"text-stone-100":"text-stone-800"}`}>{c.fundability}</div>
                              <ScoreBar value={c.fundability/100} color={isSel?"#F5F1EA":g.bar} />
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`mono-font text-xs px-2 py-0.5 font-medium ${g.bg} ${g.text}`}>{g.label}</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Detail panel */}
            {sc && (
              <div className="w-80 flex-shrink-0">
                <ClaimDetail sc={sc} advanceRate={advanceRate} claimNet={claimNet} onClose={() => setSelected(null)} />
              </div>
            )}
          </div>
        </div>

        {/* ── Underwriting criteria ── */}
        <div className="section-divider" />
        <div>
          <div className="mono-font text-xs tracking-widest text-stone-500 mb-4">UNDERWRITING CRITERIA</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              {
                title:"RECOVERY PROBABILITY (55%)",
                body:"Reason code base win rate adjusted for AVS mismatch, 3DS absence, delivery confirmation, merchant acknowledgement, PIN verification, VFMP enrollment, documentation strength, prior claim history, and merchant chargeback ratio. The dominant factor — a weak code can't be rescued by clean evidence."
              },
              {
                title:"TIME VALUE (25%)",
                body:"Days remaining in the filing window, decayed non-linearly. Inside 30 days: material discount. Inside 15 days: severe penalty. Visa's standard window is 120 days; fraud codes can extend further. Claims with less than 15 days should rarely be funded."
              },
              {
                title:"AMOUNT EFFICIENCY (20%)",
                body:"Funder overhead is roughly fixed per claim — legal, operational, servicing costs. Sub-$100 claims rarely justify the cost. Above $2,000 introduces single-claim concentration risk. The sweet spot is $200–$2,000. Advance rates scale with portfolio grade: A 65% / B 55% / C 44% / D 30%."
              }
            ].map(m => (
              <div key={m.title}>
                <div className="mono-font text-[10px] tracking-widest text-stone-600 mb-2">{m.title}</div>
                <p className="display-font text-stone-600 text-[14px] leading-relaxed">{m.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Disclaimer ── */}
        <div className="section-divider" />
        <div className="flex items-start gap-3 border border-amber-700 bg-amber-50 p-4">
          <AlertTriangle className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
          <p className="display-font text-stone-800 text-[13px] leading-relaxed">
            Win-rate baselines approximate Visa issuer dispute outcome data and carry model uncertainty. Advance rates and portfolio grade reflect expected value — actual recovery depends on evidence quality and merchant behaviour at representment. Not legal or financial advice.
          </p>
        </div>

        {/* ── Footer ── */}
        <div className="section-divider" />
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between text-stone-600 gap-2">
          <div className="mono-font text-xs tracking-widest">BUILT BY ADEOTI FASHOKUN — RISK &amp; TRUST OPERATIONS</div>
          <div className="display-font italic text-sm">"The chargeback that gets funded wins twice."</div>
        </div>

      </div>
    </div>
  )
}
