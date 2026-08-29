// 短信验证码服务接口(找回密码/绑定手机号)
// 真实发短信需要:服务商(阿里云/腾讯云SMS)签名资质 + 服务端代理(密钥不能进前端)
// 未接入时系统使用"本地模拟验证码":验证码直接显示在界面并明确标注,流程可完整走通
export interface SmsProvider {
  id: string
  name: string
  send(phone: string, code: string): Promise<void>
}

export const smsProviders: SmsProvider[] = []

export function smsReady(): boolean {
  return smsProviders.length > 0
}
