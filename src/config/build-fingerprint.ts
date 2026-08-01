declare const __MINIAPP_BUILD_FINGERPRINT__: {
  appVersion: string;
  gitCommit: string;
  buildAt: string;
};

/** Safe-to-upload build identity; it contains no user, payment, or credential data. */
export const miniappBuildFingerprint = __MINIAPP_BUILD_FINGERPRINT__;
