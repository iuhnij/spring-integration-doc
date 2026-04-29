<template>
  <div class="designer">
    <aside class="left-panel">
      <h3>组件</h3>

      <div
        v-for="group in groupedComponents"
        :key="group.category"
        class="component-group"
      >
        <div class="group-title">{{ group.category }}</div>

        <el-button
          v-for="component in group.items"
          :key="component.type"
          @click="addNode(component.type)"
        >
          {{ component.label }}
        </el-button>
      </div>

      <el-button type="primary" @click="handleExportJson">
        导出 JSON
      </el-button>
    </aside>

    <main class="canvas">
      <VueFlow
        v-model:nodes="nodes"
        v-model:edges="edges"
        fit-view-on-init
        @connect="onConnect"
        @node-click="onNodeClick"
      />
    </main>

    <aside class="right-panel">
      <h3>节点配置</h3>

      <div v-if="selectedNode">
        <el-form label-width="110px">
          <el-form-item label="节点ID">
            <el-input v-model="selectedNode.id" disabled />
          </el-form-item>

          <el-form-item label="组件类型">
            <el-input v-model="selectedNode.data.componentType" disabled />
          </el-form-item>

          <el-form-item label="显示名称">
            <el-input v-model="selectedNode.data.label" />
          </el-form-item>

          <template v-if="selectedComponentMeta">
            <el-form-item
              v-for="field in selectedComponentMeta.configSchema"
              :key="field.field"
              :label="field.label"
              :required="field.required"
            >
              <el-input
                v-if="field.type === 'text'"
                v-model="selectedNode.data[field.field]"
                :placeholder="field.placeholder"
              />

              <el-input
                v-else-if="field.type === 'textarea'"
                v-model="selectedNode.data[field.field]"
                type="textarea"
                :rows="4"
                :placeholder="field.placeholder"
              />
            </el-form-item>
          </template>
        </el-form>
      </div>

      <div v-else class="empty-config">
        请选择一个节点
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  VueFlow,
  MarkerType,
  type Connection,
  type Edge,
  type Node
} from '@vue-flow/core'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

import {
  componentRegistry,
  getComponentMeta,
  type ComponentType
} from './registry/componentRegistry'

import { exportFlowJson } from './utils/flowExporter'

const nodes = ref<Node[]>([])
const edges = ref<Edge[]>([])
const selectedNode = ref<any | null>(null)

let nodeIndex = 1

const groupedComponents = computed(() => {
  const map = new Map<string, typeof componentRegistry>()

  componentRegistry.forEach(component => {
    if (!map.has(component.category)) {
      map.set(component.category, [])
    }

    map.get(component.category)!.push(component)
  })

  return Array.from(map.entries()).map(([category, items]) => ({
    category,
    items
  }))
})

const selectedComponentMeta = computed(() => {
  const componentType = selectedNode.value?.data?.componentType
  if (!componentType) {
    return undefined
  }

  return getComponentMeta(componentType)
})

function addNode(componentType: ComponentType) {
  const meta = getComponentMeta(componentType)

  if (!meta) {
    return
  }

  const id = `node-${nodeIndex++}`

  nodes.value.push({
    id,
    position: {
      x: 150 + nodeIndex * 20,
      y: 120 + nodeIndex * 20
    },
    data: {
      componentType,
      ...meta.defaultConfig
    }
  })
}

function onConnect(connection: Connection) {
  if (!connection.source || !connection.target) {
    return
  }

  edges.value.push({
    id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
    markerEnd: MarkerType.ArrowClosed
  })
}

function onNodeClick(event: any) {
  selectedNode.value = event.node
}

function handleExportJson() {
  const flowJson = exportFlowJson(nodes.value as any[], edges.value as any[])

  console.log('导出的流程 JSON：')
  console.log(JSON.stringify(flowJson, null, 2))
}
</script>

<style scoped>
.designer {
  display: flex;
  height: 100vh;
}

.left-panel {
  width: 240px;
  padding: 16px;
  border-right: 1px solid #ddd;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.component-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-title {
  font-size: 13px;
  font-weight: bold;
  color: #666;
  margin-bottom: 4px;
}

.canvas {
  flex: 1;
}

.right-panel {
  width: 360px;
  padding: 16px;
  border-left: 1px solid #ddd;
}

.empty-config {
  color: #999;
  font-size: 14px;
}

.el-button {
  width: 100%;
}
</style>