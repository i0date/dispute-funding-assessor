import { useState, useMemo } from "react"
import { ChevronDown, ChevronUp, CheckCircle, XCircle, AlertTriangle } from "lucide-react"

// ─── Reason code base win rates (issuer perspective, Visa dispute outcome data) ───
const BASE_WIN_RATES = {
  "10.1": 0.85, // EMV liability shift — near automatic
  "10.2": 0.48, // No cardholder auth (card present) — mixed, PIN exposure weakens issuer
  "10.4": 0.76, // CNP fraud — strong for issuer absent 3DS
  "10.5": 0.93, // VFMP enrolled merchant — near automatic liability shift
  "13.1": 0.41, // Merchandise not received — moderate, delivery evidence often rebutted
  "13.3": 0.30, // Not as described — weakest, highly subjective
  "13.5": 0.57, // Misrepresentation — moderate, depends on documentation quality
  "13.6": 0.68, // Credit not processed — strong when merchant acknowledges
  "13.7": 0.44, // Cancelled merchandise / services
}

// ─── Sample portfolio ─────────────────────────────────────────────────────────────
const CLAIMS_DATA = [
  {
    id: "DSP-001", code: "10.4", codeLabel: "CNP fraud — other",
    amount: 850, filedDaysAgo: 10, windowDays: 120,
    avsMismatch: true, no3DS: true, deliveryConf: false,
    merchantAck: false, pinVerified: false, isVFMP: false, strongDocs: false,
    merchantCBR: 1.2, priorClaims: 0,
    note: "No 3DS, AVS mismatch on shipping address. Clean account history. Strong CNP fraud pattern — issuer holds the stronger hand.",
  },
  {
    id: "DSP-002", code: "13.1", codeLabel: "Merchandise not received",
    amount: 320, filedDaysAgo: 25, windowDays: 120,
    avsMismatch: false, no3DS: false, deliveryConf: true,
    merchantAck: false, pinVerified: false, isVFMP: false, strongDocs: false,
    merchantCBR: 0.4, priorClaims: 1,
    note: "Delivery confirmation on file. Low-CBR merchant will likely representment aggressively. One prior dispute on account reduces confidence.",
  },
  {
    id: "DSP-003", code: "10.5", codeLabel: "Visa fraud monitoring program",
    amount: 2200, filedDaysAgo: 5, windowDays: 120,
    avsMismatch: true, no3DS: true, deliveryConf: false,
    merchantAck: false, pinVerified: false, isVFMP: true, strongDocs: false,
    merchantCBR: 2.8, priorClaims: 0,
    note: "VFMP-enrolled merchant — near-automatic liability shift regardless of dispute code. High merchant CBR confirms systemic fraud pattern. Strongest claim in portfolio.",
  },
  {
    id: "DSP-004", code: "13.3", codeLabel: "Not as described",
    amount: 180, filedDaysAgo: 40, windowDays: 120,
    avsMismatch: false, no3DS: false, deliveryConf: false,
    merchantAck: false, pinVerified: false, isVFMP: false, strongDocs: false,
    merchantCBR: 0.6, priorClaims: 2,
    note: "Subjective quality dispute with no supporting documentation. Two prior claims on account is a significant red flag. 80 days remaining, but low confidence regardless.",
  },
  {
    id: "DSP-005", code: "10.2", codeLabel: "No cardholder authorization",
    amount: 650, filedDaysAgo: 15, windowDays: 120,
    avsMismatch: false, no3DS: false, deliveryConf: false,
    merchantAck: false, pinVerified: true, isVFMP: false, strongDocs: false,
    merchantCBR: 0.8, priorClaims: 0,
    note: "Chip + PIN transaction. PIN verification shifts liability back to the issuer under Visa rules — near-automatic loss at representment. Cardholder claims card was lost before transaction.",
  },
  {
    id: "DSP-006", code: "13.6", codeLabel: "Credit not processed",
    amount: 420, filedDaysAgo: 20, windowDays: 120,
    avsMismatch: false, no3DS: false, deliveryConf: false,
    merchantAck: true, pinVerified: false, isVFMP: false, strongDocs: true,
    merchantCBR: 0.5, priorClaims: 0,
    note: "Merchant acknowledged credit owed in writing. Strong paper trail. Clean account history. Near-certain win — merchant acknowledgement rarely survives representment scrutiny.",
  },
  {
    id: "DSP-007", code: "10.4", codeLabel: "CNP fraud — other",
    amount: 95, filedDaysAgo: 50, windowDays: 120,
    avsMismatch: false, no3DS: false, deliveryConf: false,
    merchantAck: false, pinVerified: false, isVFMP: false, strongDocs: false,
    merchantCBR: 0.9, priorClaims: 1,
    note: "Small amount at 70-day mark. Limited fraud evidence and one prior claim lower confidence. Marginal for inclusion — funder overhead may exceed expected return.",
  },
  {
    id: "DSP-008", code: "13.5", codeLabel: "Misrepresentation",
    amount: 1100, filedDaysAgo: 8, windowDays: 120,
    avsMismatch: false, no3DS: false, deliveryConf: false,
    merchantAck: false, pinVerified: false, isVFMP: false, strongDocs: true,
    merchantCBR: 0.7, priorClaims: 0,
    note: "Strong documentary evidence — screenshots of merchant listing vs. item received. Early in filing window, clean account history. Misrepresentation is winnable with documentation quality like this.",
  },
]

// ─── Scoring model ────────────────────────────────────────────────────────────────

function computeRecoveryProb(c) {
  let p = BASE_WIN_RATES[c.code] ?? 0.50
  if (c.avsMismatch && c.code.startsWith("10")) p += 0.07
  if (c.no3DS && c.code.startsWith("10")) p += 0.05
  if (c.deliveryConf) p -= 0.22
  if (c.merchantAck) p += 0.18
  if (c.pinVerified) p -= 0.28
  if (c.strongDocs) p += 0.12
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
  const recoveryProb  = computeRecoveryProb(c)
  const timeScore     = computeTimeScore(c)
  const amountScore   = computeAmountScore(c.amount)
  const fundability   = Math.round((recoveryProb * 0.55 + timeScore * 0.25 + amountScore * 0.20) * 100)
  const expectedRecovery = c.amount * recoveryProb * timeScore
  return { recoveryProb, timeScore, amountScore, fundability, expectedRecovery }
}

// ─── Pre-score all claims ─────────────────────────────────────────────────────────
const SCORED = CLAIMS_DATA.map(c => ({ ...c, ...scoreClaim(c) }))

// ─── Grade helpers ────────────────────────────────────────────────────────────────
function grade(score) {
  if (score >= 75) return { label: "A", pill: "text-green-700 bg-green-50 border-green-200",  bar: "bg-green-400"  }
  if (score >= 60) return { label: "B", pill: "text-blue-700 bg-blue-50 border-blue-200",    bar: "bg-blue-400"   }
  if (score >= 45) return { label: "C", pill: "text-amber-700 bg-amber-50 border-amber-200", bar: "bg-amber-400"  }
  return              { label: "D", pill: "text-red-700 bg-red-50 border-red-200",           bar: "bg-red-400"    }
}

function ScoreBar({ value, color, height = "h-1.5" }) {
  return (
    <div className={`${height} bg-gray-100 rounded-full overflow-hidden`}>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────────
export default function DisputeFundingAssessor() {
  const [selected, setSelected]   = useState(null)
  const [sortCol, setSortCol]     = useState("fundability")
  const [sortDir, setSortDir]     = useState("desc")

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === "desc" ? "asc" : "desc")
    else { setSortCol(col); setSortDir("desc") }
  }

  const sorted = useMemo(() => {
    return [...SCORED].sort((a, b) => {
      const v = c => sortCol === "amount" ? c.amount : sortCol === "expectedRecovery" ? c.expectedRecovery : c.fundability
      return sortDir === "desc" ? v(b) - v(a) : v(a) - v(b)
    })
  }, [sortCol, sortDir])

  // ── Portfolio metrics ──────────────────────────────────────────────────────────
  const totalValue        = SCORED.reduce((s, c) => s + c.amount, 0)
  const totalExpected     = SCORED.reduce((s, c) => s + c.expectedRecovery, 0)
  const weightedScore     = SCORED.reduce((s, c) => s + c.fundability * c.amount, 0) / totalValue
  const topShare          = Math.max(...SCORED.map(c => c.amount)) / totalValue
  const concPenalty       = topShare > 0.35 ? 4 : 0
  const portfolioScore    = Math.round(weightedScore - concPenalty)
  const pg                = grade(portfolioScore)
  const advanceRate       = portfolioScore >= 75 ? 0.65 : portfolioScore >= 60 ? 0.55 : portfolioScore >= 45 ? 0.44 : 0.30
  const advanceValue      = totalExpected * advanceRate

  const sc = selected ? SCORED.find(c => c.id === selected) : null

  function SortBtn({ col, label }) {
    const active = sortCol === col
    const Icon   = active && sortDir === "asc" ? ChevronUp : ChevronDown
    return (
      <button
        onClick={() => handleSort(col)}
        className={`flex items-center gap-0.5 text-xs font-normal transition-colors ${active ? "text-gray-700" : "text-gray-400 hover:text-gray-600"}`}
      >
        {label}<Icon className="w-3 h-3" />
      </button>
    )
  }

  return (
    <div className="p-5 max-w-5xl mx-auto text-sm font-sans">

      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">Dispute funding assessment</p>
          <h1 className="text-xl font-medium text-gray-900">{SCORED.length} open claims — portfolio analysis</h1>
        </div>
        <div className={`border rounded-xl px-4 py-2 text-2xl font-medium ${pg.pill}`}>
          {pg.label}
        </div>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          {
            label: "Portfolio value",
            value: `$${totalValue.toLocaleString()}`,
            sub: `${SCORED.length} claims`,
          },
          {
            label: "Expected recovery",
            value: `$${Math.round(totalExpected).toLocaleString()}`,
            sub: `${Math.round(totalExpected / totalValue * 100)}% of face value`,
          },
          {
            label: "Recommended advance",
            value: `$${Math.round(advanceValue).toLocaleString()}`,
            sub: `${Math.round(advanceRate * 100)}% of expected recovery`,
          },
          {
            label: "Portfolio fundability",
            value: `${portfolioScore} / 100`,
            sub: concPenalty > 0 ? `−${concPenalty} concentration penalty` : "no concentration risk",
          },
        ].map(m => (
          <div key={m.label} className="border border-gray-200 rounded-xl p-3.5">
            <p className="text-xs text-gray-400 mb-1.5">{m.label}</p>
            <p className="text-lg font-medium text-gray-900">{m.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{m.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Table + detail panel ── */}
      <div className="flex gap-4 items-start">

        {/* Claims table */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left pb-2.5 pr-3 font-normal text-gray-400">Claim</th>
                <th className="text-left pb-2.5 pr-3 font-normal text-gray-400">Reason code</th>
                <th className="text-right pb-2.5 pr-3">
                  <div className="flex justify-end"><SortBtn col="amount" label="Amount" /></div>
                </th>
                <th className="text-right pb-2.5 pr-3">
                  <div className="flex justify-end"><SortBtn col="expectedRecovery" label="Expected" /></div>
                </th>
                <th className="text-right pb-2.5 pr-3">
                  <div className="flex justify-end"><SortBtn col="fundability" label="Score" /></div>
                </th>
                <th className="text-center pb-2.5 font-normal text-gray-400">Grade</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(c => {
                const g          = grade(c.fundability)
                const isSelected = selected === c.id
                return (
                  <tr
                    key={c.id}
                    onClick={() => setSelected(isSelected ? null : c.id)}
                    className={`border-b border-gray-50 cursor-pointer transition-colors ${isSelected ? "bg-blue-50" : "hover:bg-gray-50"}`}
                  >
                    <td className="py-3 pr-3">
                      <p className="font-medium text-gray-800">{c.id}</p>
                      <p className="text-gray-400">{c.windowDays - c.filedDaysAgo}d window remaining</p>
                    </td>
                    <td className="py-3 pr-3">
                      <p className="text-gray-700">{c.code}</p>
                      <p className="text-gray-400 text-[10px] leading-snug">{c.codeLabel}</p>
                    </td>
                    <td className="py-3 pr-3 text-right text-gray-700">${c.amount.toLocaleString()}</td>
                    <td className="py-3 pr-3 text-right">
                      <p className="text-gray-800">${Math.round(c.expectedRecovery).toLocaleString()}</p>
                      <p className="text-gray-400">{Math.round(c.recoveryProb * 100)}% win rate</p>
                    </td>
                    <td className="py-3 pr-3">
                      <p className="text-right text-gray-800 font-medium mb-1">{c.fundability}</p>
                      <ScoreBar value={c.fundability / 100} color={g.bar} />
                    </td>
                    <td className="py-3 text-center">
                      <span className={`border rounded px-2 py-0.5 font-medium text-xs ${g.pill}`}>{g.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Detail panel */}
        {sc && (() => {
          const g = grade(sc.fundability)
          const evidenceItems = [
            { label: "AVS mismatch on shipping address", active: sc.avsMismatch, positive: true },
            { label: "No 3DS authentication data", active: sc.no3DS, positive: true },
            { label: "Delivery confirmation on file", active: sc.deliveryConf, positive: false },
            { label: "Merchant acknowledgement", active: sc.merchantAck, positive: true },
            { label: "PIN-verified transaction", active: sc.pinVerified, positive: false },
            { label: "VFMP enrolled merchant", active: sc.isVFMP, positive: true },
            { label: "Strong documentary evidence", active: sc.strongDocs, positive: true },
            ...(sc.priorClaims > 0 ? [{ label: `${sc.priorClaims} prior claim(s) on account`, active: true, positive: false }] : []),
          ].filter(e => e.active)

          return (
            <div style={{ width: 320, flexShrink: 0 }} className="border border-gray-200 rounded-xl p-4">

              {/* Panel header */}
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-medium text-gray-900">{sc.id}</p>
                  <p className="text-xs text-gray-400">{sc.code} — {sc.codeLabel}</p>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="text-gray-300 hover:text-gray-500 text-xl leading-none mt-0.5"
                  aria-label="Close detail panel"
                >×</button>
              </div>

              {/* Score breakdown */}
              <div className="space-y-3 mb-4">
                {[
                  { label: "Recovery probability", weight: "55%", raw: sc.recoveryProb,  display: `${Math.round(sc.recoveryProb * 100)}%`,  color: sc.recoveryProb >= 0.65 ? "bg-green-400" : sc.recoveryProb >= 0.40 ? "bg-amber-400" : "bg-red-400"  },
                  { label: "Time value",           weight: "25%", raw: sc.timeScore,     display: `${Math.round(sc.timeScore * 100)}%`,     color: sc.timeScore >= 0.85 ? "bg-green-400" : sc.timeScore >= 0.65 ? "bg-amber-400" : "bg-red-400"     },
                  { label: "Amount efficiency",    weight: "20%", raw: sc.amountScore,   display: `${Math.round(sc.amountScore * 100)}%`,   color: sc.amountScore >= 0.85 ? "bg-green-400" : sc.amountScore >= 0.55 ? "bg-amber-400" : "bg-red-400"   },
                ].map(m => (
                  <div key={m.label}>
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-xs text-gray-500">{m.label} <span className="text-gray-300">({m.weight})</span></span>
                      <span className="text-xs font-medium text-gray-700">{m.display}</span>
                    </div>
                    <ScoreBar value={m.raw} color={m.color} />
                  </div>
                ))}
              </div>

              {/* Evidence flags */}
              {evidenceItems.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs text-gray-400 mb-1.5">Evidence factors</p>
                  <div className="space-y-1.5">
                    {evidenceItems.map(e => (
                      <div key={e.label} className="flex items-center gap-1.5 text-xs">
                        {e.positive
                          ? <CheckCircle className="w-3 h-3 text-green-500 shrink-0" />
                          : <XCircle className="w-3 h-3 text-red-400 shrink-0" />}
                        <span className={e.positive ? "text-green-700" : "text-red-600"}>{e.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Analyst note */}
              <p className="bg-gray-50 rounded-lg p-2.5 text-xs text-gray-500 leading-relaxed mb-3">{sc.note}</p>

              {/* Financial summary */}
              <div className="border-t border-gray-100 pt-3 space-y-1.5">
                {[
                  { label: "Face value",              val: `$${sc.amount.toLocaleString()}`,                          hi: false },
                  { label: "Expected recovery",       val: `$${Math.round(sc.expectedRecovery).toLocaleString()}`,    hi: false },
                  { label: "Fundability score",       val: `${sc.fundability} / 100`,                                 hi: false },
                  { label: "Advance at portfolio rate", val: `$${Math.round(sc.expectedRecovery * advanceRate).toLocaleString()} (${Math.round(advanceRate * 100)}%)`, hi: true },
                ].map(r => (
                  <div key={r.label} className="flex justify-between text-xs">
                    <span className="text-gray-400">{r.label}</span>
                    <span className={r.hi ? `font-medium ${g.pill.split(" ")[0]}` : "text-gray-700"}>{r.val}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}
      </div>

      {/* ── Scoring methodology note ── */}
      <div className="mt-6 pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-400 mb-2 font-medium">Scoring model</p>
        <div className="grid grid-cols-3 gap-3 text-xs text-gray-400">
          <p><span className="font-medium text-gray-500">Recovery probability (55%)</span> — reason code base win rate adjusted for AVS mismatch, 3DS absence, delivery confirmation, merchant acknowledgement, PIN verification, VFMP enrollment, documentation quality, prior claim history, and merchant chargeback ratio.</p>
          <p><span className="font-medium text-gray-500">Time value (25%)</span> — days remaining in the filing window. Claims inside 30 days carry a material discount; inside 15 days are severely penalized. Visa standard window is 120 days; fraud codes (10.x) extend to 540 in some jurisdictions.</p>
          <p><span className="font-medium text-gray-500">Amount efficiency (20%)</span> — funder overhead is roughly fixed per claim. Sub-$100 claims rarely justify the cost. Amounts over $2,000 introduce concentration risk. Sweet spot is $200–$2,000. Portfolio-level advance rates: A (65%) / B (55%) / C (44%) / D (30%) of expected recovery.</p>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="mt-4 flex items-start gap-2 text-xs text-gray-400">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>Win-rate baselines approximate Visa issuer dispute outcome data and carry model uncertainty. Advance rates and portfolio grade reflect expected value — actual recovery depends on evidence quality and merchant behaviour at representment. Not legal or financial advice.</span>
      </div>
    </div>
  )
}
