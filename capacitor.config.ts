import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.gitubcreater.zsbstudyhelper',
  appName: '专升本学习助手',
  webDir: 'dist',
  android: {
    backgroundColor: '#F2F6FB',
  },
  server: {
    androidScheme: 'https',
  },
}

export default config
