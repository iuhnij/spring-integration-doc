export function exportFlowJson(nodesValue: any[], edgesValue: any[]) {
  return {
    flowName: 'demoFlow',
    nodes: nodesValue.map(node => ({
      id: node.id,
      type: node.data?.componentType,
      label: node.data?.label,
      position: {
        x: node.position?.x ?? 0,
        y: node.position?.y ?? 0
      },
      config: {
        ...node.data
      }
    })),
    edges: edgesValue.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target
    }))
  }
}