/**
 * GitHub OAuth device flow for GitHub Models authentication.
 * Uses the device authorization grant (RFC 8628) so desktop apps can
 * authenticate without a redirect URI.
 */

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

// Set CORTEX_GITHUB_CLIENT_ID to your registered OAuth App client ID.
// Register at: github.com/settings/applications/new
// Required scope: models:read
const CLIENT_ID = process.env.CORTEX_GITHUB_CLIENT_ID ?? '';

/** Initiates the device authorization flow with GitHub. */
export async function startDeviceFlow(): Promise<DeviceCodeResponse> {
  if (!CLIENT_ID) {
    throw new Error(
      'GitHub OAuth client ID not configured. Set CORTEX_GITHUB_CLIENT_ID environment variable.',
    );
  }
  const resp = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      scope: 'models:read',
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub device code request failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  if (data.error) {
    throw new Error(data.error_description || data.error);
  }
  return data as DeviceCodeResponse;
}

/** Polls GitHub until the user completes authorization. Returns the access token. */
export async function pollForToken(deviceCode: string, interval: number): Promise<string> {
  let pollInterval = interval;

  while (true) {
    await new Promise(resolve => setTimeout(resolve, pollInterval * 1000));

    const resp = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    if (!resp.ok) {
      throw new Error(`Token poll failed (${resp.status})`);
    }

    const data = await resp.json();

    if (data.access_token) {
      return data.access_token;
    }

    if (data.error === 'authorization_pending') {
      continue;
    }

    if (data.error === 'slow_down') {
      pollInterval += 5;
      continue;
    }

    if (data.error === 'expired_token') {
      throw new Error('Authorization expired. Please try again.');
    }

    throw new Error(data.error_description || data.error || 'Authorization failed');
  }
}
