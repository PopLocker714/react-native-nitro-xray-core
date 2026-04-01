#include <jni.h>
#include <fbjni/fbjni.h>
#include "NitroXrayCoreOnLoad.hpp"
#include <string>
#include <cstdlib>  // for setenv
#include <android/log.h>

#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, "XrayEngine", __VA_ARGS__)

// Include the generated libxray C header
extern "C" {
    #include "libxray.h"
}

// JNI function: XrayEngine.start(configJson: String, tunFd: Int): Int
extern "C" JNIEXPORT jint JNICALL
Java_com_nitroxraycore_XrayEngine_start(JNIEnv *env, jobject thiz, jstring configJson, jint tunFd) {
    const char *configStr = env->GetStringUTFChars(configJson, nullptr);
    LOGI("Starting Xray with config and fd=%d", (int)tunFd);
    int result = StartXray(const_cast<char*>(configStr), (int)tunFd);
    env->ReleaseStringUTFChars(configJson, configStr);
    return result;
}

// JNI function: XrayEngine.stop(): Int
extern "C" JNIEXPORT jint JNICALL
Java_com_nitroxraycore_XrayEngine_stop(JNIEnv *env, jobject thiz) {
    return StopXray();
}

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::nitroxraycore::registerAllNatives();
  });
}