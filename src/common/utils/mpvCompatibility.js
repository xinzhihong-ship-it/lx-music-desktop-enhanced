export const getBundledMacMpvAppNames = (darwinRelease, arch) => {
  const darwinMajor = Number.parseInt(darwinRelease, 10)
  return arch === 'arm64' && Number.isFinite(darwinMajor) && darwinMajor >= 25
    ? ['mpv-macos26.app']
    : ['mpv.app']
}
