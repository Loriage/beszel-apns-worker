# Beszel APNs Push Notification Worker

A self-hosted Cloudflare Worker that enables real-time push notifications for the Beszel iOS app.

## Architecture

```
[Beszel Hub] --webhook--> [This Worker] --APNs--> [iOS App]
                              |
                              v
                        [KV Storage]
                     (device tokens)
```

## Prerequisites

### 1. Apple Developer Account

You need an Apple Developer account to create APNs credentials.

### 2. APNs Key

1. Go to [Apple Developer Console](https://developer.apple.com/account)
2. Navigate to **Certificates, Identifiers & Profiles** → **Keys**
3. Click **+** to create a new key
4. Name it (e.g., "Beszel APNs Key")
5. Check **Apple Push Notifications service (APNs)**
6. Click **Continue** → **Register**
7. **Download the .p8 file** (you can only download once!)
8. Note the **Key ID** displayed

### 3. Team ID

1. In Apple Developer Console, click your name (top right)
2. Your **Team ID** is shown in the Membership details

### 4. Cloudflare Account

You need a Cloudflare account with Workers enabled.

## Setup

### 1. Clone and Install

```bash
git clone <this-repo>
cd beszel-apns-worker
npm install
```

### 2. Create KV Namespace

```bash
wrangler kv:namespace create "DEVICES"
```

Copy the namespace ID from the output and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "DEVICES"
id = "YOUR_KV_NAMESPACE_ID"
```

### 3. Configure Secrets

```bash
# Your APNs Key ID (from step 2 above)
wrangler secret put APPLE_KEYID

# Your Team ID (from step 3 above)
wrangler secret put APPLE_TEAMID

# Contents of your .p8 file (copy and paste the entire contents)
wrangler secret put APPLE_AUTHKEY
```

### 4. Deploy

```bash
npm run deploy
```

### 5. (Optional) Custom Domain

To use a custom domain like `notify.yourdomain.com`:

1. Add your domain to Cloudflare
2. Uncomment and update the `routes` section in `wrangler.toml`:

```toml
routes = [
  { pattern = "notify.yourdomain.com/*", zone_name = "yourdomain.com" }
]
```

3. Redeploy: `npm run deploy`

## iOS App Configuration

In the Beszel iOS app:

1. Go to **Settings** → **Notifications**
2. Enable notifications
3. Enter your worker URL (e.g., `https://beszel-apns-worker.your-subdomain.workers.dev`)
4. Generate or enter a webhook secret
5. Save the configuration
6. Copy the generated Beszel webhook URL

## Beszel Server Configuration

1. In Beszel web UI, go to **Settings** → **Notifications**
2. Add a new notification
3. Select **Generic Webhook**
4. Paste the webhook URL from the iOS app

The URL format will be:

```
generic+https://your-worker.workers.dev/push/{encoded-path}?template=json
```

## API Endpoints

### POST /register

Register a device token for push notifications.

**Request Body:**

```json
{
    "deviceToken": "...",
    "instanceId": "...",
    "timestamp": 1234567890,
    "signature": "..."
}
```

### POST /push/{webhookPath}

Receive webhook from Beszel and send push notification.

**Request Body (Shoutrrr generic webhook):**

```json
{
    "title": "Alert Title",
    "message": "Alert message body",
    "system": "system-name",
    "alert_type": "cpu",
    "value": 92.5
}
```

## Troubleshooting

### Notifications not received

1. Check Cloudflare Workers logs: `wrangler tail`
2. Verify APNs credentials are correct
3. Ensure the iOS app is registered (check worker logs for registration)
4. Verify the webhook URL in Beszel is correct

### Invalid token errors

Device tokens can become invalid when:

- User uninstalls the app
- User disables notifications
- Token expires

The worker automatically removes invalid tokens.

## Security

- Device tokens are stored in Cloudflare KV (encrypted at rest)
- Webhook paths contain HMAC signatures for verification
- Registration requests include timestamps to prevent replay attacks

## License

MIT
