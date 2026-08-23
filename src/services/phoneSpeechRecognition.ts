import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type {
  PhoneSpeechPartialResult,
  PhoneSpeechResult,
  PhoneSpeechStatus,
} from '@/types/domain'

interface PhoneSpeechRecognitionPlugin {
  getStatus(): Promise<PhoneSpeechStatus>
  requestPermissions(): Promise<PhoneSpeechStatus>
  startListening(options: { locale: string }): Promise<PhoneSpeechResult>
  stopListening(): Promise<void>
  cancelListening(): Promise<void>
  addListener(
    eventName: 'partialResult',
    listener: (result: PhoneSpeechPartialResult) => void,
  ): Promise<PluginListenerHandle>
}

const NativePhoneSpeechRecognition = registerPlugin<PhoneSpeechRecognitionPlugin>(
  'PhoneSpeechRecognition',
)

export function phoneSpeechRecognitionIsNative() {
  return Capacitor.isNativePlatform()
    && (Capacitor.getPlatform() === 'android' || Capacitor.getPlatform() === 'ios')
}

export async function phoneSpeechRecognitionStatus(): Promise<PhoneSpeechStatus> {
  if (!phoneSpeechRecognitionIsNative()) return { available: false, permission: 'denied' }
  return NativePhoneSpeechRecognition.getStatus()
}

export async function requestPhoneSpeechRecognitionPermission() {
  if (!phoneSpeechRecognitionIsNative()) return { available: false, permission: 'denied' } as const
  return NativePhoneSpeechRecognition.requestPermissions()
}

export function startPhoneSpeechRecognition(
  locale: string,
  onPartialResult: (transcript: string) => void,
) {
  let partialListener: PluginListenerHandle | undefined
  const result = NativePhoneSpeechRecognition
    .addListener('partialResult', value => onPartialResult(value.transcript))
    .then((listener) => {
      partialListener = listener
      return NativePhoneSpeechRecognition.startListening({ locale })
    })
    .finally(() => partialListener?.remove())
  return result
}

export function stopPhoneSpeechRecognition() {
  return NativePhoneSpeechRecognition.stopListening()
}

export function cancelPhoneSpeechRecognition() {
  return NativePhoneSpeechRecognition.cancelListening()
}
