import React, { useEffect, useRef, useState } from 'react'
import { PriceUnit, WeightEntryUnit, formatWeight, priceUnitSuffix, toGrams, weightedAmount } from '../lib/weight'
import { formatCurrency } from '../lib/utils'

interface WeightEntryModalProps {
  itemName: string
  /** Menu price (per kg or per 100 g, depending on `unit`) */
  price: number
  unit: PriceUnit
  /** Pre-fill when changing the weight of a line that is already in the order */
  initialGrams?: number
  /** Price of ONE piece. When given (with onConfirmPiece) the item can be added by weight OR by piece. */
  piecePrice?: number
  onConfirm: (grams: number) => void
  onConfirmPiece?: (quantity: number) => void
  onClose: () => void
}

const QUICK_PICKS = [100, 250, 500, 1000]
const MAX_PIECES = 999

/**
 * Asks for the weight of an item sold by kg / 100 g and shows the amount as you type.
 * Items that also have a piece price get a "By weight | By piece" switch.
 * The server recalculates the price, so this is only a preview.
 */
const WeightEntryModal: React.FC<WeightEntryModalProps> = ({
  itemName,
  price,
  unit,
  initialGrams,
  piecePrice,
  onConfirm,
  onConfirmPiece,
  onClose,
}) => {
  const canPiece = !!piecePrice && piecePrice > 0 && !!onConfirmPiece
  const [mode, setMode] = useState<'weight' | 'piece'>('weight')
  const [pieces, setPieces] = useState('1')

  const startKg = !!initialGrams && initialGrams >= 1000 && initialGrams % 100 === 0
  const [entryUnit, setEntryUnit] = useState<WeightEntryUnit>(startKg ? 'kg' : 'g')
  const [value, setValue] = useState(
    initialGrams ? String(startKg ? initialGrams / 1000 : initialGrams) : '',
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const pieceRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = mode === 'piece' ? pieceRef.current : inputRef.current
    el?.focus()
    el?.select()
  }, [mode])

  const grams = toGrams(value, entryUnit)
  const tooBig = grams > 100000
  const weightValid = grams > 0 && !tooBig
  const amount = weightedAmount(price, unit, grams)

  const qty = Math.floor(Number(pieces))
  const pieceValid = canPiece && Number.isFinite(qty) && qty >= 1 && qty <= MAX_PIECES
  const pieceAmount = pieceValid ? Math.round((piecePrice as number) * qty * 100) / 100 : 0

  const valid = mode === 'piece' ? pieceValid : weightValid

  const pick = (g: number) => {
    // Keep whichever unit reads naturally: whole kg for 1000+, otherwise grams
    if (g >= 1000) {
      setEntryUnit('kg')
      setValue(String(g / 1000))
    } else {
      setEntryUnit('g')
      setValue(String(g))
    }
  }

  const bumpPieces = (delta: number) => {
    const next = Math.min(MAX_PIECES, Math.max(1, (Number.isFinite(qty) ? qty : 1) + delta))
    setPieces(String(next))
  }

  const submit = () => {
    if (!valid) return
    if (mode === 'piece') onConfirmPiece!(qty)
    else onConfirm(grams)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
        <h3 className="text-lg font-semibold text-gray-900 leading-tight">{itemName}</h3>
        <p className="text-sm text-gray-500 mt-0.5">
          {formatCurrency(price)} {priceUnitSuffix(unit)}
          {canPiece && <> · {formatCurrency(piecePrice as number)} / piece</>}
        </p>

        {canPiece && (
          <div className="flex rounded-lg border border-gray-300 overflow-hidden mt-4">
            {([['weight', 'By weight'], ['piece', 'By piece']] as const).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 py-2 text-sm font-semibold ${
                  mode === m ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {mode === 'weight' ? (
          <>
            <label className="block text-sm font-medium text-gray-700 mt-4">Weight</label>
            <div className="flex gap-2 mt-1">
              <input
                ref={inputRef}
                type="number"
                inputMode="decimal"
                min="0"
                step={entryUnit === 'kg' ? '0.05' : '10'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder={entryUnit === 'kg' ? 'e.g. 1.5' : 'e.g. 350'}
                className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2.5 text-lg"
              />
              <div className="flex rounded-lg border border-gray-300 overflow-hidden shrink-0">
                {(['g', 'kg'] as WeightEntryUnit[]).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setEntryUnit(u)}
                    className={`px-4 text-sm font-semibold ${
                      entryUnit === u ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
              {QUICK_PICKS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => pick(g)}
                  className="px-3 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200"
                >
                  {formatWeight(g)}
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-xl bg-indigo-50 p-3">
              {weightValid ? (
                <>
                  <p className="text-xs text-indigo-700">
                    {formatWeight(grams)} × {formatCurrency(price)} {priceUnitSuffix(unit)}
                  </p>
                  <p className="text-2xl font-bold text-indigo-700">{formatCurrency(amount)}</p>
                </>
              ) : (
                <p className="text-sm text-indigo-700">
                  {tooBig ? 'That weight is too large (max 100 kg).' : 'Enter the weight to see the amount.'}
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <label className="block text-sm font-medium text-gray-700 mt-4">Number of pieces</label>
            <div className="flex items-stretch gap-2 mt-1">
              <button
                type="button"
                onClick={() => bumpPieces(-1)}
                className="w-12 rounded-lg border border-gray-300 text-xl font-semibold text-gray-700 hover:bg-gray-50"
                aria-label="Fewer pieces"
              >
                −
              </button>
              <input
                ref={pieceRef}
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={pieces}
                onChange={(e) => setPieces(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2.5 text-lg text-center"
              />
              <button
                type="button"
                onClick={() => bumpPieces(1)}
                className="w-12 rounded-lg border border-gray-300 text-xl font-semibold text-gray-700 hover:bg-gray-50"
                aria-label="More pieces"
              >
                +
              </button>
            </div>

            <div className="mt-4 rounded-xl bg-indigo-50 p-3">
              {pieceValid ? (
                <>
                  <p className="text-xs text-indigo-700">
                    {qty} × {formatCurrency(piecePrice as number)} / piece
                  </p>
                  <p className="text-2xl font-bold text-indigo-700">{formatCurrency(pieceAmount)}</p>
                </>
              ) : (
                <p className="text-sm text-indigo-700">Enter a whole number of pieces (1 – {MAX_PIECES}).</p>
              )}
            </div>
          </>
        )}

        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!valid}
            className="flex-1 py-2.5 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-40"
          >
            {initialGrams && mode === 'weight' ? 'Update' : 'Add to order'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default WeightEntryModal
