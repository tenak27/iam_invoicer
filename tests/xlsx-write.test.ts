// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { buildXlsx } from '../src/shared/xlsxWrite'
import { readXlsx } from '../src/renderer/src/xlsx'

describe('Export Excel (.xlsx)', () => {
  it('classeur relu à l’identique par le lecteur de l’application', async () => {
    const bytes = buildXlsx([{
      name: 'Ventes / clients',
      title: ['Analyse : meilleurs clients', 'Période : 01/01/2026 – 31/12/2026'],
      columns: [{ label: 'Client' }, { label: 'CA HT', format: 'money' }, { label: 'Taux', format: 'percent' }],
      rows: [['Ouaga Distribution « A&B »', 604000, 33.5], ['Bobo Services', 100000, null]],
      totalRow: ['Total', 704000, 30]
    }])
    expect(bytes[0]).toBe(0x50) // « PK »
    const rows = await readXlsx(new Blob([bytes as Uint8Array<ArrayBuffer>]))
    expect(rows[0][0]).toBe('Analyse : meilleurs clients')
    const header = rows.findIndex((r) => r[0] === 'Client')
    expect(rows[header]).toEqual(['Client', 'CA HT', 'Taux'])
    expect(rows[header + 1].slice(0, 2)).toEqual(['Ouaga Distribution « A&B »', '604000'])
    expect(Number(rows[header + 1][2])).toBeCloseTo(0.335)
    expect(rows[header + 3].slice(0, 2)).toEqual(['Total', '704000'])
  })
})
