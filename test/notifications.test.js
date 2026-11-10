import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import worker from "../src/worker.js";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const authKey = privateKey.export({ type: "pkcs8", format: "pem" });

function fixture(t) {
    const records = new Map();
    const sent = [];
    const env = {
        APPLE_KEYID: "test-key",
        APPLE_TEAMID: "test-team",
        APPLE_AUTHKEY: authKey,
        DEVICES: {
            async get(key) { return records.has(key) ? JSON.parse(records.get(key)) : null; },
            async put(key, value) { records.set(key, value); },
        },
    };
    t.mock.method(globalThis, "fetch", async (url, options) => {
        sent.push({ url, payload: JSON.parse(options.body) });
        return new Response(null, { status: 200 });
    });
    t.mock.method(console, "log", () => {});

    async function register(instanceId, hubName, deviceToken = "test-device") {
        return worker.fetch(new Request("https://worker.invalid/register", {
            method: "POST",
            body: JSON.stringify({ instanceId, hubName, deviceToken,
                timestamp: Math.floor(Date.now() / 1000), signature: "test-signature" }),
        }), env);
    }
    async function push(instanceId, data) {
        const path = Buffer.from(`1:${instanceId}:test-signature`).toString("base64url");
        const response = await worker.fetch(new Request(`https://worker.invalid/push/${path}`, {
            method: "POST", body: JSON.stringify(data),
        }), env);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).sent, 1);
        return sent.at(-1).payload;
    }
    return { env, sent, register, push };
}

test("shows the hub and machine without losing the alert details", async (t) => {
    const f = fixture(t);
    assert.equal((await f.register("home", "Maison")).status, 200);
    const payload = await f.push("home", {
        system: "NAS", message: "CPU above threshold\nCPU: 95%\nhttps://hub.invalid/system/nas",
    });
    assert.deepEqual(payload.aps.alert, {
        title: "Maison · NAS", subtitle: "CPU above threshold",
        body: "CPU: 95%\nhttps://hub.invalid/system/nas",
    });
    assert.equal(payload.alertSystemName, "NAS");
});

test("keeps the Beszel title when a generic webhook has no system field", async (t) => {
    const f = fixture(t);
    await f.register("home", "Maison");
    const payload = await f.push("home", {
        title: "NAS CPU above threshold", message: "CPU: 95%\nhttps://hub.invalid/system/nas",
    });
    assert.deepEqual(payload.aps.alert, {
        title: "Maison", subtitle: "NAS CPU above threshold",
        body: "CPU: 95%\nhttps://hub.invalid/system/nas",
    });
});

test("handles a Beszel title included in the message", async (t) => {
    const f = fixture(t);
    await f.register("home", "Maison");
    const payload = await f.push("home", { message: "NAS is down\n\nhttps://hub.invalid/system/nas" });
    assert.deepEqual(payload.aps.alert, {
        title: "Maison", subtitle: "NAS is down", body: "https://hub.invalid/system/nas",
    });
});

test("does not repeat a title that is already in the message", async (t) => {
    const f = fixture(t);
    await f.register("home", "Maison");
    const payload = await f.push("home", { title: "NAS is down", message: "NAS is down\n\nDetails" });
    assert.deepEqual(payload.aps.alert, { title: "Maison", subtitle: "NAS is down", body: "Details" });
});

test("preserves long alert titles and opaque system identifiers", async (t) => {
    const f = fixture(t);
    await f.register("home", "Maison");
    const title = "Server ".repeat(30) + "CPU above threshold";
    const payload = await f.push("home", { title, system: " NAS ", message: "95%" });
    assert.equal(payload.aps.alert.subtitle, title);
    assert.equal(payload.alertSystemId, " NAS ");
});

test("old registrations keep their existing notification format", async (t) => {
    const f = fixture(t);
    await f.register("legacy");
    const payload = await f.push("legacy", { system: "NAS", message: "CPU high\n95%" });
    assert.deepEqual(payload.aps.alert, { title: "CPU high", subtitle: "NAS", body: "95%" });
});

test("uses the webhook title even before the app has sent a hub name", async (t) => {
    const f = fixture(t);
    await f.register("legacy");
    const payload = await f.push("legacy", { title: "NAS is down", message: "Connection lost" });
    assert.deepEqual(payload.aps.alert, { title: "NAS is down", body: "Connection lost" });
});

test("renaming a hub updates its label without duplicating devices", async (t) => {
    const f = fixture(t);
    await f.register("home", "Old name");
    await f.register("home", "Maison");
    await f.register("home");
    await f.register("home", "   ");
    const payload = await f.push("home", { message: "NAS is down" });
    assert.equal(payload.aps.alert.title, "Maison");
    assert.equal(f.sent.length, 1);
    assert.equal((await f.env.DEVICES.get("instance:home")).devices.length, 1);
});

test("keeps hub names separate when one phone uses several hubs", async (t) => {
    const f = fixture(t);
    await f.register("home", "Maison");
    await f.register("office", "Bureau");
    assert.equal((await f.push("home", { system: "NAS", message: "CPU high" })).aps.alert.title, "Maison · NAS");
    assert.equal((await f.push("office", { system: "NAS", message: "CPU high" })).aps.alert.title, "Bureau · NAS");
});

test("normalizes whitespace and preserves international hub names", async (t) => {
    const f = fixture(t);
    await f.register("home", "  Maison\n  été 東京  ");
    const payload = await f.push("home", { system: "  NAS\r\nprincipal ", message: "Alerte" });
    assert.equal(payload.aps.alert.title, "Maison été 東京 · NAS principal");
});

test("bounds hub names without breaking Unicode characters", async (t) => {
    const f = fixture(t);
    await f.register("home", "𐐷".repeat(200));
    const payload = await f.push("home", { message: "Alert" });
    assert.equal(payload.aps.alert.title, "𐐷".repeat(120));
});

test("does not repeat identical hub and system names", async (t) => {
    const f = fixture(t);
    await f.register("home", "NAS");
    const payload = await f.push("home", { system: "NAS", message: "CPU high" });
    assert.equal(payload.aps.alert.title, "NAS");
});

test("missing or malformed optional labels still produce a readable alert", async (t) => {
    const f = fixture(t);
    await f.register("home", { invalid: true });
    const payload = await f.push("home", { title: 42, system: {}, message: null });
    assert.deepEqual(payload.aps.alert, { title: "Alert triggered" });
    assert.equal(payload.alertSystemName, "Unknown");
});
