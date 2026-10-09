import assert from 'node:assert/strict'
import { getLayoutStats } from '../utils/common'
import { validateLargeGridPerformance } from '../utils/validation'
import { useGridLayoutPlus } from '../hooks/useGridLayoutPlus'

const items = [
  { i: 'small', x: 0, y: 0, w: 1, h: 1 },
  { i: 'large', x: 1, y: 0, w: 2, h: 3 }
]
const stats = getLayoutStats(items, 12)
assert.deepEqual(stats.smallestItem, { id: 'small', area: 1 })
assert.deepEqual(stats.largestItem, { id: 'large', area: 6 })
assert.equal(getLayoutStats([], 12).largestItem, null)
assert.match(validateLargeGridPerformance(items, 99).data?.warning ?? '', /小屏幕/)

const grid = useGridLayoutPlus()
const invalid = grid.addItem('test', { w: -1 })
assert.equal(invalid.success, false)
assert.equal(invalid.data, undefined)
assert.equal(grid.layout.value.length, 0)
const valid = grid.addItem('test', { i: 'valid', w: 2, h: 2 })
assert.equal(valid.success, true)
assert.equal(valid.data?.i, 'valid')
assert.equal(grid.layout.value.length, 1)
console.log('grid contract assertions passed')
