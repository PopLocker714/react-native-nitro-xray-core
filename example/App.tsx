import { SUB_URL } from "@env";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import {
	Button,
	SafeAreaView,
	ScrollView,
	Share,
	StyleSheet,
	Switch,
	Text,
	TouchableOpacity,
	View,
} from "react-native";
import {
	XrayClient,
	type OlcrtcClientConfig,
	type ParsedServer,
	type SubscriptionInfo,
} from "react-native-nitro-xray-core";

// olcrtc "Russia bypass": xray dials the server through olcrtc's local SOCKS5,
// which tunnels over a whitelisted WebRTC carrier. carrier/transport/roomId/key
// MUST match the olcrtc server (deploy/olcrtc). Android only for now.
//
// wbstream + vp8channel: the working path on RF mobile networks (wbstream is
// whitelisted and allows anonymous guest). datachannel would be faster but is
// unreachable here — jitsi needs a whitelisted+anonymous server (none for us)
// and wbstream+datachannel needs a moderator token the mobile API can't set.
// Speed lever on vp8channel: vp8BatchSize (engine max 64) — bigger = faster.
// For wbstream, roomId = the BARE UUID from stream.wb.ru (not a URL).
const OLCRTC: OlcrtcClientConfig = {
	carrier: "wbstream",
	transport: "vp8channel",
	roomId: "019f3d76-0bb2-7970-9413-e223b632d238",
	clientId: "mobile-1",
	keyHex: "43ef94f0af31259b7caec7a1e6384799937fa032caae2e8379ee9b9d57042eac",
	vp8Fps: 30,
	vp8BatchSize: 64,
	readyTimeoutMs: 30000,
	debug: true, // olcrtc internals → logcat (adb logcat -s XrayGo) for diagnosis
};

function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
	return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// Turn any thrown value into a full, readable string (native rejections often
// have an empty .message, so fall back to the whole object + stack).
function errStr(e: unknown): string {
	if (e instanceof Error) {
		return e.stack ? `${e.message}\n${e.stack}` : e.message || String(e);
	}
	if (typeof e === "object" && e !== null) {
		try {
			return JSON.stringify(e);
		} catch {
			return String(e);
		}
	}
	return String(e);
}

function formatExpiry(expire: number): string {
	const date = new Date(expire * 1000);
	const daysLeft = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
	const dateStr = date.toLocaleDateString();
	return daysLeft >= 0
		? `${dateStr} (${daysLeft} d left)`
		: `${dateStr} (expired)`;
}

function App(): React.JSX.Element {
	const [logs, setLogs] = useState<string[]>([]);
	const [servers, setServers] = useState<ParsedServer[]>([]);
	const [subInfo, setSubInfo] = useState<SubscriptionInfo | null>(null);
	const [activeTag, setActiveTag] = useState<string | null>(null);
	const [state, setState] = useState<string>("disconnected");
	const [proxyStatus, setProxyStatus] = useState<
		"connecting" | "ready" | "failed" | null
	>(null);
	const [stats, setStats] = useState<{ up: number; down: number }>({
		up: 0,
		down: 0,
	});
	const [version, setVersion] = useState<string>("");
	const [killSwitch, setKillSwitch] = useState<boolean>(false);
	const [pinging, setPinging] = useState<boolean>(false);
	const [latencies, setLatencies] = useState<Record<string, number | null>>(
		{},
	);
	const [olcrtcOn, setOlcrtcOn] = useState<boolean>(false);
	const [olcrtcBusy, setOlcrtcBusy] = useState<boolean>(false);
	const [olcrtcPort, setOlcrtcPort] = useState<number>(0);
	// vp8channel fps — tunable; applies on the next olcrtc start. 30 is the
	// recommended balance (higher = more CPU, no real throughput gain).
	const [vp8Fps, setVp8Fps] = useState<number>(30);
	// Live download rate (bytes/s) for comparing settings.
	const [downRate, setDownRate] = useState<number>(0);
	const prevDownRef = useRef<number>(0);

	const addLog = (msg: string) => {
		// Mirror to the JS console so it also shows in Metro / DevTools.
		console.log(`[xray] ${msg}`);
		setLogs((prev) => [...prev.slice(-80), msg]);
	};

	const shareLogs = async () => {
		try {
			await Share.share({ message: logs.join("\n") });
		} catch (e: unknown) {
			addLog(`share error: ${errStr(e)}`);
		}
	};

	// Catch otherwise-uncaught JS errors and unhandled promise rejections so
	// they land in the on-screen log instead of vanishing.
	useEffect(() => {
		const g = globalThis as any;
		const prevHandler = g.ErrorUtils?.getGlobalHandler?.();
		g.ErrorUtils?.setGlobalHandler?.((e: unknown, isFatal?: boolean) => {
			addLog(`UNCAUGHT${isFatal ? " (fatal)" : ""}: ${errStr(e)}`);
			prevHandler?.(e, isFatal);
		});
		const onRejection = (ev: any) => {
			addLog(`UNHANDLED REJECTION: ${errStr(ev?.reason ?? ev)}`);
		};
		g.addEventListener?.("unhandledrejection", onRejection);
		return () => {
			if (prevHandler) g.ErrorUtils?.setGlobalHandler?.(prevHandler);
			g.removeEventListener?.("unhandledrejection", onRejection);
		};
	}, []);

	useEffect(() => {
		try {
			setVersion(XrayClient.version());
		} catch (e: unknown) {
			addLog(`version error: ${errStr(e)}`);
		}
		try {
			setKillSwitch(XrayClient.isKillSwitchEnabled());
		} catch {
			// not supported on this platform yet
		}
		// Brand name shown in iOS Settings → VPN (swap for your brand).
		try {
			XrayClient.setVpnName("Nitro VPN");
		} catch {
			// no-op on Android
		}
		// Configurable foreground-notification text (swap for translated strings).
		try {
			XrayClient.setNotificationConfig({
				title: "Nitro VPN",
				text: "Connected — protecting your traffic",
				disconnectLabel: "Disconnect",
			});
		} catch {
			// no-op on iOS
		}
		// Ask for notification permission up front so the VPN notification (and
		// its Disconnect button) is visible on Android 13+.
		XrayClient.requestNotificationPermission()
			.then((granted) => addLog(`Notification permission: ${granted ? "granted" : "denied"}`))
			.catch((e: unknown) => addLog(`Notification permission error: ${errStr(e)}`));
		const unsubscribe = XrayClient.onState((s, message) => {
			setState(s);
			addLog(`state → ${s}${message ? ` (${message})` : ""}`);
			// olcrtc readiness rides in the message on iOS: proxy-connecting →
			// proxy-ready → (traffic flows). 'connected' alone doesn't mean the
			// bypass can carry traffic yet.
			if (message === "proxy-connecting") setProxyStatus("connecting");
			else if (message === "proxy-ready") setProxyStatus("ready");
			else if (message === "proxy-failed") {
				setProxyStatus("failed");
				// olcrtc couldn't establish — the tunnel is up but can't carry
				// traffic. Disconnect cleanly (also disables the kill switch's
				// on-demand) instead of leaving a dead-but-connected tunnel.
				addLog("olcrtc failed — disconnecting");
				XrayClient.disconnect().catch((e: unknown) =>
					addLog(`auto-disconnect error: ${errStr(e)}`),
				);
			}
			if (s === "disconnected" || s === "error") {
				setActiveTag(null);
				setStats({ up: 0, down: 0 });
				setProxyStatus(null);
			}
		});
		return unsubscribe;
	}, []);

	// Poll live traffic counters while connected.
	useEffect(() => {
		if (state !== "connected") return;
		prevDownRef.current = 0;
		const id = setInterval(async () => {
			try {
				const s = await XrayClient.stats();
				setStats({ up: s.uplink, down: s.downlink });
				// bytes since last poll (~1s) ≈ bytes/s
				if (prevDownRef.current > 0) {
					setDownRate(Math.max(0, s.downlink - prevDownRef.current));
				}
				prevDownRef.current = s.downlink;
			} catch {
				// ignore transient stats errors
			}
		}, 1000);
		return () => clearInterval(id);
	}, [state]);

	const loadSubscription = async () => {
		try {
			addLog(`Loading subscription…`);
			const { servers: list, info } =
				await XrayClient.fromSubscriptionWithInfo(SUB_URL);
			setServers(list);
			setSubInfo(info);
			addLog(`Loaded ${list.length} servers.`);
			if (info) {
				const used = (info.upload ?? 0) + (info.download ?? 0);
				addLog(
					`Quota: ${formatBytes(used)}${info.total != null ? ` / ${formatBytes(info.total)}` : ""}` +
						`${info.expire != null ? ` · until ${formatExpiry(info.expire)}` : ""}`,
				);
			}
		} catch (e: unknown) {
			addLog(`Subscription error: ${errStr(e)}`);
		}
	};

	const toggleOlcrtc = async (enabled: boolean) => {
		if (olcrtcBusy) return;
		setOlcrtcBusy(true);
		setOlcrtcOn(enabled);
		try {
			if (enabled) {
				// Request VPN permission up front so iOS prompts to (re)create the
				// tunnel config now, not only on the later connect. On iOS olcrtc
				// runs inside the NE, so it needs the VPN profile to exist.
				addLog(`Ensuring VPN permission…`);
				await XrayClient.ensurePermission();
				addLog(
					`Starting olcrtc (${OLCRTC.carrier}/${OLCRTC.transport}, vp8 fps=${vp8Fps})…`,
				);
				await XrayClient.startOlcrtc({ ...OLCRTC, vp8Fps });
				const port = XrayClient.getOlcrtcSocksPort();
				setOlcrtcPort(port);
				addLog(`olcrtc up — SOCKS5 on :${port}`);
			} else {
				await XrayClient.stopOlcrtc();
				setOlcrtcPort(0);
				addLog(`olcrtc stopped.`);
			}
		} catch (e: unknown) {
			setOlcrtcOn(!enabled);
			addLog(`olcrtc error: ${errStr(e)}`);
		} finally {
			setOlcrtcBusy(false);
		}
	};

	const connect = async (server: ParsedServer) => {
		try {
			addLog(`Ensuring VPN permission…`);
			await XrayClient.ensurePermission();
			// If olcrtc is running, chain xray through its local SOCKS5.
			const port = XrayClient.getOlcrtcSocksPort();
			const opts = port > 0 ? { olcrtc: { socksPort: port } } : undefined;
			addLog(
				`Connecting to "${server.tag}"${opts ? ` via olcrtc :${port}` : ""}…`,
			);
			setActiveTag(server.tag);
			await XrayClient.connect(server, opts);
			addLog(`Connected to "${server.tag}".`);
		} catch (e: unknown) {
			addLog(`Connect error: ${errStr(e)}`);
			setActiveTag(null);
		}
	};

	// olcrtc-only: TUN → olcrtc → server → internet, no VLESS server.
	const connectOlcrtcOnly = async () => {
		try {
			if (!XrayClient.isOlcrtcRunning()) {
				addLog("Turn on the olcrtc toggle first.");
				return;
			}
			addLog(`Ensuring VPN permission…`);
			await XrayClient.ensurePermission();
			addLog(`Connecting via olcrtc only (no VLESS)…`);
			setActiveTag("olcrtc-only");
			await XrayClient.connectOlcrtcOnly();
			addLog(`Connected via olcrtc only.`);
		} catch (e: unknown) {
			addLog(`olcrtc-only connect error: ${errStr(e)}`);
			setActiveTag(null);
		}
	};

	const toggleKillSwitch = async (enabled: boolean) => {
		setKillSwitch(enabled);
		try {
			await XrayClient.setKillSwitch(enabled);
			addLog(`Kill switch ${enabled ? "ON" : "OFF"}.`);
		} catch (e: unknown) {
			setKillSwitch(!enabled);
			addLog(`Kill switch error: ${errStr(e)}`);
		}
	};

	const pingAll = async () => {
		if (servers.length === 0 || pinging) return;
		setPinging(true);
		addLog(`Pinging ${servers.length} servers…`);
		try {
			const results = await XrayClient.urlTest(servers);
			setServers(results.map((r) => r.server));
			const byRaw: Record<string, number | null> = {};
			for (const r of results) byRaw[r.server.raw] = r.latencyMs;
			setLatencies(byRaw);
			const alive = results.filter((r) => r.latencyMs !== null).length;
			addLog(`Ping done: ${alive}/${results.length} reachable.`);
		} catch (e: unknown) {
			addLog(`Ping error: ${errStr(e)}`);
		} finally {
			setPinging(false);
		}
	};

	const disconnect = async () => {
		try {
			addLog(`Disconnecting…`);
			await XrayClient.disconnect();
		} catch (e: unknown) {
			addLog(`Disconnect error: ${errStr(e)}`);
		}
	};

	return (
		<SafeAreaView style={styles.container}>
			<Text style={styles.title}>Nitro Xray VPN</Text>
			<Text style={styles.status}>
				{version ? `xray ${version} · ` : ""}
				{state}
				{proxyStatus === "connecting"
					? " · establishing bypass…"
					: proxyStatus === "ready"
						? " · bypass ready"
						: proxyStatus === "failed"
							? " · bypass failed"
							: ""}
			</Text>
			<Text style={styles.status}>
				↑ {formatBytes(stats.up)}   ↓ {formatBytes(stats.down)}
			</Text>
			<Text style={styles.speed}>▼ {formatBytes(downRate)}/s</Text>
			{subInfo && (
				<View style={styles.subInfoBox}>
					{(subInfo.upload != null ||
						subInfo.download != null ||
						subInfo.total != null) && (
						<Text style={styles.subInfoText}>
							Quota:{" "}
							{formatBytes((subInfo.upload ?? 0) + (subInfo.download ?? 0))}
							{/* total=0 conventionally means unlimited */}
							{subInfo.total ? ` / ${formatBytes(subInfo.total)}` : " / ∞"}
						</Text>
					)}
					{/* expire=0 conventionally means no expiry — don't render 1970 */}
					{!!subInfo.expire && (
						<Text style={styles.subInfoText}>
							Expires: {formatExpiry(subInfo.expire)}
						</Text>
					)}
				</View>
			)}

			<View style={styles.row}>
				<View style={styles.flex}>
					<Button title="Load subscription" onPress={loadSubscription} />
				</View>
				<View style={styles.flex}>
					<Button
						title={pinging ? "Pinging…" : "Ping all"}
						onPress={pingAll}
						disabled={pinging || servers.length === 0}
					/>
				</View>
				<View style={styles.flex}>
					<Button title="Disconnect" onPress={disconnect} color="red" />
				</View>
			</View>

			<View style={styles.killSwitchRow}>
				<Text style={styles.killSwitchLabel}>
					Kill switch (block traffic if engine dies)
				</Text>
				<Switch value={killSwitch} onValueChange={toggleKillSwitch} />
			</View>

			<View style={styles.killSwitchRow}>
				<Text style={styles.killSwitchLabel}>
					olcrtc bypass (WebRTC side-channel)
					{olcrtcOn && olcrtcPort > 0 ? ` · SOCKS :${olcrtcPort}` : ""}
				</Text>
				<Switch
					value={olcrtcOn}
					onValueChange={toggleOlcrtc}
					disabled={olcrtcBusy}
				/>
			</View>

			<View style={styles.killSwitchRow}>
				<Text style={styles.killSwitchLabel}>
					vp8 fps (applies on next olcrtc start)
				</Text>
				<View style={styles.fpsButtons}>
					{[30, 60, 90].map((f) => (
						<TouchableOpacity
							key={f}
							onPress={() => setVp8Fps(f)}
							style={[styles.fpsChip, vp8Fps === f && styles.fpsChipActive]}
						>
							<Text
								style={[
									styles.fpsChipText,
									vp8Fps === f && styles.fpsChipTextActive,
								]}
							>
								{f}
							</Text>
						</TouchableOpacity>
					))}
				</View>
			</View>

			<View style={styles.row}>
				<Button
					title="Connect via olcrtc only (no VLESS)"
					onPress={connectOlcrtcOnly}
					disabled={!olcrtcOn || olcrtcPort === 0}
				/>
			</View>


			<ScrollView style={styles.serverList}>
				{servers.map((s, i) => {
					const isActive = activeTag === s.tag;
					return (
						<TouchableOpacity
							key={`${i}-${s.raw}`}
							style={[styles.serverRow, isActive && styles.serverRowActive]}
							onPress={() => connect(s)}
						>
							<View style={styles.serverHeader}>
								<Text style={styles.serverName}>{s.tag}</Text>
								{s.raw in latencies && (
									<Text
										style={[
											styles.latency,
											latencies[s.raw] === null && styles.latencyDead,
										]}
									>
										{latencies[s.raw] === null
											? "×"
											: `${latencies[s.raw]} ms`}
									</Text>
								)}
							</View>
							<Text style={styles.serverMeta}>
								{s.protocol}/{s.network}/{s.security} · {s.address}:{s.port}
							</Text>
						</TouchableOpacity>
					);
				})}
				{servers.length === 0 && (
					<Text style={styles.hint}>
						Tap "Load subscription" to fetch servers.
					</Text>
				)}
			</ScrollView>

			<View style={styles.logHeader}>
				<Text style={styles.logHeaderLabel}>Logs ({logs.length})</Text>
				<View style={styles.logHeaderButtons}>
					<Button title="Share" onPress={shareLogs} disabled={logs.length === 0} />
					<Button title="Clear" onPress={() => setLogs([])} color="#888" />
				</View>
			</View>
			<ScrollView style={styles.logContainer}>
				{/* selectable → long-press to select & copy directly, too */}
				<Text selectable style={styles.logText}>
					{logs.join("\n")}
				</Text>
			</ScrollView>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1, padding: 16, backgroundColor: "#fff" },
	title: { fontSize: 22, fontWeight: "bold", textAlign: "center" },
	status: { fontSize: 14, textAlign: "center", color: "#333", marginTop: 4 },
	speed: {
		fontSize: 16,
		fontWeight: "700",
		textAlign: "center",
		color: "#2e7d32",
		marginTop: 2,
	},
	fpsButtons: { flexDirection: "row", gap: 6 },
	fpsChip: {
		paddingVertical: 4,
		paddingHorizontal: 12,
		borderRadius: 14,
		backgroundColor: "#eee",
	},
	fpsChipActive: { backgroundColor: "#2e7d32" },
	fpsChipText: { fontSize: 13, fontWeight: "600", color: "#333" },
	fpsChipTextActive: { color: "#fff" },
	subInfoBox: {
		marginTop: 8,
		paddingVertical: 6,
		paddingHorizontal: 12,
		borderRadius: 8,
		backgroundColor: "#eef4ff",
		alignSelf: "center",
	},
	subInfoText: { fontSize: 13, color: "#1a3d7c", textAlign: "center" },
	row: { flexDirection: "row", gap: 8, marginTop: 12 },
	flex: { flex: 1 },
	serverList: { maxHeight: 260, marginTop: 12 },
	serverRow: {
		padding: 12,
		borderRadius: 8,
		backgroundColor: "#f2f2f2",
		marginBottom: 8,
	},
	serverRowActive: { backgroundColor: "#d6f5d6", borderWidth: 1, borderColor: "#2e7d32" },
	killSwitchRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		marginTop: 10,
		paddingHorizontal: 4,
	},
	killSwitchLabel: { fontSize: 13, color: "#333", flexShrink: 1 },
	serverHeader: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
	},
	latency: { fontSize: 12, fontWeight: "600", color: "#2e7d32" },
	latencyDead: { color: "#c62828" },
	serverName: { fontSize: 15, fontWeight: "600" },
	serverMeta: { fontSize: 12, color: "#666", marginTop: 2 },
	hint: { color: "#999", textAlign: "center", marginTop: 20 },
	logHeader: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		marginTop: 12,
	},
	logHeaderLabel: { fontSize: 13, fontWeight: "600", color: "#333" },
	logHeaderButtons: { flexDirection: "row", gap: 8 },
	logContainer: {
		flex: 1,
		marginTop: 6,
		backgroundColor: "#f5f5f5",
		padding: 10,
		borderRadius: 5,
	},
	logText: { fontSize: 11, fontFamily: "monospace", marginBottom: 3 },
});

export default App;
