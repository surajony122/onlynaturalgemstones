// @ts-check

/**
 * @typedef {import("../generated/api").CartTransformRunInput} CartTransformRunInput
 * @typedef {import("../generated/api").CartTransformRunResult} CartTransformRunResult
 */

/**
 * @type {CartTransformRunResult}
 */
const NO_CHANGES = {
  operations: [],
};

/**
 * Merges customization line items (e.g. Gemstone Customisation) into their
 * parent Gemstone line item so Shopify Checkout displays 1 single line item of Qty: 1.
 *
 * @param {CartTransformRunInput} input
 * @returns {CartTransformRunResult}
 */
export function cartTransformRun(input) {
  const operations = [];
  const lines = input.cart.lines || [];

  const parentGemstones = [];
  const childCustomizations = [];

  for (const line of lines) {
    // @ts-ignore
    const handle = line.merchandise?.product?.handle || '';
    const isCustomization =
      handle === 'gemstone-customisation' ||
      handle === 'jewelry-customization-charge' ||
      line.attribute?.value != null;

    if (isCustomization) {
      childCustomizations.push(line);
    } else {
      parentGemstones.push(line);
    }
  }

  if (childCustomizations.length === 0 || parentGemstones.length === 0) {
    return NO_CHANGES;
  }

  for (const parent of parentGemstones) {
    // @ts-ignore
    const parentTitle = (parent.merchandise?.product?.title || '').trim().toLowerCase();
    const parentBundleId = parent.bundleId?.value;

    const matchingChildren = childCustomizations.filter((child) => {
      const linkedGemstone = (child.attribute?.value || '').trim().toLowerCase();
      const childBundleId = child.bundleId?.value;

      if (parentBundleId && childBundleId && parentBundleId === childBundleId) {
        return true;
      }

      if (linkedGemstone && parentTitle && parentTitle.includes(linkedGemstone)) {
        return true;
      }

      return false;
    });

    if (matchingChildren.length > 0) {
      const parentLineId = parent.id;
      const childLineIds = matchingChildren.map((c) => c.id);

      const customType = matchingChildren[0].customizationType?.value;
      // @ts-ignore
      const customTitle = customType
        // @ts-ignore
        ? `${parent.merchandise?.product?.title} (with ${customType})`
        // @ts-ignore
        : `${parent.merchandise?.product?.title} (Customized)`;

      operations.push({
        merge: {
          // @ts-ignore
          parentVariantId: parent.merchandise.id,
          title: customTitle,
          cartLines: [
            {
              cartLineId: parentLineId,
              quantity: parent.quantity,
            },
            ...childLineIds.map((id, index) => ({
              cartLineId: id,
              quantity: matchingChildren[index].quantity,
            })),
          ],
        },
      });
    }
  }

  return operations.length > 0 ? { operations } : NO_CHANGES;
}