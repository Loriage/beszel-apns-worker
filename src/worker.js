const BUNDLE_ID = "com.nohitdev.Beszel";
const APNS_HOST = "api.push.apple.com";
const APNS_HOST_SANDBOX = "api.sandbox.push.apple.com";

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            if (path === "/register" && request.method === "POST") {
                return await handleRegister(request, env, corsHeaders);
            }

            if (path.startsWith("/push/") && request.method === "POST") {
                return await handleWebhook(request, env, path.slice(6), corsHeaders);
            }

            return new Response("Not Found", { status: 404 });
        } catch (error) {
            console.error("Worker error:", error);
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }
    },
};

async function handleRegister(request, env, corsHeaders) {
    const { deviceToken, instanceId, timestamp, signature } = await request.json();

    if (!deviceToken || !instanceId || !timestamp || !signature) {
        return jsonResponse({ error: "Missing required fields" }, 400, corsHeaders);
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > 300) {
        return jsonResponse({ error: "Timestamp expired" }, 400, corsHeaders);
    }

    const kvKey = `instance:${instanceId}`;
    let record = (await env.DEVICES.get(kvKey, { type: "json" })) || { devices: [] };

    if (!record.devices.includes(deviceToken)) {
        record.devices.push(deviceToken);
    }
    record.seenAt = now;

    await env.DEVICES.put(kvKey, JSON.stringify(record));
    console.log(`Registered device for instance ${instanceId}, total: ${record.devices.length}`);

    return jsonResponse({ success: true }, 200, corsHeaders);
}

async function handleWebhook(request, env, webhookPath, corsHeaders) {
    let timestamp, instanceId, signature;
    try {
        const decoded = atob(webhookPath.replace(/-/g, "+").replace(/_/g, "/"));
        [timestamp, instanceId, signature] = decoded.split(":");
    } catch {
        return jsonResponse({ error: "Invalid webhook path" }, 400, corsHeaders);
    }

    if (!timestamp || !instanceId || !signature) {
        return jsonResponse({ error: "Invalid webhook path format" }, 400, corsHeaders);
    }

    const kvKey = `instance:${instanceId}`;
    const record = await env.DEVICES.get(kvKey, { type: "json" });

    if (!record?.devices?.length) {
        console.log(`No devices registered for instance ${instanceId}`);
        return jsonResponse({ success: true, sent: 0 }, 200, corsHeaders);
    }

    const { title, message, system, alert_type, value } = await request.json();

    const msgLines = (message || "Alert triggered").trim().split("\n");
    const summary = msgLines[0].trim();
    const detail = msgLines.slice(1).map((l) => l.trim()).filter((l) => l).join("\n");

    const alert = { title: summary };
    if (system) alert.subtitle = system;
    if (detail) alert.body = detail;

    const apnsPayload = {
        aps: {
            alert,
            sound: "default",
            "mutable-content": 1,
        },
        alertSystemName: system || "Unknown",
        alertName: alert_type || "alert",
        alertValue: value,
        alertCreated: Math.floor(Date.now() / 1000),
        alertHistoryId: `${instanceId}-${Date.now()}`,
        alertSystemId: system || "unknown",
    };

    const jwt = await createJWT(env);
    let sent = 0, failed = 0;
    const validDevices = [];

    for (const deviceToken of record.devices) {
        try {
            const response = await sendNotification(deviceToken, apnsPayload, jwt);
            if (response.ok) {
                sent++;
                validDevices.push(deviceToken);
            } else {
                const errorBody = await response.text();
                console.error(`APNs error for ${deviceToken.slice(0, 8)}...: ${response.status} ${errorBody}`);
                if (response.status !== 400 && response.status !== 410) {
                    validDevices.push(deviceToken);
                }
                failed++;
            }
        } catch (e) {
            console.error(`Failed to send to ${deviceToken.slice(0, 8)}...: ${e.message}`);
            validDevices.push(deviceToken);
            failed++;
        }
    }

    if (validDevices.length !== record.devices.length) {
        record.devices = validDevices;
        await env.DEVICES.put(kvKey, JSON.stringify(record));
    }

    console.log(`Sent ${sent}, failed ${failed} for instance ${instanceId}`);
    return jsonResponse({ success: true, sent, failed }, 200, corsHeaders);
}

async function sendNotification(deviceToken, payload, jwt, useSandbox = true) {
    const host = useSandbox ? APNS_HOST_SANDBOX : APNS_HOST;
    return fetch(`https://${host}/3/device/${deviceToken}`, {
        method: "POST",
        headers: {
            Authorization: `bearer ${jwt}`,
            "apns-topic": BUNDLE_ID,
            "apns-push-type": "alert",
            "apns-priority": "10",
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

async function createJWT(env) {
    const header = { alg: "ES256", kid: env.APPLE_KEYID };
    const claims = { iss: env.APPLE_TEAMID, iat: Math.floor(Date.now() / 1000) };

    const encodedHeader = base64urlEncode(JSON.stringify(header));
    const encodedClaims = base64urlEncode(JSON.stringify(claims));
    const signingInput = `${encodedHeader}.${encodedClaims}`;

    const privateKey = await importPrivateKey(env.APPLE_AUTHKEY);
    const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        privateKey,
        new TextEncoder().encode(signingInput),
    );

    return `${signingInput}.${base64urlEncode(new Uint8Array(signature))}`;
}

async function importPrivateKey(pem) {
    const pemContents = pem
        .replace(/-----BEGIN PRIVATE KEY-----/, "")
        .replace(/-----END PRIVATE KEY-----/, "")
        .replace(/\s/g, "");

    const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

    return crypto.subtle.importKey(
        "pkcs8",
        binaryDer,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"],
    );
}

function base64urlEncode(input) {
    const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
    return btoa(String.fromCharCode(...data))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function jsonResponse(data, status, corsHeaders) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}
