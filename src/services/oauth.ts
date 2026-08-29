// 第三方登录接口(微信 / QQ 扫码):预留封装,密钥不进前端
// 真实接入需要:①微信开放平台/QQ互联的企业或个人开发者资质 ②服务端生成二维码与轮询回调
// 接入后实现本接口并在登录页启用扫码 Tab;当前版本诚实显示"未接入"
export interface QrLoginSession {
  qrUrl: string
  poll: () => Promise<{ status: 'waiting' | 'confirmed' | 'expired'; token?: string }>
}

export interface OauthProvider {
  id: 'wechat' | 'qq'
  name: string
  startQrLogin(): Promise<QrLoginSession>
}

export const oauthProviders: OauthProvider[] = []
