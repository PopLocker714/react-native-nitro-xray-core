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

// JNI function: XrayEngine.getVersion(): String
extern "C" JNIEXPORT jstring JNICALL
Java_com_nitroxraycore_XrayEngine_getVersion(JNIEnv *env, jobject thiz) {
    char *version = GetVersion();
    jstring result = env->NewStringUTF(version != nullptr ? version : "");
    if (version != nullptr) {
        FreeString(version);
    }
    return result;
}

// JNI function: XrayEngine.queryStats(outboundTag: String): String
// Returns a JSON string {"uplink":N,"downlink":N}.
extern "C" JNIEXPORT jstring JNICALL
Java_com_nitroxraycore_XrayEngine_queryStats(JNIEnv *env, jobject thiz, jstring outboundTag) {
    const char *tagStr = env->GetStringUTFChars(outboundTag, nullptr);
    char *json = QueryStats(const_cast<char*>(tagStr));
    env->ReleaseStringUTFChars(outboundTag, tagStr);
    jstring result = env->NewStringUTF(json != nullptr ? json : "{\"uplink\":0,\"downlink\":0}");
    if (json != nullptr) {
        FreeString(json);
    }
    return result;
}

// JNI function: XrayEngine.startOlcrtc(configJson: String): Int
extern "C" JNIEXPORT jint JNICALL
Java_com_nitroxraycore_XrayEngine_startOlcrtc(JNIEnv *env, jobject thiz, jstring configJson) {
    const char *configStr = env->GetStringUTFChars(configJson, nullptr);
    LOGI("Starting olcrtc");
    int result = StartOlcrtc(const_cast<char*>(configStr));
    env->ReleaseStringUTFChars(configJson, configStr);
    return result;
}

// JNI function: XrayEngine.stopOlcrtc(): Int
extern "C" JNIEXPORT jint JNICALL
Java_com_nitroxraycore_XrayEngine_stopOlcrtc(JNIEnv *env, jobject thiz) {
    return StopOlcrtc();
}

// JNI function: XrayEngine.getOlcrtcSocksPort(): Int
extern "C" JNIEXPORT jint JNICALL
Java_com_nitroxraycore_XrayEngine_getOlcrtcSocksPort(JNIEnv *env, jobject thiz) {
    return GetOlcrtcSocksPort();
}

// JNI function: XrayEngine.isOlcrtcRunning(): Int
extern "C" JNIEXPORT jint JNICALL
Java_com_nitroxraycore_XrayEngine_isOlcrtcRunning(JNIEnv *env, jobject thiz) {
    return IsOlcrtcRunning();
}

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::nitroxraycore::registerAllNatives();
  });
}