declare module '@env' {
  export const VPN_IP: string;
  export const VPN_PORT: string;
  export const VPN_USER_ID: string;
  export const VPN_SERVER_NAME: string;
  export const VPN_PUBLIC_KEY: string;
  export const VPN_SHORT_ID: string;
  export const SUB_URL: string;
  export const SUB_JSON_URL: string;
  // olcrtc side-channel identity (keyHex is a shared secret — keep out of git).
  export const OLCRTC_ROOM_ID: string;
  export const OLCRTC_CLIENT_ID: string;
  export const OLCRTC_KEY_HEX: string;
}
