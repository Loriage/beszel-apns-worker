# Beszel APNs Worker

A Cloudflare Worker that delivers push notifications from [Beszel](https://github.com/henrygd/beszel) to the [Beszel iOS app](https://github.com/Loriage/Beszel-Swift-App).

```
[Beszel Hub] --webhook--> [This Worker] --APNs--> [iOS App]
```

## Prerequisites

- **Cloudflare account** with Workers enabled
- **Apple Developer account** with an APNs key:
    1. [Apple Developer Console](https://developer.apple.com/account) → **Keys** → create a new key with **APNs** enabled
    2. Download the `.p8` file and note the **Key ID**
    3. Note your **Team ID** from Membership details

## Setup

```bash
git clone https://github.com/Loriage/beszel-apns-worker
cd beszel-apns-worker
npm install
cp wrangler.example.toml wrangler.toml
```

Create a KV namespace and put the returned ID in `wrangler.toml`:

```bash
wrangler kv:namespace create "DEVICES"
```

Set your Apple credentials:

```bash
wrangler secret put APPLE_KEYID
wrangler secret put APPLE_TEAMID
wrangler secret put APPLE_AUTHKEY  # paste the entire .p8 file contents
```

Deploy:

```bash
npm run deploy
```

### Custom Domain

To use a custom domain instead of the default `*.workers.dev` URL:

1. Add your domain to Cloudflare
2. Uncomment and update the `routes` section in `wrangler.toml`
3. Set `workers_dev` to `false` to disable the public `*.workers.dev` route
4. Set `preview_urls` to `false` to disable preview deployments
5. Redeploy: `npm run deploy`

## iOS App Configuration

1. In the Beszel iOS app, go to **Settings** → **Notifications**
2. Enable notifications and enter your worker URL
3. Copy the generated webhook URL

## Beszel Server Configuration

1. In Beszel web UI, go to **Settings** → **Notifications**
2. Add a **Generic Webhook** and paste the webhook URL from the iOS app

## License

This project is distributed under the MIT License. See the [LICENSE](./LICENSE) file for more details.
