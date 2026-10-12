import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = fs.readFileSync(new URL('../src/utils/thingsvis/thingsvis-auth.ts', import.meta.url), 'utf8')
const script = ts.transpileModule(source.replaceAll('import.meta.env', '__env'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

for (const secure of [true, false]) {
  const calls = []
  const context = {
    exports: {}, Error, TypeError, Date, setTimeout,
    console: { log() {}, warn() {}, error() {} },
    __env: { VITE_THINGSVIS_SECURE_SSO: secure ? 'Y' : 'N', VITE_BASE_URL: '/tp/' },
    fetch: async (...args) => { calls.push(args); throw new TypeError('Failed to fetch') },
    require: name => {
      if (name === '@/utils/storage') return { localStg: { get: key => key === 'token' ? 'tp-token' : { userId: 'owner', email: 'owner@example.com', tenantId: 'owned' } } }
      if (name === './constants') return { THINGSVIS_API_PROXY_PATH: '/thingsvis-api' }
      if (name === './space') return { resolveThingsVisSpaceId: () => 'owned' }
      throw new Error(`未声明测试依赖: ${name}`)
    }
  }
  vm.runInNewContext(script, context)
  await assert.rejects(context.exports.getThingsVisToken(), /unavailable/)
  assert.equal(calls[0][0], secure ? '/tp/api/v1/thingsvis/auth/sso' : '/thingsvis-api/auth/sso')
  if (secure) assert.equal(calls[0][1].headers['x-token'], 'tp-token')
  await assert.rejects(context.exports.getThingsVisToken(), /retry in/)
  assert.equal(calls.length, 1)
}
console.log('生产身份交换入口、登录凭据与兼容模式/失败冷却检查通过')
