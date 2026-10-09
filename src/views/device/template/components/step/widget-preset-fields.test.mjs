import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const module = { exports: {} }
const source = readFileSync(new URL('../../../../../utils/thingsvis/platform-fields.ts', import.meta.url), 'utf8')
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
  exports: module.exports,
  console
})
const { extractPlatformFields } = module.exports

test('模板预设保留字段标识、数值类型和属性分类', () => {
  const [field] = extractPlatformFields({
    attributes: [{ identifier: 'temperature', name: '温度', data_type: 'float', unit: '℃' }]
  })
  assert.equal(field.id, 'temperature')
  assert.equal(field.type, 'number')
  assert.equal(field.dataType, 'attribute')
  assert.equal(field.unit, '℃')
})

test('遥测预设保留布尔类型而不被当作文本', () => {
  const [field] = extractPlatformFields({ telemetry: [{ identifier: 'enabled', data_type: 'boolean' }] })
  assert.equal(field.type, 'boolean')
  assert.equal(field.dataType, 'telemetry')
})
