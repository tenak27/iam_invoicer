import { describe, expect, it } from 'vitest'
import { amountInWords, formatMoney, numberToFrenchWords } from '../src/shared/format'
import { computeTotals, weightedCost } from '../src/shared/domain'

describe('montants en lettres', () => {
  it.each([
    [1, 'un'],
    [21, 'vingt et un'],
    [71, 'soixante et onze'],
    [80, 'quatre-vingts'],
    [81, 'quatre-vingt-un'],
    [91, 'quatre-vingt-onze'],
    [200, 'deux cents'],
    [201, 'deux cent un'],
    [1000, 'mille'],
    [80000, 'quatre-vingt mille'],
    [200000, 'deux cent mille'],
    [536900, 'cinq cent trente-six mille neuf cents'],
    [1000000, 'un million'],
    [2_450_300, 'deux millions quatre cent cinquante mille trois cents'],
    [1_000_000_000, 'un milliard']
  ])('%i → %s', (n, words) => {
    expect(numberToFrenchWords(n)).toBe(words)
  })

  it('phrase complète', () => {
    expect(amountInWords(536900)).toBe('Cinq cent trente-six mille neuf cents francs CFA')
  })
})

describe('calculs', () => {
  it('formate en FCFA', () => {
    expect(formatMoney(1234567)).toBe('1 234 567 FCFA')
  })
  it('TVA par taux', () => {
    const t = computeTotals([
      { product_id: null, description: 'a', quantity: 2, unit_price: 1000, discount: 0, tva_rate: 18 },
      { product_id: null, description: 'b', quantity: 1, unit_price: 500, discount: 0, tva_rate: 0 }
    ])
    expect(t).toMatchObject({ ht: 2500, tva: 360, ttc: 2860 })
    expect(t.byRate).toHaveLength(2)
  })
  it('coût moyen pondéré', () => {
    expect(weightedCost(10, 100, 10, 200)).toBe(150)
    expect(weightedCost(-2, 100, 5, 200)).toBe(200)
  })
})
