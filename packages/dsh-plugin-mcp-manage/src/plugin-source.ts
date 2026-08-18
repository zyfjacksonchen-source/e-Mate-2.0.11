const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u
const PINNED_GITHUB = /^github:(?<owner>[A-Za-z0-9-]{1,39})\/(?<repo>[A-Za-z0-9._-]{1,100})#(?<commit>[0-9a-f]{40})$/u

export function validatePluginPackageName(packageName: string): void {
  if (!PACKAGE_NAME.test(packageName)) throw new Error('DSH 插件包名无效。')
}

export function validatePluginInstall(packageName: string, source: string): void {
  validatePluginPackageName(packageName)
  if (!PINNED_GITHUB.test(source)) {
    throw new Error('DSH 插件只允许从固定 GitHub 提交安装（github:owner/repo#40位SHA）。')
  }
}
