import React, { useState, useEffect } from 'react';
import {Text, View, StyleSheet, Button, SafeAreaView, ScrollView } from 'react-native';
import { NitroXrayCore } from 'react-native-nitro-xray-core';

const XRAY_CONFIG = {
  "log": { "loglevel": "debug" },
  "inbounds": [
    {
      "tag": "tun-in",
      "protocol": "tun",
      "port": 0,
      "settings": {
        "name": "tun0",
        "mtu": 1500
      },
      "sniffing": {
        "enabled": true,
        "destOverride": ["http", "tls"]
      }
    }
  ],
  "outbounds": [
    {
      "tag": "proxy",
      "protocol": "vless",
      "settings": {
        "vnext": [{
          "address": "YOUR_IP",
          "port": 51191,
          "users": [{"id": "YOUR_USER_ID", "encryption": "none", "flow": "xtls-rprx-vision"}]
        }]
      },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "show": false,
          "fingerprint": "chrome",
          "serverName": "github.com",
          "publicKey": "YOUR_PUBLIC_KEY",
          "shortId": "YOUR_SHORT_ID",
          "spiderX": ""
        }
      }
    },
    { "protocol": "freedom", "tag": "direct" },
    { "protocol": "blackhole", "tag": "block" },
    { "protocol": "dns", "tag": "dns-out" }
  ],
  "dns": {
    "servers": [
      "1.1.1.1",
      "8.8.8.8",
      "localhost"
    ]
  },
  "routing": {
    "domainStrategy": "IPIfNonMatch",
    "rules": [
      { "type": "field", "port": 53, "outboundTag": "dns-out" },
      { "type": "field", "ip": ["127.0.0.1/32", "10.0.2.2/32", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"], "outboundTag": "direct" },
      { "type": "field", "inboundTag": ["tun-in"], "outboundTag": "proxy" }
    ]
  }
};

function App(): React.JSX.Element {
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    NitroXrayCore.requestNotificationPermission().then(granted => {
      console.log('Notification permission granted:', granted);
    }).catch(e => {
      console.error('Failed to request notification permission', e);
    });
  }, []);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, msg]);
  };

  const handlePrepare = async () => {
    try {
      addLog("Checking VPN permission...");
      const hasPerm = await NitroXrayCore.hasVpnPermission();
      if (hasPerm) {
        addLog("VPN permission already granted.");
      } else {
        addLog("Requesting VPN permission...");
        await NitroXrayCore.requestVpnPermission();
      }
    } catch (e: any) {
      addLog(`VPN permission error: ${e.message}`);
    }
  };

  const handleStart = async () => {
    try {
      addLog("Starting Xray...");
      await NitroXrayCore.startXray(JSON.stringify(XRAY_CONFIG));
      addLog("Xray start requested.");
    } catch (e: any) {
      addLog(`startXray error: ${e.message}`);
    }
  };

  const handleStop = async () => {
    try {
      addLog("Stopping Xray...");
      await NitroXrayCore.stopXray();
      addLog("Xray stop requested.");
    } catch (e: any) {
      addLog(`stopXray error: ${e.message}`);
    }
  };

  const handleCheckStatus = () => {
    const isConn = NitroXrayCore.isVpnConnected();
    addLog(`VPN Connected State: ${isConn ? 'YES (connected)' : 'NO (disconnected)'}`);
  };

  return (
    <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Nitro Xray VPN</Text>
        <View style={styles.buttonContainer}>
          <Button title="1. Check/Request VPN Permission" onPress={handlePrepare} />
        </View>
        <View style={styles.buttonContainer}>
          <Button title="2. Start VPN" onPress={handleStart} color="green" />
        </View>
        <View style={styles.buttonContainer}>
          <Button title="3. Stop VPN" onPress={handleStop} color="red" />
        </View>
        <View style={styles.buttonContainer}>
          <Button title="4. Check Status" onPress={handleCheckStatus} color="purple" />
        </View>

        <ScrollView style={styles.logContainer}>
          {logs.map((log, index) => (
            <Text key={index} style={styles.logText}>{log}</Text>
          ))}
        </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center'
  },
  buttonContainer: {
    marginVertical: 10,
  },
  logContainer: {
    flex: 1,
    marginTop: 20,
    backgroundColor: '#f5f5f5',
    padding: 10,
    borderRadius: 5,
  },
  logText: {
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 5,
  }
});

export default App;