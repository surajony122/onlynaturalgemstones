/**
 * orders/create webhook.
 *
 * Because a purchased order only ever contains the *customization*
 * variant (on the shared "Custom Jewelry Order" product) rather than the
 * real gemstone product, Shopify's own automatic inventory decrement never
 * touches the actual one-of-a-kind stone. This webhook does that decrement
 * manually, using the `custom.customization_gemstone_variant` metafield
 * stamped onto the customization variant at creation time (see
 * createCustomizedVariant in utils/shopify-admin.server.js) to find which
 * real gemstone variant to reduce by 1.
 */
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop, admin, payload, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}, order ${payload?.id}`);

  if (!admin) {
    // Session revoked/app uninstalled — nothing we can do.
    return new Response();
  }

  const lineItems = payload?.line_items || [];
  for (const item of lineItems) {
    if (!item.variant_id) continue;
    try {
      await decrementLinkedGemstone(admin, item.variant_id);
    } catch (err) {
      // Never let one bad line item block processing the rest, or throw
      // back to Shopify (which would just retry the whole webhook).
      console.error(`[webhooks.orders.create] failed for variant ${item.variant_id}:`, err);
    }
  }

  return new Response();
};

async function decrementLinkedGemstone(admin, orderedVariantId) {
  const variantGid = `gid://shopify/ProductVariant/${orderedVariantId}`;

  const metaRes = await admin.graphql(
    `#graphql
    query LinkedGemstone($id: ID!) {
      productVariant(id: $id) {
        metafield(namespace: "custom", key: "customization_gemstone_variant") {
          value
        }
      }
    }`,
    { variables: { id: variantGid } },
  );
  const metaJson = await metaRes.json();
  const gemstoneVariantGid = metaJson.data?.productVariant?.metafield?.value;
  if (!gemstoneVariantGid) return; // Not one of our customization variants — ignore.

  const invRes = await admin.graphql(
    `#graphql
    query GemstoneInventory($id: ID!) {
      productVariant(id: $id) {
        inventoryItem {
          id
          inventoryLevels(first: 1) {
            nodes { location { id } }
          }
        }
      }
    }`,
    { variables: { id: gemstoneVariantGid } },
  );
  const invJson = await invRes.json();
  const inventoryItemId = invJson.data?.productVariant?.inventoryItem?.id;
  const locationId = invJson.data?.productVariant?.inventoryItem?.inventoryLevels?.nodes?.[0]?.location?.id;
  if (!inventoryItemId || !locationId) {
    console.error(`[webhooks.orders.create] no inventory item/location for gemstone ${gemstoneVariantGid}`);
    return;
  }

  const adjustRes = await admin.graphql(
    `#graphql
    mutation DecrementGemstone($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: {
          reason: "correction",
          name: "available",
          changes: [{ inventoryItemId, locationId, delta: -1 }],
        },
      },
    },
  );
  const adjustJson = await adjustRes.json();
  const errs = adjustJson.data?.inventoryAdjustQuantities?.userErrors;
  if (errs?.length) {
    console.error(`[webhooks.orders.create] inventory adjust failed for ${gemstoneVariantGid}:`, errs);
  } else {
    console.log(`[webhooks.orders.create] decremented gemstone ${gemstoneVariantGid} by 1`);
  }
}
