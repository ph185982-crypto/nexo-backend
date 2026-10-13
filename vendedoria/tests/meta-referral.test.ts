import test from "node:test";
import assert from "node:assert/strict";
import { parseReferral } from "@/lib/meta-referral";

const referralCompleto = {
  source_url: "https://fb.me/abc123",
  source_id: "120210000000000001",
  source_type: "ad",
  headline: "Venda mais com a Nexo",
  body: "Fale com a gente no WhatsApp",
  media_type: "image",
  image_url: "https://example.com/i.jpg",
  ctwa_clid: "ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XQ",
};

test("extrai todos os campos de um referral de anúncio", () => {
  const o = parseReferral({ referral: referralCompleto });
  assert.deepEqual(o, {
    ctwaClid: referralCompleto.ctwa_clid,
    adSourceId: "120210000000000001",
    adSourceType: "ad",
    adHeadline: "Venda mais com a Nexo",
    adBody: "Fale com a gente no WhatsApp",
    adSourceUrl: "https://fb.me/abc123",
  });
});

test("mensagem sem referral → null", () => {
  assert.equal(parseReferral({}), null);
  assert.equal(parseReferral(undefined), null);
  assert.equal(parseReferral({ referral: null }), null);
  assert.equal(parseReferral({ referral: "texto" }), null);
  assert.equal(parseReferral({ referral: [] }), null);
});

test("referral vazio ou sem nada aproveitável → null", () => {
  assert.equal(parseReferral({ referral: {} }), null);
  assert.equal(parseReferral({ referral: { source_type: "ad", body: "só corpo" } }), null);
  assert.equal(parseReferral({ referral: { ctwa_clid: "   " } }), null);
});

test("referral parcial (post orgânico, sem ctwa_clid) ainda devolve o que existe", () => {
  const o = parseReferral({ referral: { source_id: 98765, source_type: "post", source_url: "https://instagram.com/p/x" } });
  assert.equal(o?.ctwaClid, null);
  assert.equal(o?.adSourceId, "98765"); // número vira string
  assert.equal(o?.adSourceType, "post");
});

test("campos com tipo errado são ignorados e textos longos são cortados", () => {
  const o = parseReferral({ referral: { ctwa_clid: { x: 1 }, source_id: "1", headline: "a".repeat(1000) } });
  assert.equal(o?.ctwaClid, null);
  assert.equal(o?.adHeadline?.length, 300);
});
