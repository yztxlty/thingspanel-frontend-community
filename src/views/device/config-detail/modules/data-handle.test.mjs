import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('./data-handle.vue', import.meta.url), 'utf8').match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
const ast = ts.createSourceFile('data-handle.ts', source, ts.ScriptTarget.Latest, true)
const declaration = ast.statements.filter(ts.isVariableStatement)
  .flatMap(statement => [...statement.declarationList.declarations])
  .find(node => node.name.getText(ast) === 'doQuiz')
const code = ts.transpileModule(`const doQuiz = ${declaration.initializer.getText(ast)}; globalThis.runQuiz = doQuiz`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText

async function run(response) {
  const configForm = { value: { resolt_analog_input: '' } }
  const context = { configForm, configFormRef: { value: { validate: async () => {} } },
    dataScriptQuiz: async () => response, t: key => key, console }
  vm.runInNewContext(code, context)
  await context.runQuiz()
  return configForm.value.resolt_analog_input
}

test('脚本调试从请求封装的data读取业务成功响应', async () => {
  assert.equal(await run({ data: { code: 200, data: 'decoded' }, error: null }), 'decoded')
  assert.equal(await run({ data: { code: '200', data: null }, error: null }), 'page.dataForward.debugSuccessWithNull')
})

test('脚本调试保留业务失败与网络错误显示', async () => {
  assert.match(await run({ data: { code: 400, message: '脚本非法' }, error: null }), /code: 400\nmessage: 脚本非法/)
  assert.match(await run({ data: null, error: { message: '网络断开', code: 'NETWORK', name: 'Error' } }), /NETWORK[\s\S]*网络断开/)
})
