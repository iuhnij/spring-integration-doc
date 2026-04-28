<template>
  <div class="designer">
    <aside class="left-panel">
      <h3>组件</h3>

      <el-button @click="addNode('DIRECT_CHANNEL')">DirectChannel</el-button>
      <el-button @click="addNode('QUEUE_CHANNEL')">QueueChannel</el-button>
      <el-button @click="addNode('ENRICH_HEADERS')">EnrichHeaders</el-button>
      <el-button @click="addNode('TRANSFORM')">Transform</el-button>
      <el-button @click="addNode('SERVICE_ACTIVATOR')">ServiceActivator</el-button>

      <el-button type="primary" @click="exportJson">导出 JSON</el-button>
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
        <el-form label-width="100px">
          <el-form-item label="节点ID">
            <el-input v-model="selectedNode.id" disabled />
          </el-form-item>

          <el-form-item label="组件类型">
            <el-input v-model="selectedNode.data.componentType" disabled />
          </el-form-item>

          <el-form-item label="显示名称">
            <el-input v-model="selectedNode.data.label" />
          </el-form-item>

          <el-form-item
            v-if="selectedNode.data.componentType === 'TRANSFORM'"
            label="表达式"
          >
            <el-input v-model="selectedNode.data.expression" />
          </el-form-item>

          <el-form-item
            v-if="selectedNode.data.componentType === 'SERVICE_ACTIVATOR'"
            label="Bean名称"
          >
            <el-input v-model="selectedNode.data.beanName" />
          </el-form-item>

          <el-form-item
            v-if="selectedNode.data.componentType === 'SERVICE_ACTIVATOR'"
            label="方法名"
          >
            <el-input v-model="selectedNode.data.methodName" />
          </el-form-item>

          <el-form-item
            v-if="selectedNode.data.componentType === 'ENRICH_HEADERS'"
            label="Header"
          >
            <el-input
              v-model="selectedNode.data.headersText"
              type="textarea"
              placeholder='例如：{"traceId":"headers[\"traceId\"]"}'
            />
          </el-form-item>
        </el-form>
      </div>

      <div v-else>请选择一个节点</div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { VueFlow, useVueFlow, type Node, type Edge, type Connection } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

const nodes = ref<Node[]>([])
const edges = ref<Edge[]>([])
const selectedNode = ref<Node | null>(null)

const { addEdges } = useVueFlow()

let nodeIndex = 1

function addNode(componentType: string) {
  const id = `node-${nodeIndex++}`

  nodes.value.push({
    id,
    position: {
      x: 120 + nodeIndex * 20,
      y: 100 + nodeIndex * 20
    },
    data: createNodeData(componentType)
  })
}

function createNodeData(componentType: string) {
  if (componentType === 'DIRECT_CHANNEL') {
    return {
      label: 'DirectChannel',
      componentType,
      name: 'inputChannel'
    }
  }

  if (componentType === 'QUEUE_CHANNEL') {
    return {
      label: 'QueueChannel',
      componentType,
      name: 'queueChannel'
    }
  }

  if (componentType === 'ENRICH_HEADERS') {
    return {
      label: 'EnrichHeaders',
      componentType,
      headersText: '{"traceId":"headers[\\"traceId\\"]"}'
    }
  }

  if (componentType === 'TRANSFORM') {
    return {
      label: 'Transform',
      componentType,
      expression: 'payload'
    }
  }

  if (componentType === 'SERVICE_ACTIVATOR') {
    return {
      label: 'ServiceActivator',
      componentType,
      beanName: 'demoService',
      methodName: 'handle'
    }
  }

  return {
    label: componentType,
    componentType
  }
}

function onConnect(connection: Connection) {
  addEdges({
    ...connection,
    id: `edge-${connection.source}-${connection.target}`
  })
}

function onNodeClick(event: any) {
  selectedNode.value = event.node
}

function exportJson() {
  const flowJson = {
    flowName: 'demoFlow',
    nodes: nodes.value.map(node => ({
      id: node.id,
      type: node.data.componentType,
      position: node.position,
      config: { ...node.data }
    })),
    edges: edges.value.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target
    }))
  }

  console.log(JSON.stringify(flowJson, null, 2))
}
</script>

<style scoped>
.designer {
  display: flex;
  height: 100vh;
}

.left-panel {
  width: 220px;
  padding: 16px;
  border-right: 1px solid #ddd;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.canvas {
  flex: 1;
}

.right-panel {
  width: 320px;
  padding: 16px;
  border-left: 1px solid #ddd;
}

.el-button {
  width: 100%;
}
</style>
