import { readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

function parseEnv(contents) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()))
      .filter(Boolean)
      .map((match) => [match[1], match[2].replace(/^['"]|['"]$/g, "")]),
  );
}

function client(url, key) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function requireData(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

function requireSuccess(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function main() {
  const repoRoot = process.cwd();
  const values = parseEnv(await readFile(path.join(repoRoot, ".env.local.supabase"), "utf8"));
  const url = values.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = values.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = values.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error("Run scripts/dev-db.sh first; local Supabase environment is missing.");

  const admin = client(url, serviceKey);
  const email = `credit-ledger-${crypto.randomUUID()}@autobiz.local`;
  const password = "CreditLedger1234!";
  const created = requireData(
    await admin.auth.admin.createUser({ email, password, email_confirm: true }),
    "create test user",
  );
  const userId = created.user.id;

  try {
    requireSuccess(
      await admin.from("profiles").upsert({ id: userId, email, display_name: "Credit DB test" }),
      "upsert test profile",
    );

    const fixtureCredits = 5;
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    requireData(
      await admin.rpc("grant_credit", {
        p_user_id: userId,
        p_kind: "BLOG",
        p_amount: fixtureCredits,
        p_expires_at: future,
        p_reference_id: "concurrency-fixture",
      }),
      "grant concurrency credits",
    );

    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        admin.rpc("reserve_credit", {
          p_user_id: userId,
          p_kind: "BLOG",
          p_amount: 1,
          p_reference_id: `concurrent-${index}`,
        }).then((result) => {
          if (result.error) throw result.error;
          return result.data;
        }),
      ),
    );
    const reservations = attempts
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    assert.equal(reservations.length, fixtureCredits, "only the granted test credits may be reserved");
    assert.equal(attempts.filter((result) => result.status === "rejected").length, 20 - fixtureCredits);

    const grants = requireData(
      await admin.from("credit_grants").select("remaining").eq("user_id", userId).eq("kind", "BLOG"),
      "read grants after concurrency",
    );
    assert.ok(grants.every((grant) => grant.remaining >= 0), "no grant may have a negative balance");
    assert.equal(grants.reduce((sum, grant) => sum + grant.remaining, 0), 0);

    requireSuccess(await admin.rpc("release_credit", { p_reservation_id: reservations[0], p_reason: "db-test" }), "release credit");
    requireSuccess(await admin.rpc("settle_credit", { p_reservation_id: reservations[1], p_reference_id: "db-test" }), "settle credit");

    const signedIn = requireData(await client(url, anonKey).auth.signInWithPassword({ email, password }), "sign in test user");
    const userClient = client(url, anonKey);
    await userClient.auth.setSession({ access_token: signedIn.session.access_token, refresh_token: signedIn.session.refresh_token });
    const forbidden = await userClient.rpc("reserve_credit", { p_user_id: userId, p_kind: "BLOG", p_amount: 1 });
    assert.ok(forbidden.error, "authenticated users must not execute reserve_credit");
    const forbiddenCalls = await Promise.all([
      userClient.rpc("grant_credit", {
        p_user_id: userId,
        p_kind: "BLOG",
        p_amount: 1,
        p_expires_at: future,
      }),
      userClient.rpc("settle_credit", { p_reservation_id: reservations[2] }),
      userClient.rpc("release_credit", { p_reservation_id: reservations[2] }),
      userClient.rpc("expire_credits", { p_now: new Date().toISOString() }),
      userClient.rpc("complete_billing_order", { p_order_id: crypto.randomUUID(), p_payment_key: "forbidden" }),
    ]);
    assert.ok(forbiddenCalls.every((result) => result.error), "all credit mutation RPCs must reject authenticated users");

    const shortExpiry = new Date(Date.now() + 2_000).toISOString();
    requireData(
      await admin.rpc("grant_credit", {
        p_user_id: userId,
        p_kind: "SHORTS",
        p_amount: 2,
        p_expires_at: shortExpiry,
        p_reference_id: "expiry-fixture",
      }),
      "grant expiring credits",
    );
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    const expired = requireData(await admin.rpc("expire_credits", { p_now: new Date().toISOString() }), "expire credits");
    assert.ok(expired >= 2, "expiry must remove the short-lived grant");

    const checkoutFixtureId = crypto.randomUUID();
    const providerOrderId = `order_${crypto.randomUUID().replaceAll("-", "")}`;
    requireSuccess(
      await admin.from("billing_checkout_sessions").insert({
        id: checkoutFixtureId,
        user_id: userId,
        product_id: "BLOG_5",
        provider: "mock",
        status: "PROCESSING",
        customer_key: `cus_${crypto.randomUUID()}`,
        order_id: providerOrderId,
      }),
      "create product checkout fixture",
    );
    const productOrder = requireData(
      await admin.from("billing_orders").insert({
        user_id: userId,
        product_id: "BLOG_5",
        kind: "BLOG",
        credit_amount: 5,
        price_krw: 9900,
        validity_days: 30,
        provider: "mock",
        checkout_session_id: checkoutFixtureId,
        provider_order_id: providerOrderId,
      }).select("id").single(),
      "create product order fixture",
    );
    const firstGrantId = requireData(
      await admin.rpc("complete_billing_order", { p_order_id: productOrder.id, p_payment_key: "mock_pay_fixture" }),
      "complete product order",
    );
    const duplicateGrantId = requireData(
      await admin.rpc("complete_billing_order", { p_order_id: productOrder.id, p_payment_key: "mock_pay_fixture" }),
      "repeat product order completion",
    );
    assert.equal(duplicateGrantId, firstGrantId, "duplicate approval must return the same grant");
    const orderGrantRows = requireData(
      await admin.from("credit_grants").select("id,remaining").eq("order_id", productOrder.id),
      "read completed order grant",
    );
    assert.equal(orderGrantRows.length, 1, "duplicate approval must create one grant");
    assert.equal(orderGrantRows[0].remaining, 5);
    const completedOrder = requireData(
      await admin.from("billing_orders").select("status,paid_at").eq("id", productOrder.id).single(),
      "read completed order",
    );
    assert.equal(completedOrder.status, "PAID");
    assert.ok(completedOrder.paid_at);

    const order = requireData(
      await admin
        .from("billing_orders")
        .insert({
          user_id: userId,
          product_id: "TEST_BLOG_CREDIT",
          kind: "BLOG",
          credit_amount: fixtureCredits,
          price_krw: 1,
          validity_days: 30,
          status: "PAID",
          provider: "mock",
          provider_order_id: `db-test-${crypto.randomUUID()}`,
          paid_at: new Date().toISOString(),
        })
        .select("id")
        .single(),
      "create refundable order",
    );
    requireData(
      await admin.rpc("grant_credit", {
        p_user_id: userId,
        p_kind: "BLOG",
        p_amount: fixtureCredits,
        p_expires_at: future,
        p_order_id: order.id,
        p_reference_id: "refund-fixture",
      }),
      "grant order credits",
    );
    const forbiddenRefund = await userClient.rpc("refund_order_credits", { p_order_id: order.id, p_reason: "forbidden" });
    assert.ok(forbiddenRefund.error, "authenticated users must not refund orders");
    assert.equal(
      requireData(await admin.rpc("refund_order_credits", { p_order_id: order.id, p_reason: "db-test" }), "refund credits"),
      fixtureCredits,
    );

    const ledger = requireData(
      await admin.from("credit_ledger").select("id,event_type,delta").eq("user_id", userId),
      "read ledger",
    );
    for (const event of ["GRANT", "RESERVE", "SETTLE", "RELEASE", "EXPIRE", "REFUND"]) {
      assert.ok(ledger.some((entry) => entry.event_type === event), `ledger must contain ${event}`);
    }

    const immutable = await admin.from("credit_ledger").update({ reference_id: "tampered" }).eq("id", ledger[0].id);
    assert.ok(immutable.error, "ledger updates must be rejected even for service role");

    console.log("[credit-db] PASS: 20 concurrent reservations, idempotent order completion, service-role ACL, release, settle, expiry, refund, immutable ledger");
  } finally {
    requireSuccess(await admin.auth.admin.deleteUser(userId), "delete test user");
  }
}

main().catch((error) => {
  console.error(`[credit-db] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

