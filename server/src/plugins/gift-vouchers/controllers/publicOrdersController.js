/**
 * The public offer (specs/gift-vouchers.md rule 14, §4.3): the bounds, the validity and the priced ideas. `available` is
 * true only while a payment can be taken online (rule 2); the order, its payment and its voucher page are not served here
 * yet.
 */

function buildPublicOrdersController({
  ideas, limits, termsVersionId, available, respond,
}) {
  async function read(req, res) {
    const { minAmountCents, maxAmountCents, validityMonths } = limits();
    const priced = await ideas.read();
    return respond.ok(res, {
      available: available(),
      minAmountCents,
      maxAmountCents,
      validityMonths,
      ideas: priced,
      termsVersionId: termsVersionId(),
    });
  }

  return { read };
}

module.exports = { buildPublicOrdersController };
