/**
 * @file Historically this script (from create-nitro-module) stripped
 * 'margelo/nitro/' from the generated NitroXrayCoreOnLoad.cpp so the JNI
 * descriptor matched a custom package layout (com.nitroxraycore.HybridNitroXrayCore).
 *
 * The Kotlin implementation has since moved to the standard Nitro location —
 * android/src/main/java/com/margelo/nitro/nitroxraycore/HybridNitroXrayCore.kt
 * (package com.margelo.nitro.nitroxraycore) — so the generated descriptor
 * "Lcom/margelo/nitro/nitroxraycore/HybridNitroXrayCore;" is already correct.
 *
 * Stripping it now produces a ClassNotFoundException at runtime
 * (createHybridObject → "Didn't find class com.nitroxraycore.HybridNitroXrayCore").
 * The workaround is therefore intentionally a no-op; the file is kept so the
 * `codegen` script keeps working without package.json changes.
 */
console.log(
  '[post-script] OnLoad.cpp workaround skipped — Kotlin impl lives in the standard com.margelo.nitro package.'
)
