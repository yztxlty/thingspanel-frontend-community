import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse, compileTemplate } from '@vue/compiler-sfc'

test('设备指标选择器双向绑定可编译并写回设备数据源', () => {
  const filename = new URL('./card-form-with-selector.vue', import.meta.url).pathname
  const source = readFileSync(filename, 'utf8')
  const { descriptor, errors } = parse(source, { filename })
  assert.deepEqual(errors, [])
  const result = compileTemplate({ source: descriptor.template.content, filename, id: 'selector' })
  assert.deepEqual(result.errors, [])
  assert.match(result.code, /deviceSource\[i\]\) = \$event/)
})
