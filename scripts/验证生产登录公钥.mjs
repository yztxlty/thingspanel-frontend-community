import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

let publicKey
class Encrypt { setPublicKey(value) { publicKey=value } encrypt() { return 'ciphertext' } }
const source=fs.readFileSync(new URL('../src/utils/common/tool.ts',import.meta.url),'utf8')
const script=ts.transpileModule(source.replaceAll('import.meta.env','__env'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const context={exports:{},__env:{},console,require:name=>{
 if(name==='jsencrypt') return {default:Encrypt}
 if(name==='@/config/security/rsa') return {rsaPublicKey:'legacy-public-key',getRSAPublicKey:()=> 'production-public-key'}
 if(name==='@/constants/common') return {STATIC_BASE_URL:''}
 if(name==='@/locales') return {$t:value=>value}
 if(name==='./discrete') return {message:{}}
 if(name==='~/env.config') return {createServiceConfig:()=>({})}
 throw new Error('未声明依赖：'+name)
}}
vm.runInNewContext(script,context)
assert.equal(context.exports.encryptDataByRsa('password'),'ciphertext')
assert.equal(publicKey,'production-public-key')
console.log('实际共享登录加密函数使用生产配置公钥，通过')
