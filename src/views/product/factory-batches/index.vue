<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  createFactoryBatch, enableFactoryUnit, getFactoryBatch, issueFactoryStationGrant,
  listFactoryBatches, previewFactoryConnection, restoreFactoryUnit, revokeFactoryStationGrant, setFactoryBatchStatus
} from '@/service/product/factory-batches';

type Batch = {
  batchId: string; productKey: string; platformProductKey?: string; plannedCount: number; claimed: number; proven: number;
  qcPassed: number; enabled: number; quarantined: number; status: string; createdAt: string;
};
type Unit = {
  deviceId: string; status: string; stationId?: string; burnVerified: boolean;
  proofVerified: boolean; qcPassed: boolean; traceId?: string; failureCode?: string;
  claimRequestId?: string; claimedAt?: number; claimExpiresAt?: number;
  connectionEvidence?: { apiBaseReadback?: string; endpointDiscoveryVersion?: number };
};
type StationGrant = { grantId: number; stationId: string; expiresAt: number; revokedAt: number | null };

const route = useRoute();
const router = useRouter();
const productKey = computed(() => String(route.query.productKey || ''));
const productName = computed(() => String(route.query.productName || productKey.value));
const batches = ref<Batch[]>([]);
const units = ref<Unit[]>([]);
const stationGrants = ref<StationGrant[]>([]);
const selected = ref('');
const page = ref(1);
const unitPage = ref(1);
const unitStatus = ref('');
const loading = ref(false);
const detailLoading = ref(false);
const error = ref('');
const createOpen = ref(false);
const grantOpen = ref(false);
const grantToken = ref('');
const grantRequestId = ref('');
const restoreOpen = ref(false);
const restoring = ref(false);
const restoreUnit = ref<Unit | null>(null);
const restoreReason = ref('');
const restoreConfirmed = ref(false);
const restoreRequestId = ref('');
const creating = ref(false);
const granting = ref(false);
const changing = ref('');
const enabling = ref('');
const revoking = ref(0);
const createRequestId = ref('');
const selectedBatch = computed(() => batches.value.find(item => item.batchId === selected.value));
const totals = computed(() => batches.value.reduce((result, item) => ({
  planned: result.planned + item.plannedCount, enabled: result.enabled + item.enabled,
  quarantined: result.quarantined + item.quarantined
}), { planned: 0, enabled: 0, quarantined: 0 }));

const createForm = reactive({ batchId: '', serialPrefix: '', count: 100, keyStorage: 'flash', apiBase: '', connectionConfirmed: false });
const connectionPreview = ref<any>(null);
const connectionConfig = ref<any>(null);
const currentDirectory = ref<any>(null);
const checking = ref(false);
const checkingCurrent = ref(false);
const connectionError = ref('');
const currentError = ref('');
let previewAttempt = 0;
watch(createOpen, open => {
  if (!open) {
    previewAttempt++;
    checking.value = false;
    connectionPreview.value = null;
    createForm.connectionConfirmed = false;
    connectionError.value = '';
  }
});
watch(() => [createForm.apiBase, productKey.value], () => {
  connectionPreview.value = null;
  createForm.connectionConfirmed = false;
  connectionError.value = '';
  createRequestId.value = '';
});
async function checkConnection() {
  const base = createForm.apiBase;
  const product = productKey.value;
  if (checking.value || !base) return;
  const attempt = ++previewAttempt;
  checking.value = true;
  connectionPreview.value = null;
  createForm.connectionConfirmed = false;
  connectionError.value = '';
  try {
    const { data, error: requestError } = await previewFactoryConnection({ productKey: product, apiBase: base });
    if (requestError || !data) throw new Error(requestError?.response?.data?.message || '地址检查失败');
    if (attempt === previewAttempt && createOpen.value && createForm.apiBase === base && productKey.value === product) connectionPreview.value = data;
  } catch (cause) {
    if (attempt === previewAttempt && createForm.apiBase === base) connectionError.value = cause instanceof Error ? cause.message : '地址检查失败';
  } finally { if (attempt === previewAttempt) checking.value = false; }
}
async function refreshDirectory() {
  const batch = selected.value;
  const config = connectionConfig.value;
  if (!config || checkingCurrent.value) return;
  checkingCurrent.value = true;
  currentDirectory.value = null;
  currentError.value = '';
  try {
    const { data, error: requestError } = await previewFactoryConnection({ productKey: productKey.value, apiBase: config.apiBase });
    if (requestError || !data) throw new Error(requestError?.response?.data?.message || '当前目录检查失败');
    if (selected.value === batch) currentDirectory.value = data;
  } catch (cause) {
    if (selected.value === batch) currentError.value = cause instanceof Error ? cause.message : '当前目录检查失败';
  } finally { checkingCurrent.value = false; }
}
function copyConfiguration() {
  if (!connectionConfig.value) return;
  navigator.clipboard.writeText(JSON.stringify({ apiBase: connectionConfig.value.apiBase, productKey: selectedBatch.value?.productKey, endpointDiscoveryVersion: 1 }, null, 2))
    .then(() => window.$message?.success('已复制非敏感配置'))
    .catch(() => window.$message?.error('复制失败，请手动复制地址'));
}
function newBatchFromConfiguration() {
  createForm.apiBase = connectionConfig.value?.apiBase || '';
  createForm.batchId = '';
  createForm.serialPrefix = '';
  connectionPreview.value = null;
  createForm.connectionConfirmed = false;
  createOpen.value = true;
}

watch(() => [createForm.batchId, createForm.serialPrefix, createForm.count, createForm.keyStorage, createForm.apiBase], () => {
  if (!creating.value) createRequestId.value = '';
});
const grantForm = reactive({ stationId: '' });
watch(() => grantForm.stationId, () => {
  if (!granting.value) grantRequestId.value = '';
});
const statusOptions = [
  { label: '全部状态', value: '' }, { label: '待领取', value: 'AVAILABLE' },
  { label: '已领取', value: 'CLAIMED' }, { label: '质检通过', value: 'QC_PASSED' },
  { label: '已启用', value: 'ENABLED' }, { label: '异常隔离', value: 'QUARANTINED' }
];
const statusText: Record<string, string> = {
  READY: '生产中', PAUSED: '已暂停', CLOSED: '已关闭', AVAILABLE: '待领取',
  CLAIMED: '已领取', QC_PASSED: '质检通过', ENABLED: '已启用', QUARANTINED: '异常隔离'
};

async function loadBatches() {
  if (!productKey.value) {
    error.value = '产品缺少 productKey，无法管理出厂身份';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const { data, error: requestError } = await listFactoryBatches({ productKey: productKey.value, page: page.value });
    if (requestError || !data) throw new Error('批次加载失败，请检查服务权限和连接');
    batches.value = data.items || [];
    if (selected.value && !batches.value.some(item => item.batchId === selected.value)) {
      selected.value = '';
      units.value = [];
    }
  } catch (cause) {
    batches.value = [];
    selected.value = '';
    units.value = [];
    stationGrants.value = [];
    error.value = cause instanceof Error ? cause.message : '批次加载失败';
  } finally {
    loading.value = false;
  }
}

async function loadDetail() {
  if (!selected.value) return;
  const requestedBatch = selected.value;
  detailLoading.value = true;
  try {
    const { data, error: requestError } = await getFactoryBatch(selected.value, {
      page: unitPage.value, status: unitStatus.value || undefined
    });
    if (requestError || !data) throw new Error('设备明细加载失败');
    if (selected.value !== requestedBatch) return;
    connectionConfig.value = data.connectionConfig || null;
    units.value = data.items || [];
    stationGrants.value = data.stationGrants || [];
  } catch (cause) {
    if (selected.value !== requestedBatch) return;
    units.value = [];
    stationGrants.value = [];
    window.$message?.error(cause instanceof Error ? cause.message : '设备明细加载失败');
  } finally {
    if (selected.value === requestedBatch) detailLoading.value = false;
  }
}

function selectBatch(batchId: string) {
  selected.value = batchId;
  connectionConfig.value = null;
  currentDirectory.value = null;
  currentError.value = '';
  unitPage.value = 1;
  unitStatus.value = '';
  loadDetail();
}

async function createBatch() {
  if (creating.value) return;
  if (!createForm.batchId || !createForm.serialPrefix || !Number.isInteger(createForm.count)) {
    window.$message?.error('请填写批次编号、设备编号前缀和计划数量');
    return;
  }
  if (!connectionPreview.value || !createForm.connectionConfirmed) {
    window.$message?.error('请先检查服务地址并完成人工核对');
    return;
  }
  creating.value = true;
  createRequestId.value ||= crypto.randomUUID();
  try {
    const { error: requestError } = await createFactoryBatch({
      batchId: createForm.batchId, productKey: productKey.value,
      serialPrefix: createForm.serialPrefix, count: createForm.count,
      keyStorage: createForm.keyStorage, requestId: createRequestId.value,
      apiBase: createForm.apiBase, connectionConfirmed: createForm.connectionConfirmed
    });
    if (requestError) throw new Error(requestError.response?.data?.message || '创建失败；请核对批次编号、编号段及服务状态');
    createOpen.value = false;
    createRequestId.value = '';
    window.$message?.success('批次已预登记');
    await loadBatches();
  } catch (cause) {
    window.$message?.error(cause instanceof Error ? cause.message : '创建失败');
  } finally {
    creating.value = false;
  }
}

async function changeStatus(batch: Batch, status: 'READY' | 'PAUSED' | 'CLOSED') {
  if (changing.value) return;
  changing.value = batch.batchId;
  try {
    const { error: requestError } = await setFactoryBatchStatus(batch.batchId, status);
    if (requestError) throw new Error('批次状态更新失败');
    await loadBatches();
  } catch (cause) {
    window.$message?.error(cause instanceof Error ? cause.message : '批次状态更新失败');
  } finally {
    changing.value = '';
  }
}

async function grantStation() {
  if (granting.value) return;
  if (!selected.value || !/^[A-Za-z0-9_.:-]{1,64}$/.test(grantForm.stationId)) {
    window.$message?.error('请选择批次；工位编号限 1–64 位英文字母、数字、点、下划线、冒号或连字符，例如 station-001');
    return;
  }
  granting.value = true;
  grantRequestId.value ||= crypto.randomUUID();
  try {
    const { data, error: requestError } = await issueFactoryStationGrant(selected.value, {
      stationId: grantForm.stationId, durationSeconds: 86400,
      requestId: grantRequestId.value
    });
    if (requestError || !data?.token) throw new Error('签发状态未确认；请刷新授权列表核对，必要时撤销后重签');
    grantToken.value = data.token;
    await loadDetail();
  } catch (cause) {
    window.$message?.error(cause instanceof Error ? cause.message : '工位授权签发失败');
  } finally {
    granting.value = false;
  }
}

function formatDeadline(seconds?: number | null) {
  return seconds ? new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(new Date(seconds * 1000)) : '—';
}

function openRestore(unit: Unit) {
  restoreUnit.value = unit;
  restoreReason.value = '';
  restoreConfirmed.value = false;
  restoreRequestId.value = crypto.randomUUID();
  restoreOpen.value = true;
}

async function restoreCurrentUnit() {
  const unit = restoreUnit.value;
  if (!selected.value || !unit?.stationId || !unit.claimRequestId || !restoreConfirmed.value || restoreReason.value.trim().length < 4) {
    window.$message?.error('请确认工厂尚未烧录，并填写至少 4 个字的恢复原因');
    return;
  }
  restoring.value = true;
  try {
    const { error: requestError } = await restoreFactoryUnit(selected.value, unit.deviceId, {
      stationId: unit.stationId, claimRequestId: unit.claimRequestId,
      recoveryId: restoreRequestId.value, reason: restoreReason.value.trim(),
      unburnedConfirmed: true
    });
    if (requestError) throw new Error(requestError.response?.data?.message || '恢复失败，请核对设备状态和工厂确认');
    restoreOpen.value = false;
    window.$message?.success('原设备领取窗口已恢复；请核对工位授权期限后继续原请求');
    await loadDetail();
  } catch (cause) {
    window.$message?.error(cause instanceof Error ? cause.message : '恢复失败');
  } finally {
    restoring.value = false;
  }
}

async function revokeStation(grantId: number) {
  if (!selected.value || revoking.value) return;
  revoking.value = grantId;
  try {
    const { error: requestError } = await revokeFactoryStationGrant(selected.value, grantId);
    if (requestError) throw new Error('撤销工位授权失败');
    await loadDetail();
    window.$message?.success('工位授权已撤销');
  } catch (cause) {
    window.$message?.error(cause instanceof Error ? cause.message : '撤销工位授权失败');
  } finally {
    revoking.value = 0;
  }
}

function closeGrant() {
  grantToken.value = '';
  grantRequestId.value = '';
  grantForm.stationId = '';
  grantOpen.value = false;
}

function closeCreate() {
  connectionPreview.value = null;
  createForm.connectionConfirmed = false;
  createOpen.value = false;
  createRequestId.value = '';
}

async function enableUnit(unit: Unit) {
  if (!selected.value || enabling.value) return;
  enabling.value = unit.deviceId;
  try {
    const { error: requestError } = await enableFactoryUnit(selected.value, unit.deviceId);
    if (requestError) throw new Error('启用失败；请核对真机证明和质检结果');
    window.$message?.success('身份已启用；设备首次联网后才会激活');
    await Promise.all([loadBatches(), loadDetail()]);
  } catch (cause) {
    window.$message?.error(cause instanceof Error ? cause.message : '启用失败');
  } finally {
    enabling.value = '';
  }
}

onMounted(loadBatches);
</script>

<template>
  <div class="factory-page">
    <n-card :bordered="false" class="factory-card">
      <div class="factory-header">
        <div>
          <h2>{{ productName }} 出厂预制管理</h2>
          <p>幽光生成设备编号与独立密钥，工厂按授权批次逐台领取</p>
        </div>
        <n-space>
          <n-button type="primary" @click="createOpen = true">创建批次</n-button>
          <n-button :disabled="!selected || selectedBatch?.status !== 'READY'" @click="grantOpen = true">工位授权</n-button>
          <n-button @click="router.back()">返回产品列表</n-button>
        </n-space>
      </div>

      <n-alert v-if="error" type="error" class="factory-error">{{ error }}</n-alert>
      <div class="factory-stats">
        <div><span>本页批次数</span><strong>{{ batches.length }}</strong></div>
        <div><span>本页已预置</span><strong>{{ totals.planned }}</strong></div>
        <div><span>本页已启用</span><strong>{{ totals.enabled }}</strong></div>
        <div><span>本页异常隔离</span><strong>{{ totals.quarantined }}</strong></div>
      </div>

      <div class="factory-filter">
        <span>平台产品标识：{{ productKey }}　设备协议标识：{{ selectedBatch?.productKey || '选择批次查看' }}</span>
        <n-button :loading="loading" @click="loadBatches">刷新批次</n-button>
      </div>
      <n-spin :show="loading">
        <div class="factory-scroll">
          <table class="factory-table">
            <thead><tr><th>批次编号</th><th>计划数量</th><th>已领取</th><th>证明通过</th><th>质检通过</th><th>已启用</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="batch in batches" :key="batch.batchId" :class="{ selected: selected === batch.batchId }">
                <td>{{ batch.batchId }}</td><td>{{ batch.plannedCount }}</td><td>{{ batch.claimed }}</td>
                <td>{{ batch.proven }}</td><td>{{ batch.qcPassed }}</td><td>{{ batch.enabled }}</td>
                <td>{{ statusText[batch.status] || batch.status }}</td><td>{{ batch.createdAt }}</td>
                <td class="factory-actions">
                  <n-button size="small" @click="selectBatch(batch.batchId)">查看设备</n-button>
                  <n-popconfirm v-if="batch.status !== 'CLOSED'" @positive-click="changeStatus(batch, batch.status === 'READY' ? 'PAUSED' : 'READY')">
                    <template #trigger><n-button size="small" :loading="changing === batch.batchId" :disabled="!!changing" :type="batch.status === 'READY' ? 'warning' : 'primary'">{{ batch.status === 'READY' ? '暂停领取' : '恢复领取' }}</n-button></template>
                    确认更改该批次的领取状态？
                  </n-popconfirm>
                </td>
              </tr>
              <tr v-if="!loading && batches.length === 0"><td colspan="9" class="factory-empty">暂无批次，先创建出厂预制批次</td></tr>
            </tbody>
          </table>
        </div>
      </n-spin>
      <div class="factory-pager"><n-button :disabled="page <= 1" @click="page--; loadBatches()">上一页</n-button><span>第 {{ page }} 页</span><n-button :disabled="batches.length < 20" @click="page++; loadBatches()">下一页</n-button></div>

      <div v-if="selected" class="factory-detail">
        <div class="factory-detail-heading"><h3>批次详情 {{ selected }}</h3><n-select v-model:value="unitStatus" :options="statusOptions" style="width: 170px" @update:value="unitPage = 1; loadDetail()" /></div>
        <n-card size="small" title="本批次出厂配置" class="factory-connection">
          <template v-if="connectionConfig">
            <p>服务基础地址：<code>{{ connectionConfig.apiBase }}</code>（{{ connectionConfig.environment }}）</p>
            <p>动态发现版本：{{ connectionConfig.endpointDiscoveryVersion }} · 核对时间：{{ formatDeadline(connectionConfig.checkedAt) }}（北京时间）</p>
            <p>设备编号与密钥每台独立；密钥不展示。创建后地址固定，实际写入以设备读回为准。</p>
            <n-space><n-button size="small" @click="copyConfiguration">复制非敏感配置</n-button><n-button size="small" @click="newBatchFromConfiguration">按此配置创建新批次</n-button><n-button size="small" :loading="checkingCurrent" @click="refreshDirectory">查看当前接口目录</n-button></n-space>
            <n-alert v-if="currentError" type="error">{{ currentError }}</n-alert>
            <div v-if="currentDirectory" class="factory-endpoints"><p>当前目录 · {{ formatDeadline(currentDirectory.checkedAt) }}（北京时间）</p><div>activate：{{ currentDirectory.activateUrl }}</div><div v-for="(url, name) in currentDirectory.interfaceUrls" :key="name">{{ name }}：{{ url }}</div></div>
            <n-collapse v-else><n-collapse-item title="核对时目录（历史快照）"><div class="factory-endpoints"><div>activate：{{ connectionConfig.activateUrl }}</div><div v-for="(url, name) in connectionConfig.interfaceUrls" :key="name">{{ name }}：{{ url }}</div></div></n-collapse-item></n-collapse>
          </template>
          <n-alert v-else type="info">旧流程未记录服务地址；请以设备实际读回为准。</n-alert>
        </n-card>
        <div class="factory-scroll"><table class="factory-table">
          <thead><tr><th>最近工位授权</th><th>有效期至</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="grant in stationGrants" :key="grant.grantId">
              <td>{{ grant.stationId }}</td>
              <td>{{ formatDeadline(grant.expiresAt) }}（北京时间）</td>
              <td>{{ grant.revokedAt ? '已撤销' : grant.expiresAt <= Date.now() / 1000 ? '已过期' : '有效' }}</td>
              <td><n-popconfirm v-if="!grant.revokedAt && grant.expiresAt > Date.now() / 1000" @positive-click="revokeStation(grant.grantId)"><template #trigger><n-button size="small" type="warning" :loading="revoking === grant.grantId" :disabled="!!revoking">撤销授权</n-button></template>撤销后该工位令牌立即失效，确认撤销？</n-popconfirm></td>
            </tr>
            <tr v-if="stationGrants.length === 0"><td colspan="4" class="factory-empty">暂无工位授权</td></tr>
          </tbody>
        </table></div>
        <n-spin :show="detailLoading">
          <div class="factory-scroll"><table class="factory-table">
            <thead><tr><th>设备编号</th><th>工位</th><th>领取请求</th><th>资料重取截止</th><th>读回校验</th><th>地址读回 / 发现能力</th><th>真机证明</th><th>质检</th><th>状态</th><th>追溯号 / 失败码</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="unit in units" :key="unit.deviceId">
                <td>{{ unit.deviceId }}</td><td>{{ unit.stationId || '—' }}</td>
                <td>{{ unit.claimRequestId || '—' }}</td><td>{{ formatDeadline(unit.claimExpiresAt) }}</td>
                <td>{{ unit.burnVerified ? '通过' : '待完成' }}</td><td>{{ unit.connectionEvidence?.apiBaseReadback || '未上报' }} / {{ unit.connectionEvidence?.endpointDiscoveryVersion ?? '未上报' }}</td><td>{{ unit.proofVerified ? '通过' : '待完成' }}</td>
                <td>{{ unit.qcPassed ? '通过' : '待完成' }}</td><td>{{ statusText[unit.status] || unit.status }}</td>
                <td>{{ unit.traceId || unit.failureCode || '—' }}</td>
                <td><n-popconfirm v-if="unit.status === 'QC_PASSED' && unit.proofVerified" @positive-click="enableUnit(unit)"><template #trigger><n-button size="small" type="primary" :loading="enabling === unit.deviceId" :disabled="!!enabling">启用身份</n-button></template>确认该真机证明和质检均通过后启用身份？</n-popconfirm><n-button v-if="unit.status === 'CLAIMED' && !unit.burnVerified && !unit.proofVerified && !unit.qcPassed" size="small" @click="openRestore(unit)">恢复当前台</n-button></td>
              </tr>
              <tr v-if="!detailLoading && units.length === 0"><td colspan="11" class="factory-empty">此筛选下暂无设备</td></tr>
            </tbody>
          </table></div>
        </n-spin>
        <div class="factory-pager"><n-button :disabled="unitPage <= 1" @click="unitPage--; loadDetail()">上一页</n-button><span>第 {{ unitPage }} 页</span><n-button :disabled="units.length < 50" @click="unitPage++; loadDetail()">下一页</n-button></div>
      </div>
      <n-alert type="info" class="factory-notice">密钥仅通过受控工位 API 交付，后台不显示 authKey 明文。身份启用不等于用户首次联网激活。</n-alert>
    </n-card>

    <n-modal v-model:show="createOpen" :mask-closable="!creating"><n-card title="创建出厂预制批次" class="factory-modal" :closable="!creating" @close="closeCreate">
      <n-form label-placement="left" label-width="110" :disabled="creating">
        <n-form-item label="批次编号"><n-input v-model:value="createForm.batchId" placeholder="例如 A100-260929-01" /></n-form-item>
        <n-form-item label="设备编号前缀"><n-input v-model:value="createForm.serialPrefix" placeholder="例如 A100-260929" /></n-form-item>
        <n-form-item label="计划数量"><n-input-number v-model:value="createForm.count" :min="1" :max="500" /></n-form-item>
        <n-form-item label="密钥存储"><n-select v-model:value="createForm.keyStorage" :options="[{ label: 'Flash（A100 当前工位）', value: 'flash' }, { label: '硬件安全存储（需专用工位）', value: 'hardware', disabled: true }]" /></n-form-item>
        <n-form-item label="服务基础地址"><n-input v-model:value="createForm.apiBase" placeholder="例如 https://yomitest.gwcz.online，不含接口路径" /></n-form-item>
        <n-form-item><n-button :loading="checking" :disabled="!createForm.apiBase || creating" @click="checkConnection">检查并预览</n-button></n-form-item>
        <n-alert v-if="connectionError" type="error">{{ connectionError }}</n-alert>
        <div v-if="connectionPreview" class="factory-endpoints">
          <p>最终写入：{{ connectionPreview.apiBase }}（{{ connectionPreview.environment }}）</p>
          <p>固定发现入口：{{ connectionPreview.apiBase }}/ydp/v1/bootstrap</p>
          <p>下列地址由云端返回，固件动态使用：</p>
          <div>activate：{{ connectionPreview.activateUrl }}</div>
          <div v-for="(url, name) in connectionPreview.interfaceUrls" :key="name">{{ name }}：{{ url }}</div>
          <p>发现契约检查通过；不代表设备已写入或激活。</p>
          <n-checkbox v-model:checked="createForm.connectionConfirmed">已核对环境、产品及出厂写入地址</n-checkbox>
        </div>
      </n-form>
      <n-alert type="warning">创建后由幽光云端生成每台唯一编号和独立密钥；批次编号及前缀不可修改。</n-alert>
      <template #footer><n-space justify="end"><n-button :disabled="creating" @click="closeCreate">取消</n-button><n-button type="primary" :loading="creating" :disabled="!connectionPreview || !createForm.connectionConfirmed || checking" @click="createBatch">确认创建</n-button></n-space></template>
    </n-card></n-modal>

    <n-modal :show="grantOpen" :mask-closable="!granting" @update:show="value => { if (!value) closeGrant(); }"><n-card title="工位授权" class="factory-modal" :closable="!granting" @close="closeGrant">
      <p>授权批次：{{ selected }}</p>
      <template v-if="!grantToken"><n-form label-placement="left" label-width="110">
        <n-form-item label="工位编号"><n-input v-model:value="grantForm.stationId" placeholder="例如 station-001（仅英文字母、数字及 ._:-）" /></n-form-item>
        <n-form-item label="有效期">测试工位 24 小时（由服务端计时）</n-form-item>
      </n-form><n-alert type="warning">令牌只在签发成功时展示一次；请通过受控渠道交给对应工位。</n-alert></template>
      <template v-else><n-alert type="success">工位令牌已签发，仅本次可见。关闭后无法在后台重新查看。</n-alert><pre class="factory-token">{{ grantToken }}</pre></template>
      <template #footer><n-space justify="end"><n-button :disabled="granting" @click="closeGrant">关闭</n-button><n-button v-if="!grantToken" type="primary" :loading="granting" @click="grantStation">签发授权</n-button></n-space></template>
    </n-card></n-modal>

    <n-modal v-model:show="restoreOpen" :mask-closable="!restoring"><n-card title="恢复当前台资料重取" class="factory-modal" :closable="!restoring" @close="restoreOpen = false">
      <p>设备：{{ restoreUnit?.deviceId }}　工位：{{ restoreUnit?.stationId }}</p>
      <p>原请求：{{ restoreUnit?.claimRequestId }}</p>
      <p>当前截止：{{ formatDeadline(restoreUnit?.claimExpiresAt) }}（北京时间）</p>
      <n-alert type="warning">仅在厂商确认尚未烧录时使用。恢复保留原设备编号与请求号，不自动续签工位令牌。</n-alert>
      <n-input v-model:value="restoreReason" type="textarea" placeholder="填写厂商确认情况与恢复原因" style="margin: 16px 0" />
      <n-checkbox v-model:checked="restoreConfirmed">厂商已确认此台尚未烧录，且当前连接的是原设备</n-checkbox>
      <template #footer><n-space justify="end"><n-button :disabled="restoring" @click="restoreOpen = false">取消</n-button><n-button type="primary" :loading="restoring" @click="restoreCurrentUnit">恢复原请求</n-button></n-space></template>
    </n-card></n-modal>
  </div>
</template>

<style scoped>
.factory-page { padding: 16px; background: #f5f7fa; min-height: 100%; }
.factory-card { max-width: 1500px; margin: auto; }
.factory-header, .factory-filter, .factory-detail-heading, .factory-pager { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.factory-header h2 { margin: 0; font-size: 22px; }
.factory-header p { margin: 6px 0 0; color: #667085; }
.factory-error, .factory-notice { margin-top: 16px; }
.factory-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 24px 0; }
.factory-stats div { border: 1px solid #e5e7ef; border-radius: 8px; padding: 16px; background: #fff; }
.factory-stats span { display: block; color: #667085; }
.factory-stats strong { display: block; font-size: 25px; margin-top: 5px; }
.factory-filter { margin-bottom: 14px; }
.factory-scroll { overflow-x: auto; }
.factory-table { border-collapse: collapse; width: 100%; min-width: 1020px; }
.factory-table th, .factory-table td { padding: 12px; text-align: left; border-bottom: 1px solid #e9eaf1; white-space: nowrap; }
.factory-table th { background: #f7f8fb; font-weight: 600; }
.factory-table tr.selected { background: #f2efff; }
.factory-actions { display: flex; gap: 8px; }
.factory-empty { text-align: center !important; color: #8d94a5; padding: 32px !important; }
.factory-pager { justify-content: flex-end; margin-top: 14px; }
.factory-detail { border-top: 1px solid #e9eaf1; margin-top: 22px; padding-top: 16px; }
.factory-detail h3 { margin: 0 0 14px; font-size: 17px; }
.factory-modal { width: min(760px, calc(100vw - 32px)); }
.factory-connection { margin: 12px 0; }
.factory-endpoints { overflow-wrap: anywhere; line-height: 1.8; margin: 12px 0; }
.factory-token { overflow-wrap: anywhere; white-space: pre-wrap; background: #f5f7fa; padding: 12px; border-radius: 6px; }
@media (max-width: 900px) { .factory-header { flex-direction: column; align-items: flex-start; } .factory-stats { grid-template-columns: repeat(2, 1fr); } }
</style>
