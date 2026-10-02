declare namespace LX {
  namespace Vst3 {
    // 扫描分两个阶段：先遍历目录找出 .vst3 包，再逐个启动宿主进程探测插件信息。
    // 探测阶段每个插件都要新建一个宿主进程并加载模块，是耗时的主要来源。
    type ScanPhase = 'discover' | 'probe' | 'done'

    interface ScanProgress {
      phase: ScanPhase
      // discover 阶段：已访问的目录条目数
      visited?: number
      // 两个阶段共有：已发现的插件包数量
      found?: number
      // discover 阶段结束时为 true，表示目录遍历已完成，随后进入 probe 阶段
      done?: boolean
      // probe 阶段：已处理的插件数（含失败）/ 共几个
      current?: number
      total?: number
      path?: string
      name?: string
      vendor?: string
      error?: string
      // 距离扫描开始的毫秒数，用于展示已耗时
      elapsed?: number
    }

    interface ScanPlugin {
      path: string
      details: { info: { name: string, vendor: string } }
    }

    interface ScanWarning {
      path: string
      error: string
    }

    // scanPlugins 的原始返回值（仅插件与警告）
    interface ScanResult {
      plugins: ScanPlugin[]
      warnings: ScanWarning[]
    }

    // vst3_scan 的最终返回：附加本次扫描使用的目录信息，供渲染进程校验目录指纹
    interface ScanResponse extends ScanResult {
      directories: string[]
      customDirectories: string[]
    }
  }
}
