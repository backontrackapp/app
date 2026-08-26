import UIKit
import Capacitor
import CapacitorBackgroundRunner
import AVFoundation
import Speech

@objc(PhoneSpeechRecognitionPlugin)
class PhoneSpeechRecognitionPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "PhoneSpeechRecognitionPlugin"
    let jsName = "PhoneSpeechRecognition"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startListening", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopListening", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelListening", returnType: CAPPluginReturnPromise)
    ]

    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var listeningCall: CAPPluginCall?
    private var listeningLocale = ""
    private var latestTranscript = ""
    private var tapInstalled = false
    private var timeoutTimer: Timer?
    private var stopTimer: Timer?

    @objc func getStatus(_ call: CAPPluginCall) {
        call.resolve(statusResult())
    }

    @objc func requestPermissions(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { _ in
            AVAudioSession.sharedInstance().requestRecordPermission { _ in
                DispatchQueue.main.async {
                    call.resolve(self.statusResult())
                }
            }
        }
    }

    @objc func startListening(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.combinedPermission() == "granted" else {
                call.reject("Microphone and speech recognition access are required.", "SPEECH_PERMISSION_DENIED")
                return
            }
            guard self.listeningCall == nil else {
                call.reject("Another voice request is already listening.", "SPEECH_BUSY")
                return
            }

            let requestedLocale = call.getString("locale")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            self.listeningLocale = requestedLocale.isEmpty ? Locale.current.identifier : requestedLocale
            guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: self.listeningLocale)), recognizer.isAvailable else {
                call.unavailable("Phone speech recognition is unavailable.")
                return
            }

            self.listeningCall = call
            self.latestTranscript = ""
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.record, mode: .measurement, options: .duckOthers)
                try session.setActive(true, options: .notifyOthersOnDeactivation)

                let request = SFSpeechAudioBufferRecognitionRequest()
                request.shouldReportPartialResults = true
                if #available(iOS 16.0, *) { request.addsPunctuation = true }
                let inputNode = self.audioEngine.inputNode
                let format = inputNode.outputFormat(forBus: 0)
                inputNode.installTap(onBus: 0, bufferSize: 1_024, format: format) { buffer, _ in
                    request.append(buffer)
                }
                self.tapInstalled = true

                self.recognitionRequest = request
                self.audioEngine.prepare()
                try self.audioEngine.start()
                self.recognitionTask = recognizer.recognitionTask(with: request) { result, error in
                    DispatchQueue.main.async {
                        guard self.listeningCall != nil else { return }
                        if let result {
                            self.latestTranscript = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
                            if !self.latestTranscript.isEmpty {
                                self.notifyListeners("partialResult", data: ["transcript": self.latestTranscript])
                            }
                            if result.isFinal {
                                self.finishListening()
                                return
                            }
                        }
                        if let error {
                            self.rejectListening("Phone speech recognition could not finish.", code: "SPEECH_FAILED", error: error)
                        }
                    }
                }
                self.timeoutTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: false) { _ in
                    self.stopActiveRecognition()
                }
            } catch {
                self.rejectListening("Phone speech recognition could not start.", code: "SPEECH_START_FAILED", error: error)
            }
        }
    }

    @objc func stopListening(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stopActiveRecognition()
            call.resolve()
        }
    }

    @objc func cancelListening(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let activeCall = self.listeningCall {
                self.cleanupRecognition(cancelTask: true)
                activeCall.reject("Voice recognition was cancelled.", "SPEECH_CANCELLED")
            }
            call.resolve()
        }
    }

    private func statusResult() -> JSObject {
        return [
            "available": SFSpeechRecognizer()?.isAvailable == true,
            "permission": combinedPermission()
        ]
    }

    private func combinedPermission() -> String {
        let speech = SFSpeechRecognizer.authorizationStatus()
        let microphone = AVAudioSession.sharedInstance().recordPermission
        if speech == .authorized && microphone == .granted { return "granted" }
        if speech == .restricted { return "restricted" }
        if speech == .denied || microphone == .denied { return "denied" }
        return "prompt"
    }

    private func stopActiveRecognition() {
        guard listeningCall != nil else { return }
        if audioEngine.isRunning { audioEngine.stop() }
        recognitionRequest?.endAudio()
        stopTimer?.invalidate()
        stopTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: false) { _ in
            self.finishListening()
        }
    }

    private func finishListening() {
        guard let call = listeningCall else { return }
        let transcript = latestTranscript
        let locale = listeningLocale
        cleanupRecognition(cancelTask: false)
        if transcript.isEmpty {
            call.reject("No speech was recognized.", "SPEECH_NO_MATCH")
        } else {
            call.resolve(["transcript": transcript, "locale": locale])
        }
    }

    private func rejectListening(_ message: String, code: String, error: Error?) {
        guard let call = listeningCall else { return }
        cleanupRecognition(cancelTask: true)
        call.reject(message, code, error)
    }

    private func cleanupRecognition(cancelTask: Bool) {
        listeningCall = nil
        timeoutTimer?.invalidate()
        timeoutTimer = nil
        stopTimer?.invalidate()
        stopTimer = nil
        if audioEngine.isRunning { audioEngine.stop() }
        if tapInstalled {
            audioEngine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        recognitionRequest?.endAudio()
        if cancelTask { recognitionTask?.cancel() }
        recognitionRequest = nil
        recognitionTask = nil
        latestTranscript = ""
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

@objc(AppBridgeViewController)
class AppBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        supportedOrientations = [UIInterfaceOrientation.portrait.rawValue]
        bridge?.registerPluginType(PhoneSpeechRecognitionPlugin.self)
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        BackgroundRunnerPlugin.registerBackgroundTask()
        BackgroundRunnerPlugin.handleApplicationDidFinishLaunching(launchOptions: launchOptions)
        return true
    }

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        guard let bridgeViewController = self.window?.rootViewController as? CAPBridgeViewController else {
            return .portrait
        }
        return UIInterfaceOrientationMask(rawValue: UInt(bridgeViewController.supportedInterfaceOrientations.rawValue))
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
