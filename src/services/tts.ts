// 语音合成/识别接口(第四阶段接入)
// 约束:语音内容必须与文字稿一致;相同题目+模式可缓存;失败时文字解析仍可用
export interface TtsProvider {
  id: string
  synthesize(script: string, opts: { voice?: string; speed?: number }): Promise<ArrayBuffer>
}

export interface AsrProvider {
  id: string
  recognize(audio: ArrayBuffer): Promise<{ text: string; confidence: number }>
}

export const ttsProvider: TtsProvider | null = null
export const asrProvider: AsrProvider | null = null
