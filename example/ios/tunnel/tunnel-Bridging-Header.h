// tunnel-Bridging-Header.h
// Bridging header for the "tunnel" Network Extension target.
//
// Exposes the Go-exported C symbols (StartXray, StopXray) to Swift.
// Xray.xcframework must be linked in the tunnel target's Build Phases.

#ifndef tunnel_Bridging_Header_h
#define tunnel_Bridging_Header_h

#include "libxray.h"

#endif /* tunnel_Bridging_Header_h */
