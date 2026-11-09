package com.nitroxraycore

// Standalone Kotlin check runner; no Android runtime or new test dependency.
fun main() {
    val system = SystemReplayPolicy.SYSTEM_ACTION
    for (sdk in listOf(24, 28, 29, 35)) {
        check(SystemReplayPolicy.allows(system, false, sdk, true, true))
        check(!SystemReplayPolicy.allows(system, false, sdk, true, false)) // no config/logout/manual suppression
        check(!SystemReplayPolicy.allows("ACTION_START", false, sdk, true, true))
        check(!SystemReplayPolicy.allows("ACTION_STOP", false, sdk, true, true))
        check(!SystemReplayPolicy.allows(null, true, sdk, false, true)) // ordinary sticky restart
    }
    check(!SystemReplayPolicy.allows(system, false, 23, true, true))
    check(!SystemReplayPolicy.allows(null, true, 28, true, true)) // unqueryable legacy status
    check(SystemReplayPolicy.allows(null, true, 29, true, true))
    check(!SystemReplayPolicy.allows(system, false, 29, false, true))
}
