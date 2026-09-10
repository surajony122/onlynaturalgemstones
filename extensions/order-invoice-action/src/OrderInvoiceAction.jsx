/**
 * "Send Invoice" admin action — appears in the order page's action menu
 * (target admin.order-details.action.render). Never fires automatically:
 * only runs when the merchant explicitly opens it and clicks Send.
 *
 * Calls this app's own backend (api.send-order-invoice.jsx) to generate
 * the GST invoice PDF and email it — see that route and
 * app/utils/orderInvoice.server.js for the actual work. This extension
 * is deliberately a thin trigger: no invoice logic lives here.
 */
import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useState} from 'preact/hooks';

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const {data, close} = shopify;
  const orderId = data?.selected?.[0]?.id;

  const [state, setState] = useState({status: 'idle', message: null});

  async function handleSend() {
    setState({status: 'sending', message: null});
    try {
      // A relative path here -- NOT shopify.sessionToken.get() (that's
      // customer-account extensions only) or shopify.idToken() called
      // directly (confirmed live: both threw). Admin UI extensions
      // auto-authenticate fetch() calls resolved against the app's own
      // application_url and add the Authorization header themselves --
      // see https://shopify.dev/docs/apps/build/admin/actions-blocks/connect-app-backend.
      const res = await fetch('api/send-order-invoice', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({orderId}),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        setState({status: 'done', message: json.message || 'Invoice sent.'});
      } else {
        setState({status: 'error', message: json.error || json.message || `Request failed (${res.status})`});
      }
    } catch (err) {
      setState({status: 'error', message: String((err && err.message) || err)});
    }
  }

  return (
    <s-admin-action heading="Send GST Invoice">
      {state.status === 'idle' || state.status === 'sending' ? (
        <s-stack direction="block" gap="base">
          <s-text>
            This generates a GST tax invoice PDF for this order and emails it to the customer.
            Re-sending later reuses the same invoice number — it never creates a second one for
            this order.
          </s-text>
        </s-stack>
      ) : null}

      {state.status === 'done' ? (
        <s-banner heading="Invoice sent" tone="success">
          <s-text>{state.message}</s-text>
        </s-banner>
      ) : null}

      {state.status === 'error' ? (
        <s-banner heading="Couldn't send the invoice" tone="critical">
          <s-text>{state.message}</s-text>
        </s-banner>
      ) : null}

      <s-button slot="primary-action" onClick={handleSend} disabled={state.status === 'sending' || state.status === 'done' || !orderId}>
        {state.status === 'sending' ? 'Sending…' : 'Send Invoice'}
      </s-button>
      <s-button slot="secondary-action" onClick={() => close()}>
        {state.status === 'done' ? 'Close' : 'Cancel'}
      </s-button>
    </s-admin-action>
  );
}
