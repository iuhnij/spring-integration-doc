export type ComponentType =
  | 'DIRECT_CHANNEL'
  | 'QUEUE_CHANNEL'
  | 'ENRICH_HEADERS'
  | 'TRANSFORM'
  | 'SERVICE_ACTIVATOR'

export type ConfigFieldType = 'text' | 'textarea'

export interface ConfigField {
  field: string
  label: string
  type: ConfigFieldType
  required?: boolean
  placeholder?: string
}

export interface ComponentMeta {
  type: ComponentType
  label: string
  category: string
  description: string
  defaultConfig: Record<string, any>
  configSchema: ConfigField[]
}

export const componentRegistry: ComponentMeta[] = [
  {
    type: 'DIRECT_CHANNEL',
    label: 'DirectChannel',
    category: 'Channel',
    description: '同步点对点通道',
    defaultConfig: {
      label: 'DirectChannel',
      name: 'inputChannel'
    },
    configSchema: [
      {
        field: 'name',
        label: 'Channel名称',
        type: 'text',
        required: true
      }
    ]
  },
  {
    type: 'QUEUE_CHANNEL',
    label: 'QueueChannel',
    category: 'Channel',
    description: '队列通道',
    defaultConfig: {
      label: 'QueueChannel',
      name: 'queueChannel'
    },
    configSchema: [
      {
        field: 'name',
        label: 'Channel名称',
        type: 'text',
        required: true
      }
    ]
  },
  {
    type: 'ENRICH_HEADERS',
    label: 'EnrichHeaders',
    category: 'Message',
    description: '添加或修改消息 Header',
    defaultConfig: {
      label: 'EnrichHeaders',
      headersText: '{"traceId":"headers[\\"traceId\\"]"}'
    },
    configSchema: [
      {
        field: 'headersText',
        label: 'Header配置',
        type: 'textarea',
        required: true,
        placeholder: '{"traceId":"headers[\\"traceId\\"]"}'
      }
    ]
  },
  {
    type: 'TRANSFORM',
    label: 'Transform',
    category: 'Message',
    description: '转换消息 Payload',
    defaultConfig: {
      label: 'Transform',
      expression: 'payload'
    },
    configSchema: [
      {
        field: 'expression',
        label: '表达式',
        type: 'text',
        required: true
      }
    ]
  },
  {
    type: 'SERVICE_ACTIVATOR',
    label: 'ServiceActivator',
    category: 'Endpoint',
    description: '调用 Spring Bean 方法',
    defaultConfig: {
      label: 'ServiceActivator',
      beanName: 'demoService',
      methodName: 'handle'
    },
    configSchema: [
      {
        field: 'beanName',
        label: 'Bean名称',
        type: 'text',
        required: true
      },
      {
        field: 'methodName',
        label: '方法名',
        type: 'text',
        required: true
      }
    ]
  }
]

export function getComponentMeta(type: string) {
  return componentRegistry.find(item => item.type === type)
}