export const createExportSetting = (setting: LX.AppSetting): LX.AppSetting => {
  const data = JSON.parse(JSON.stringify(setting))
  data['network.gitcodeMusicAccessToken'] = ''
  data['sync.webdav.password'] = ''
  return data
}

export const preserveAgreement = <T extends Partial<LX.AppSetting>>(setting: T, agreed: boolean): T => ({
  ...setting,
  'common.isAgreePact': agreed,
})
